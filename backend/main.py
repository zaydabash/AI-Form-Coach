"""FastAPI app for FormIQ.

Orchestrates the pipeline: webcam capture -> MediaPipe pose -> rep detection ->
Claude Opus 4.8 coaching -> Deepgram TTS, with Phoenix tracing throughout.

Architecture note: a single background thread owns the webcam and runs pose +
rep detection at ~15fps. When a rep completes, the (slower, ~1-2s) Claude call is
handed off to a thread pool so frame capture never blocks. Coaching results land
in a shared, lock-protected list that the frontend polls.

Endpoints:
    POST /start-session    initialize session + start webcam capture
    POST /stop-session     stop capture and release the webcam
    GET  /frame            latest annotated frame (single JPEG)
    GET  /video            annotated frame as an MJPEG stream (for <img>)
    GET  /state            live joint angles + rep count + phase (poll ~10Hz)
    GET  /reps             all completed reps with coaching (poll ~4Hz)
    GET  /rep-complete     coaching for the most recently completed rep
    GET  /session-summary  final Claude analysis over the full rep history
"""

from __future__ import annotations

import base64
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Optional

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from coach import FormCoach
from pose import PoseEstimator
from reps import RepCounter
from voice import Voice

WEBCAM_INDEX = int(os.getenv("FORMIQ_WEBCAM_INDEX", "0"))
TARGET_FPS = int(os.getenv("FORMIQ_TARGET_FPS", "15"))
JPEG_QUALITY = int(os.getenv("FORMIQ_JPEG_QUALITY", "80"))
# The coaching call gets a downscaled frame — vision latency scales with image
# size, and 512px is plenty for form assessment. The live feed stays full-res.
COACH_IMG_MAX_EDGE = int(os.getenv("FORMIQ_COACH_IMG_MAX_EDGE", "512"))
COACH_JPEG_QUALITY = int(os.getenv("FORMIQ_COACH_JPEG_QUALITY", "75"))


def _encode_for_coach(frame) -> Optional[str]:
    """Downscale + JPEG-encode a frame to base64 for the vision API payload."""
    h, w = frame.shape[:2]
    scale = COACH_IMG_MAX_EDGE / max(h, w)
    if scale < 1.0:
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), COACH_JPEG_QUALITY])
    return base64.standard_b64encode(buf.tobytes()).decode("ascii") if ok else None


@dataclass
class RepResult:
    """A completed rep plus its coaching — the unit the frontend renders."""

    rep_number: int
    form_score: int
    corrections: list[str]
    encouragement: str
    elbow_symmetry: float
    body_planarity_deviation: float
    bottom_elbow_angle: float
    latency_ms: float
    timestamp: float = field(default_factory=time.time)


class Session:
    """Owns the webcam + worker threads + shared state for one workout."""

    def __init__(self) -> None:
        self._pose = PoseEstimator()
        self._reps = RepCounter()
        self._coach = FormCoach()
        self._voice = Voice()

        self._cap: Optional[cv2.VideoCapture] = None
        self._running = False
        self._capture_thread: Optional[threading.Thread] = None
        self._coach_pool = ThreadPoolExecutor(max_workers=2)

        self._lock = threading.Lock()
        self._latest_jpeg: Optional[bytes] = None
        self._latest_angles: dict = {}
        self._rep_results: list[RepResult] = []

    # ---- lifecycle -------------------------------------------------------

    def start(self) -> None:
        if self._running:
            return
        self._cap = cv2.VideoCapture(WEBCAM_INDEX)
        if not self._cap or not self._cap.isOpened():
            raise RuntimeError(f"Could not open webcam at index {WEBCAM_INDEX}")
        self._running = True
        self._capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._capture_thread.start()

    def stop(self) -> None:
        self._running = False
        if self._capture_thread:
            self._capture_thread.join(timeout=2.0)
        if self._cap:
            self._cap.release()
            self._cap = None

    # ---- capture loop ----------------------------------------------------

    def _capture_loop(self) -> None:
        frame_interval = 1.0 / max(TARGET_FPS, 1)
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]

        while self._running and self._cap is not None:
            tick = time.perf_counter()
            ok, frame = self._cap.read()
            if not ok:
                time.sleep(frame_interval)
                continue

            frame = cv2.flip(frame, 1)  # mirror for a natural "selfie" view
            result = self._pose.process(frame)

            ok_enc, buf = cv2.imencode(".jpg", result.annotated_frame, encode_params)
            with self._lock:
                if ok_enc:
                    self._latest_jpeg = buf.tobytes()
                self._latest_angles = {
                    **result.angles.to_dict(),
                    "rep_count": self._reps.count,
                    "phase": self._reps.phase,
                    "pose_found": result.pose_found,
                }

            event = self._reps.update(
                result.angles.mean_elbow,
                planarity_deviation=result.angles.body_planarity_deviation,
                elbow_symmetry=result.angles.elbow_symmetry,
            )
            if event is not None:
                # Hand the Claude call to the pool so capture keeps flowing.
                frame_b64 = _encode_for_coach(result.annotated_frame)
                if frame_b64:
                    angles_payload = {
                        **result.angles.to_dict(),
                        "bottom_elbow_angle": event.bottom_elbow_angle,
                        "worst_planarity_deviation": event.worst_planarity_deviation,
                        "worst_elbow_symmetry": event.worst_elbow_symmetry,
                    }
                    self._coach_pool.submit(self._coach_rep, event, frame_b64, angles_payload)

            # Pace the loop to roughly TARGET_FPS.
            elapsed = time.perf_counter() - tick
            if elapsed < frame_interval:
                time.sleep(frame_interval - elapsed)

    def _coach_rep(self, event, frame_b64: str, angles_payload: dict) -> None:
        feedback = self._coach.coach_rep(
            frame_jpeg_b64=frame_b64,
            angles=angles_payload,
            rep_number=event.rep_number,
            phase=event.phase,
        )
        # Speak the most important cue + encouragement.
        spoken = feedback.encouragement
        if feedback.corrections:
            spoken = f"{feedback.corrections[0]} {feedback.encouragement}"
        self._voice.speak(spoken)

        rep = RepResult(
            rep_number=event.rep_number,
            form_score=feedback.form_score,
            corrections=feedback.corrections,
            encouragement=feedback.encouragement,
            elbow_symmetry=event.worst_elbow_symmetry,
            body_planarity_deviation=event.worst_planarity_deviation,
            bottom_elbow_angle=event.bottom_elbow_angle,
            latency_ms=feedback.latency_ms,
        )
        with self._lock:
            self._rep_results.append(rep)

    # ---- accessors -------------------------------------------------------

    def latest_jpeg(self) -> Optional[bytes]:
        with self._lock:
            return self._latest_jpeg

    def state(self) -> dict:
        with self._lock:
            return {"running": self._running, **self._latest_angles}

    def reps(self) -> list[dict]:
        with self._lock:
            return [asdict(r) for r in self._rep_results]

    def summary(self) -> dict:
        with self._lock:
            history = [
                {
                    "rep_number": r.rep_number,
                    "form_score": r.form_score,
                    "elbow_symmetry": r.elbow_symmetry,
                    "body_planarity_deviation": r.body_planarity_deviation,
                    "bottom_elbow_angle": r.bottom_elbow_angle,
                    "corrections": r.corrections,
                }
                for r in self._rep_results
            ]
        return self._coach.session_summary(rep_history=history)


# --------------------------------------------------------------------------
# FastAPI wiring
# --------------------------------------------------------------------------

app = FastAPI(title="FormIQ", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local single-user app; tighten for any real deploy
    allow_methods=["*"],
    allow_headers=["*"],
)

# A single active session for this local app.
_session: Optional[Session] = None


def _require_session() -> Session:
    if _session is None:
        raise HTTPException(status_code=409, detail="No active session. POST /start-session first.")
    return _session


@app.post("/start-session")
def start_session() -> dict:
    global _session
    if _session is not None:
        _session.stop()
    _session = Session()
    try:
        _session.start()
    except RuntimeError as exc:
        _session = None
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "started", "webcam_index": WEBCAM_INDEX}


@app.post("/stop-session")
def stop_session() -> dict:
    global _session
    if _session is not None:
        _session.stop()
        _session = None
    return {"status": "stopped"}


@app.get("/frame")
def frame():
    session = _require_session()
    jpeg = session.latest_jpeg()
    if jpeg is None:
        raise HTTPException(status_code=503, detail="No frame captured yet.")
    return StreamingResponse(iter([jpeg]), media_type="image/jpeg")


@app.get("/video")
def video():
    session = _require_session()

    def gen():
        boundary = b"--frame"
        interval = 1.0 / max(TARGET_FPS, 1)
        while True:
            jpeg = session.latest_jpeg()
            if jpeg is not None:
                yield (
                    boundary + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n"
                    + jpeg + b"\r\n"
                )
            time.sleep(interval)

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/state")
def state() -> dict:
    return _require_session().state()


@app.get("/reps")
def reps() -> dict:
    return {"reps": _require_session().reps()}


@app.get("/rep-complete")
def rep_complete() -> dict:
    all_reps = _require_session().reps()
    if not all_reps:
        return {"rep": None}
    return {"rep": all_reps[-1]}


@app.get("/session-summary")
def session_summary() -> JSONResponse:
    return JSONResponse(_require_session().summary())


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "session_active": _session is not None}
