// Browser-side MediaPipe PoseLandmarker wrapper.
// Loads the WASM fileset + lite pose model from CDN, runs in VIDEO mode, and
// draws the skeleton. This is what replaces the server-side pose.py on the web.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { CONNECTIONS } from "./angles.js";

// Pin the WASM to the installed JS version to avoid ABI mismatches.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

export async function createPoseEngine() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return {
    // Returns the first pose's landmark array (or null).
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      return result?.landmarks?.[0] ?? null;
    },
    close() {
      landmarker.close();
    },
  };
}

// Draw skeleton + joints onto a 2D canvas context sized to (w, h).
export function drawSkeleton(ctx, landmarks, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  ctx.save();
  ctx.strokeStyle = "rgba(161,161,170,0.9)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(161,161,170,0.6)";
  ctx.shadowBlur = 8;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
    ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#e5e2e1";
  const joints = new Set(CONNECTIONS.flat());
  for (const i of joints) {
    ctx.beginPath();
    ctx.arc(landmarks[i].x * w, landmarks[i].y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
