# FormIQ

FormIQ is a real-time pushup form coach. Your webcam runs pose tracking in the
browser, the joint angles drive a rep detector, and an AI vision model scores
each rep with specific corrections and a line of encouragement. Spoken feedback
is optional.

## Screens

- Live Coach: webcam feed with a skeleton overlay, a live telemetry panel
  (joint angles, symmetry, rep count), and a coaching bar.
- Session History: a dashboard of past sessions and aggregate stats.
- Session Summary: an improvement curve, derived diagnostics, and a best-rep
  breakdown for the session you just finished.

## How it works

```
browser webcam -> pose tracking (WASM) -> joint angles -> rep detection
                                                            |
                                           coach API: AI vision model
                                                            |
                            form score + corrections + encouragement
```

The browser captures the camera and runs pose tracking and rep detection
locally, so no video ever leaves the device. When a rep completes, the annotated
frame and joint angles are sent to a small stateless API that returns the
coaching verdict.

Rep detection uses the mean elbow angle with hysteresis:

- down when the elbow angle drops below 90 degrees
- up when it rises above 150 degrees
- a rep counts on a full up -> down -> up transition

Per rep it tracks form score, elbow symmetry, and body-planarity deviation.

## Project layout

| Path | Responsibility |
|------|----------------|
| `frontend/` | React + Vite app. Browser camera, pose tracking, rep detection, and the three-screen UI. |
| `frontend/src/pose/` | Pose engine (WASM), joint-angle math, and the rep state machine. |
| `web-backend/` | Stateless FastAPI coach API (`/coach`, `/summary`, `/speak`). Also serves the built frontend in the single-image deploy. |
| `backend/` | Alternate local mode that runs pose tracking server-side from a local webcam. |

## Run locally

The coach API and the frontend run separately in dev.

```bash
# API
cd web-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env   # fill in LLM_API_KEY + model ids
set -a && source ../.env && set +a
uvicorn server:app --port 8009

# Frontend (new terminal)
cd frontend
npm install
npm run dev   # http://localhost:5173
```

Open the app, click Start Session, allow camera access, and do pushups facing
the camera from the side so your full body is visible. Camera access requires
HTTPS or localhost.

## Deploy

FormIQ ships as a single Docker image (the API serves the built frontend on the
same origin). See [DEPLOY.md](DEPLOY.md).

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `LLM_API_KEY` | yes | API key for the coaching model provider |
| `FORMIQ_REP_MODEL` | yes | fast model id, scored per rep |
| `FORMIQ_SUMMARY_MODEL` | yes | deeper model id, used for the summary |
| `DEEPGRAM_API_KEY` | no | enables spoken feedback |
| `FORMIQ_ACCESS_CODE` | no | shared passcode gate for the API |
| `FORMIQ_RATE_LIMIT_PER_MIN` | no | per-IP request cap (default 40) |
