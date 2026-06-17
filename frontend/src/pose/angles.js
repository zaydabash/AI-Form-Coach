// Joint-angle math for FormIQ - ported 1:1 from the Python backend (pose.py).
// Operates on MediaPipe Tasks landmarks (normalized {x,y,z,visibility}).

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

// Body skeleton edges (torso + arms + legs) for drawing.
export const CONNECTIONS = [
  [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP], [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

function angle(a, b, c) {
  const baX = a[0] - b[0], baY = a[1] - b[1];
  const bcX = c[0] - b[0], bcY = c[1] - b[1];
  const dot = baX * bcX + baY * bcY;
  const mag = Math.hypot(baX, baY) * Math.hypot(bcX, bcY) + 1e-9;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function pointLineDistance(p, a, b) {
  const abX = b[0] - a[0], abY = b[1] - a[1];
  const denom = Math.hypot(abX, abY) + 1e-9;
  const cross = abX * (p[1] - a[1]) - abY * (p[0] - a[0]);
  return Math.abs(cross) / denom;
}

const round = (x, n = 1) => (x == null ? null : Number(x.toFixed(n)));

// landmarks: array of {x,y,z,visibility}; w,h = pixel dimensions of the frame.
export function computeAngles(landmarks, w, h) {
  const pt = (i) => [landmarks[i].x * w, landmarks[i].y * h];
  const vis = (...idx) => idx.reduce((s, i) => s + (landmarks[i].visibility ?? 0), 0) / idx.length;

  const left_elbow = angle(pt(LM.L_SHOULDER), pt(LM.L_ELBOW), pt(LM.L_WRIST));
  const right_elbow = angle(pt(LM.R_SHOULDER), pt(LM.R_ELBOW), pt(LM.R_WRIST));
  const left_shoulder = angle(pt(LM.L_ELBOW), pt(LM.L_SHOULDER), pt(LM.L_HIP));
  const right_shoulder = angle(pt(LM.R_ELBOW), pt(LM.R_SHOULDER), pt(LM.R_HIP));
  const left_hip = angle(pt(LM.L_SHOULDER), pt(LM.L_HIP), pt(LM.L_KNEE));
  const right_hip = angle(pt(LM.R_SHOULDER), pt(LM.R_HIP), pt(LM.R_KNEE));

  const shoulderMid = [(pt(LM.L_SHOULDER)[0] + pt(LM.R_SHOULDER)[0]) / 2, (pt(LM.L_SHOULDER)[1] + pt(LM.R_SHOULDER)[1]) / 2];
  const hipMid = [(pt(LM.L_HIP)[0] + pt(LM.R_HIP)[0]) / 2, (pt(LM.L_HIP)[1] + pt(LM.R_HIP)[1]) / 2];
  const ankleMid = [(pt(LM.L_ANKLE)[0] + pt(LM.R_ANKLE)[0]) / 2, (pt(LM.L_ANKLE)[1] + pt(LM.R_ANKLE)[1]) / 2];
  const head = pt(LM.NOSE);
  const planarity =
    Math.max(pointLineDistance(shoulderMid, head, ankleMid), pointLineDistance(hipMid, head, ankleMid)) / h;

  const mean_elbow = (left_elbow + right_elbow) / 2;
  const elbow_symmetry = Math.abs(left_elbow - right_elbow);

  return {
    left_elbow: round(left_elbow), right_elbow: round(right_elbow),
    left_shoulder: round(left_shoulder), right_shoulder: round(right_shoulder),
    left_hip: round(left_hip), right_hip: round(right_hip),
    elbow_symmetry: round(elbow_symmetry),
    body_planarity_deviation: round(planarity, 3),
    visibility: round(vis(LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_HIP, LM.R_HIP), 2),
    mean_elbow,
  };
}
