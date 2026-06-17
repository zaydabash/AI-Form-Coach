"""Pushup rep detection state machine for FormIQ.

Phases are driven by the mean elbow angle with built-in hysteresis (the dead
zone between the two thresholds prevents jitter near a single cutoff):

    "down"  when mean elbow angle < DOWN_THRESHOLD (90 deg)
    "up"    when mean elbow angle > UP_THRESHOLD  (150 deg)

A rep is counted on a complete up -> down -> up transition. While the lifter is
in the bottom of the rep, we accumulate the metrics worth grading: the deepest
elbow angle reached, worst body-planarity deviation, and worst elbow asymmetry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

DOWN_THRESHOLD = 90.0
UP_THRESHOLD = 150.0


@dataclass(frozen=True)
class RepEvent:
    """Emitted the instant a rep completes (up -> down -> up)."""

    rep_number: int
    phase: str  # always "up" at completion; included for the coaching payload
    bottom_elbow_angle: float          # deepest (smallest) elbow angle in the rep
    worst_planarity_deviation: float   # max torso sag/pike during the rep
    worst_elbow_symmetry: float        # max L/R elbow angle gap during the rep


class RepCounter:
    """Stateful per-session rep detector. Feed it one frame's angles at a time."""

    def __init__(self) -> None:
        self._count = 0
        self._phase = "unknown"   # "unknown" | "up" | "down"
        self._seen_down = False   # saw a valid bottom since the last top
        # Per-rep accumulators, reset when a new descent begins.
        self._bottom_elbow = 180.0
        self._worst_planarity = 0.0
        self._worst_symmetry = 0.0

    @property
    def count(self) -> int:
        return self._count

    @property
    def phase(self) -> str:
        return self._phase

    def update(
        self,
        mean_elbow: Optional[float],
        *,
        planarity_deviation: Optional[float] = None,
        elbow_symmetry: Optional[float] = None,
    ) -> Optional[RepEvent]:
        """Advance the state machine; return a RepEvent iff a rep just completed."""
        if mean_elbow is None:
            return None

        # Accumulate "worst case" metrics continuously while a rep is in flight.
        self._bottom_elbow = min(self._bottom_elbow, mean_elbow)
        if planarity_deviation is not None:
            self._worst_planarity = max(self._worst_planarity, planarity_deviation)
        if elbow_symmetry is not None:
            self._worst_symmetry = max(self._worst_symmetry, elbow_symmetry)

        if mean_elbow < DOWN_THRESHOLD:
            # Entering / staying at the bottom.
            if self._phase != "down":
                self._phase = "down"
                self._seen_down = True
            return None

        if mean_elbow > UP_THRESHOLD:
            completed = self._phase == "down" and self._seen_down
            self._phase = "up"
            if completed:
                event = self._emit()
                self._reset_rep_metrics()
                return event
            return None

        # In the dead zone between thresholds: hold current phase (hysteresis).
        return None

    def _emit(self) -> RepEvent:
        self._count += 1
        return RepEvent(
            rep_number=self._count,
            phase="up",
            bottom_elbow_angle=round(self._bottom_elbow, 1),
            worst_planarity_deviation=round(self._worst_planarity, 3),
            worst_elbow_symmetry=round(self._worst_symmetry, 1),
        )

    def _reset_rep_metrics(self) -> None:
        self._seen_down = False
        self._bottom_elbow = 180.0
        self._worst_planarity = 0.0
        self._worst_symmetry = 0.0
