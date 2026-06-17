"""Claude Opus 4.8 coaching brain for FormIQ.

Takes the annotated frame at the moment a rep completes plus the measured joint
angles, and returns a structured coaching verdict: a 0-100 form score, 2-3
specific corrections, and one line of encouragement.

Latency matters (target: sub-2s feedback loop), so the prompt is deliberately
terse, ``max_tokens`` is small, and we prefill the assistant turn with ``{`` to
force JSON-only output (no preamble to generate or strip).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Optional

import anthropic

from tracer import get_tracer

# Hybrid model strategy: a fast model for the latency-sensitive per-rep call
# (sub-2s target) and a deep-reasoning model for the end-of-session summary,
# where latency doesn't matter. Both overridable via env.
REP_MODEL = os.getenv("FORMIQ_REP_MODEL", "claude-haiku-4-5")
SUMMARY_MODEL = os.getenv("FORMIQ_SUMMARY_MODEL", "claude-opus-4-8")

# Concise system prompt — every token here is paid on each rep.
SYSTEM_PROMPT = (
    "You are FormIQ, an elite calisthenics coach analyzing a single pushup rep "
    "from one image plus measured joint angles. Be specific and actionable. "
    "Reference real body parts and angles, not generic advice. "
    "Respond ONLY with minified JSON matching exactly this schema:\n"
    '{"form_score": <int 0-100>, '
    '"corrections": [<2-3 short imperative strings>], '
    '"encouragement": "<one short motivating line>"}'
)

# Reference cues so the model grades consistently across reps.
_RUBRIC = (
    "Grading cues: full depth ~ bottom elbow <90 deg; full lockout ~ top elbow "
    ">150 deg; elbow_symmetry >15 deg means uneven push; "
    "body_planarity_deviation >0.05 means sagging/piking hips."
)


@dataclass(frozen=True)
class CoachingFeedback:
    """Structured result of a single coaching call."""

    form_score: int
    corrections: list[str]
    encouragement: str
    latency_ms: float
    model: str = REP_MODEL
    raw: str = field(default="", repr=False)

    def to_dict(self) -> dict:
        return {
            "form_score": self.form_score,
            "corrections": self.corrections,
            "encouragement": self.encouragement,
            "latency_ms": round(self.latency_ms, 1),
            "model": self.model,
        }


def _fallback(latency_ms: float, reason: str) -> CoachingFeedback:
    """Safe, UI-renderable result when the model call or parse fails."""
    return CoachingFeedback(
        form_score=0,
        corrections=["Coaching unavailable for this rep — keep your core tight."],
        encouragement="Keep going!",
        latency_ms=latency_ms,
        raw=reason,
    )


def _coerce(payload: dict, latency_ms: float, raw: str) -> CoachingFeedback:
    """Validate/normalize the model's JSON into a CoachingFeedback."""
    try:
        score = int(round(float(payload.get("form_score", 0))))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    corrections = payload.get("corrections") or []
    if isinstance(corrections, str):
        corrections = [corrections]
    corrections = [str(c).strip() for c in corrections if str(c).strip()][:3]
    if not corrections:
        corrections = ["No major issues detected — maintain this form."]

    encouragement = str(payload.get("encouragement") or "Strong work!").strip()

    return CoachingFeedback(
        form_score=score,
        corrections=corrections,
        encouragement=encouragement,
        latency_ms=latency_ms,
        raw=raw,
    )


class FormCoach:
    """Wraps the Anthropic client for per-rep and end-of-session coaching."""

    def __init__(self, client: Optional[anthropic.Anthropic] = None) -> None:
        # Client reads ANTHROPIC_API_KEY from the environment.
        self._client = client or anthropic.Anthropic()
        self._tracer = get_tracer()

    def coach_rep(
        self,
        *,
        frame_jpeg_b64: str,
        angles: dict,
        rep_number: int,
        phase: str,
        max_tokens: int = 300,
    ) -> CoachingFeedback:
        """Score one completed rep and return corrections + encouragement.

        ``frame_jpeg_b64`` is a base64-encoded JPEG of the annotated frame at the
        moment of rep completion. ``angles`` is :meth:`JointAngles.to_dict`.
        """
        user_text = (
            f"Rep #{rep_number} just completed (phase: {phase}).\n"
            f"Measured joint angles (degrees, normalized planarity):\n"
            f"{json.dumps(angles, separators=(',', ':'))}\n"
            f"{_RUBRIC}\n"
            "Score THIS rep and give 2-3 corrections."
        )

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": frame_jpeg_b64,
                        },
                    },
                    {"type": "text", "text": user_text},
                ],
            },
        ]

        with self._tracer.start_as_current_span("formiq.coach_rep") as span:
            span.set_attribute("rep_number", rep_number)
            span.set_attribute("phase", phase)
            span.set_attribute("joint_angles", json.dumps(angles))
            span.set_attribute("model", REP_MODEL)

            start = time.perf_counter()
            try:
                resp = self._client.messages.create(
                    model=REP_MODEL,
                    max_tokens=max_tokens,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                )
            except anthropic.APIError as exc:
                latency_ms = (time.perf_counter() - start) * 1000
                span.set_attribute("error", str(exc))
                span.set_attribute("latency_ms", latency_ms)
                return _fallback(latency_ms, f"api_error: {exc}")

            latency_ms = (time.perf_counter() - start) * 1000
            raw = resp.content[0].text

            feedback = self._parse(raw, latency_ms)
            span.set_attribute("form_score", feedback.form_score)
            span.set_attribute("latency_ms", latency_ms)
            if resp.usage:
                span.set_attribute("input_tokens", resp.usage.input_tokens)
                span.set_attribute("output_tokens", resp.usage.output_tokens)
            return feedback

    def session_summary(self, *, rep_history: list[dict], max_tokens: int = 500) -> dict:
        """Final analysis over the full rep history (text-only, no image).

        Returns a dict with avg_score, most_common_error, best_rep, and a short
        narrative ``summary``.
        """
        # Deterministic stats so the UI has numbers even if the model wanders.
        scores = [r.get("form_score", 0) for r in rep_history] or [0]
        avg_score = round(sum(scores) / len(scores), 1)
        best_rep = max(
            range(len(rep_history)),
            key=lambda i: rep_history[i].get("form_score", 0),
            default=0,
        ) + 1 if rep_history else 0

        prompt = (
            "Here is the full pushup session, one object per rep:\n"
            f"{json.dumps(rep_history, separators=(',', ':'))}\n"
            "Respond ONLY with minified JSON: "
            '{"summary": "<2-3 sentence coaching takeaway>", '
            '"most_common_error": "<short phrase>", '
            '"focus_next_session": "<short phrase>"}'
        )

        with self._tracer.start_as_current_span("formiq.session_summary") as span:
            span.set_attribute("rep_count", len(rep_history))
            span.set_attribute("avg_score", avg_score)
            start = time.perf_counter()
            try:
                resp = self._client.messages.create(
                    model=SUMMARY_MODEL,
                    max_tokens=max_tokens,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = resp.content[0].text
                payload = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
            except (anthropic.APIError, json.JSONDecodeError) as exc:
                span.set_attribute("error", str(exc))
                payload = {
                    "summary": "Session complete. Review your per-rep scores above.",
                    "most_common_error": "n/a",
                    "focus_next_session": "Consistency",
                }
            span.set_attribute("latency_ms", (time.perf_counter() - start) * 1000)

        return {
            "avg_score": avg_score,
            "best_rep": best_rep,
            "rep_count": len(rep_history),
            **payload,
        }

    @staticmethod
    def _parse(raw: str, latency_ms: float) -> CoachingFeedback:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            # The model may wrap JSON in prose or ```json fences; extract the
            # outermost {...} object and parse that.
            try:
                payload = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
            except (ValueError, json.JSONDecodeError):
                return _fallback(latency_ms, f"parse_error: {raw[:120]}")
        return _coerce(payload, latency_ms, raw)
