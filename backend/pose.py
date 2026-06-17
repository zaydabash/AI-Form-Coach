"""MediaPipe Pose wrapper for FormIQ.

Extracts 33 skeletal landmarks per frame, computes the joint angles that matter
for pushup form, and produces an annotated frame (skeleton + angle readouts) for
both the live feed and the vision payload sent to Claude.

Uses the MediaPipe **Tasks** API (``PoseLandmarker``). The legacy
``mp.solutions.pose`` API was removed in MediaPipe 0.10.35, and the Tasks API
also dropped ``solutions.drawing_utils``, so the skeleton is drawn manually with
OpenCV. Runs on CPU only — no GPU required.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# 33-landmark topology indices (stable across MediaPipe Pose versions).
NOSE = 0
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28

# Body skeleton edges for drawing (torso + arms + legs; face/hands omitted).
POSE_CONNECTIONS = (
    (L_SHOULDER, R_SHOULDER), (L_SHOULDER, L_HIP), (R_SHOULDER, R_HIP), (L_HIP, R_HIP),
    (L_SHOULDER, L_ELBOW), (L_ELBOW, L_WRIST),
    (R_SHOULDER, R_ELBOW), (R_ELBOW, R_WRIST),
    (L_HIP, L_KNEE), (L_KNEE, L_ANKLE),
    (R_HIP, R_KNEE), (R_KNEE, R_ANKLE),
)

# Default model location; override with FORMIQ_POSE_MODEL.
_DEFAULT_MODEL = os.path.join(os.path.dirname(__file__), "models", "pose_landmarker.task")


@dataclass(frozen=True)
class JointAngles:
    """Immutable snapshot of the joint angles for a single frame.

    Angles are in degrees. ``body_planarity_deviation`` is a unitless score in
    normalized image coordinates (0.0 == perfectly straight plank line); larger
    means more sag/pike in the torso.
    """

    left_elbow: Optional[float] = None
    right_elbow: Optional[float] = None
    left_shoulder: Optional[float] = None
    right_shoulder: Optional[float] = None
    left_hip: Optional[float] = None
    right_hip: Optional[float] = None
    body_planarity_deviation: Optional[float] = None
    visibility: float = 0.0  # mean visibility of the landmarks we use [0..1]

    @property
    def mean_elbow(self) -> Optional[float]:
        """Average of both elbow angles, ignoring missing sides."""
        vals = [a for a in (self.left_elbow, self.right_elbow) if a is not None]
        return float(np.mean(vals)) if vals else None

    @property
    def elbow_symmetry(self) -> Optional[float]:
        """Absolute difference between left and right elbow angles (degrees)."""
        if self.left_elbow is None or self.right_elbow is None:
            return None
        return abs(self.left_elbow - self.right_elbow)

    def to_dict(self) -> dict:
        """Compact, JSON-serializable form for the Claude payload and the UI."""

        def r(x: Optional[float], n: int = 1) -> Optional[float]:
            return round(x, n) if x is not None else None

        return {
            "left_elbow": r(self.left_elbow),
            "right_elbow": r(self.right_elbow),
            "left_shoulder": r(self.left_shoulder),
            "right_shoulder": r(self.right_shoulder),
            "left_hip": r(self.left_hip),
            "right_hip": r(self.right_hip),
            "elbow_symmetry": r(self.elbow_symmetry),
            "body_planarity_deviation": r(self.body_planarity_deviation, 3),
            "visibility": r(self.visibility, 2),
        }


@dataclass
class PoseResult:
    """Output of :meth:`PoseEstimator.process` for one frame."""

    annotated_frame: np.ndarray
    angles: JointAngles
    pose_found: bool = False
    landmarks: object = field(default=None, repr=False)


def _angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Interior angle (degrees) at vertex ``b`` formed by points a-b-c."""
    ba = a - b
    bc = c - b
    cosine = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0))))


def _point_line_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """Perpendicular distance from point ``p`` to the line through a and b."""
    ab = b - a
    denom = np.linalg.norm(ab) + 1e-9
    return float(abs(np.cross(ab, p - a)) / denom)


class PoseEstimator:
    """Stateful wrapper around a MediaPipe ``PoseLandmarker`` (VIDEO mode).

    One instance owns one landmarker; it is **not** thread-safe, so keep a single
    instance per active session and call :meth:`process` serially.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        path = model_path or os.getenv("FORMIQ_POSE_MODEL", _DEFAULT_MODEL)
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"Pose model not found at {path}. Download pose_landmarker.task "
                "(see README) or set FORMIQ_POSE_MODEL."
            )
        options = mp_vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=path),
            running_mode=mp_vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self._landmarker = mp_vision.PoseLandmarker.create_from_options(options)
        self._frame_idx = 0
        self._ts_step_ms = 33  # ~30fps spacing; only needs to be monotonic

    def process(self, frame_bgr: np.ndarray) -> PoseResult:
        """Run pose estimation on one BGR frame and annotate it.

        The input frame is not mutated; a copy is annotated and returned.
        """
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # VIDEO mode requires strictly increasing timestamps.
        self._frame_idx += 1
        timestamp_ms = self._frame_idx * self._ts_step_ms
        result = self._landmarker.detect_for_video(mp_image, timestamp_ms)

        annotated = frame_bgr.copy()
        if not result.pose_landmarks:
            self._draw_hud(annotated, JointAngles(), pose_found=False)
            return PoseResult(annotated, JointAngles(), pose_found=False)

        landmarks = result.pose_landmarks[0]  # num_poses=1
        angles = self._compute_angles(landmarks, frame_bgr.shape)
        self._draw_skeleton(annotated, landmarks)
        self._draw_hud(annotated, angles, pose_found=True)

        return PoseResult(
            annotated_frame=annotated,
            angles=angles,
            pose_found=True,
            landmarks=landmarks,
        )

    def _compute_angles(self, lm, shape) -> JointAngles:
        h, w = shape[0], shape[1]

        def pt(idx: int) -> np.ndarray:
            return np.array([lm[idx].x * w, lm[idx].y * h], dtype=np.float64)

        def vis(*idxs: int) -> float:
            return float(np.mean([lm[i].visibility for i in idxs]))

        left_elbow = _angle(pt(L_SHOULDER), pt(L_ELBOW), pt(L_WRIST))
        right_elbow = _angle(pt(R_SHOULDER), pt(R_ELBOW), pt(R_WRIST))
        left_shoulder = _angle(pt(L_ELBOW), pt(L_SHOULDER), pt(L_HIP))
        right_shoulder = _angle(pt(R_ELBOW), pt(R_SHOULDER), pt(R_HIP))
        left_hip = _angle(pt(L_SHOULDER), pt(L_HIP), pt(L_KNEE))
        right_hip = _angle(pt(R_SHOULDER), pt(R_HIP), pt(R_KNEE))

        # Body planarity: deviation of the torso from the straight head->ankle
        # line, normalized by image height so it is resolution-independent.
        shoulder_mid = (pt(L_SHOULDER) + pt(R_SHOULDER)) / 2.0
        hip_mid = (pt(L_HIP) + pt(R_HIP)) / 2.0
        ankle_mid = (pt(L_ANKLE) + pt(R_ANKLE)) / 2.0
        head = pt(NOSE)
        planarity = max(
            _point_line_distance(shoulder_mid, head, ankle_mid),
            _point_line_distance(hip_mid, head, ankle_mid),
        ) / float(h)

        return JointAngles(
            left_elbow=left_elbow,
            right_elbow=right_elbow,
            left_shoulder=left_shoulder,
            right_shoulder=right_shoulder,
            left_hip=left_hip,
            right_hip=right_hip,
            body_planarity_deviation=planarity,
            visibility=vis(L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_HIP, R_HIP),
        )

    @staticmethod
    def _draw_skeleton(frame: np.ndarray, lm) -> None:
        h, w = frame.shape[0], frame.shape[1]

        def px(idx: int) -> tuple[int, int]:
            return int(lm[idx].x * w), int(lm[idx].y * h)

        for a, b in POSE_CONNECTIONS:
            cv2.line(frame, px(a), px(b), (90, 200, 255), 2, cv2.LINE_AA)
        for idx in {i for edge in POSE_CONNECTIONS for i in edge}:
            cv2.circle(frame, px(idx), 4, (0, 255, 120), -1, cv2.LINE_AA)

    @staticmethod
    def _draw_hud(frame: np.ndarray, angles: JointAngles, pose_found: bool) -> None:
        """Overlay a compact angle readout in the top-left corner."""
        if not pose_found:
            cv2.putText(
                frame, "No pose detected", (16, 36),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2, cv2.LINE_AA,
            )
            return

        lines = [
            f"L elbow: {angles.left_elbow:.0f}" if angles.left_elbow else "L elbow: --",
            f"R elbow: {angles.right_elbow:.0f}" if angles.right_elbow else "R elbow: --",
            f"Hip: {angles.left_hip:.0f}" if angles.left_hip else "Hip: --",
            f"Plank dev: {angles.body_planarity_deviation:.3f}"
            if angles.body_planarity_deviation is not None else "Plank dev: --",
        ]
        for i, text in enumerate(lines):
            y = 32 + i * 26
            cv2.putText(frame, text, (16, y), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (0, 0, 0), 3, cv2.LINE_AA)
            cv2.putText(frame, text, (16, y), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (0, 255, 120), 1, cv2.LINE_AA)

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> "PoseEstimator":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
