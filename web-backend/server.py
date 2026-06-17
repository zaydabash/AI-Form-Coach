"""FormIQ cloud API — stateless coaching service for the browser client.

The browser does camera capture + MediaPipe pose + rep detection. This service
only does the things that must stay server-side: the Claude coaching calls and
Deepgram TTS (so the API keys never reach the client). No OpenCV, no MediaPipe,
no webcam — which keeps it light enough for a free Render instance.

Endpoints (all gated by a shared passcode header `x-formiq-code`):
    POST /coach     { image_b64, angles, rep_number, phase } -> coaching JSON
    POST /summary   { rep_history }                          -> summary JSON
    POST /speak     { text }                                 -> audio/mpeg
    GET  /health                                             -> ok (ungated)
"""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from coach import FormCoach
from voice import Voice

ACCESS_CODE = os.getenv("FORMIQ_ACCESS_CODE", "")  # empty = gate disabled (local dev)
RATE_LIMIT = int(os.getenv("FORMIQ_RATE_LIMIT_PER_MIN", "40"))
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("FORMIQ_ALLOWED_ORIGINS", "*").split(",") if o.strip()]

app = FastAPI(title="FormIQ Cloud API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_coach = FormCoach()
_voice = Voice()

# Per-IP sliding-window rate limiter (in-memory; fine for a single instance).
_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def _gate(request: Request, code: str | None) -> None:
    """Enforce the shared passcode and per-IP rate limit."""
    if ACCESS_CODE and code != ACCESS_CODE:
        raise HTTPException(status_code=401, detail="Invalid access code.")
    ip = _client_ip(request)
    now = time.time()
    window = _hits[ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Slow down.")
    window.append(now)


class CoachRequest(BaseModel):
    image_b64: str
    angles: dict
    rep_number: int
    phase: str = "up"


class SummaryRequest(BaseModel):
    rep_history: list[dict]


class SpeakRequest(BaseModel):
    text: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "gated": bool(ACCESS_CODE)}


@app.post("/coach")
def coach(body: CoachRequest, request: Request, x_formiq_code: str | None = Header(default=None)) -> dict:
    _gate(request, x_formiq_code)
    fb = _coach.coach_rep(
        frame_jpeg_b64=body.image_b64,
        angles=body.angles,
        rep_number=body.rep_number,
        phase=body.phase,
    )
    return fb.to_dict()


@app.post("/summary")
def summary(body: SummaryRequest, request: Request, x_formiq_code: str | None = Header(default=None)) -> dict:
    _gate(request, x_formiq_code)
    return _coach.session_summary(rep_history=body.rep_history)


@app.post("/speak")
def speak(body: SpeakRequest, request: Request, x_formiq_code: str | None = Header(default=None)) -> Response:
    _gate(request, x_formiq_code)
    audio = _voice.synthesize(body.text)
    if not audio:
        raise HTTPException(status_code=503, detail="TTS unavailable (no Deepgram key).")
    return Response(content=audio, media_type="audio/mpeg")
