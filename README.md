# FormIQ — AI Fitness Form Coach

Real-time pushup form coaching. Your webcam feeds MediaPipe Pose, joint angles
drive a rep detector, and **Claude Opus 4.8** acts as a vision-based coaching
brain — scoring each rep, giving specific corrections, and speaking them aloud
via Deepgram TTS. Every coaching call is traced with Arize Phoenix.

```
webcam → OpenCV → MediaPipe Pose → joint angles → rep detection
                                                      │
                                          Claude Opus 4.8 (vision)
                                                      │
                          form score + corrections + encouragement
                                                      │
                                    Deepgram TTS (spoken)  ·  Phoenix (traced)
```

## Architecture

| Module | Responsibility |
|--------|----------------|
| `backend/pose.py` | MediaPipe wrapper: 33 landmarks → elbow/shoulder/hip angles + body planarity; annotated frame |
| `backend/reps.py` | up→down→up rep state machine with hysteresis |
| `backend/coach.py` | Claude Opus 4.8 vision call → form score, corrections, encouragement |
| `backend/voice.py` | Deepgram TTS, non-blocking playback |
| `backend/tracer.py` | Arize Phoenix / OpenTelemetry setup (degrades to no-op) |
| `backend/main.py` | FastAPI app + background capture loop |
| `frontend/` | React + recharts UI: live feed, angle readouts, coaching, rep curve |

The webcam → pose → rep-detection loop runs on a background thread at ~15fps.
When a rep completes, the slower (~1–2s) Claude call is dispatched to a thread
pool so frame capture never stalls — keeping the feedback loop near the sub-2s
target.

## Rep detection

Driven by mean elbow angle with hysteresis:

- **down** when elbow angle < 90°
- **up** when elbow angle > 150°
- a rep counts on a full **up → down → up** transition

Per rep we track form score, elbow symmetry, and body-planarity deviation.

## Setup

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Download the MediaPipe pose model (Tasks API needs this; ~5.5MB, not bundled)
mkdir -p models
curl -L -o models/pose_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task

cp ../.env.example ../.env   # then fill in ANTHROPIC_API_KEY (+ DEEPGRAM_API_KEY)
set -a && source ../.env && set +a

# Optional: local Phoenix for traces (http://localhost:6006)
# pip install arize-phoenix && phoenix serve &

uvicorn main:app --reload --port 8000
```

> On macOS, grant your terminal **Camera** permission (System Settings →
> Privacy & Security → Camera) or webcam capture will fail silently.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

Open the UI, click **Start session**, and do pushups facing the camera from the
side so your full body (head → ankles) is visible.

## API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/start-session` | open webcam, start capture loop |
| POST | `/stop-session` | stop and release the webcam |
| GET | `/frame` | latest annotated frame (single JPEG) |
| GET | `/video` | annotated MJPEG stream (used by the live feed) |
| GET | `/state` | live joint angles + rep count + phase |
| GET | `/reps` | all completed reps with coaching |
| GET | `/rep-complete` | coaching for the most recent rep |
| GET | `/session-summary` | final Claude analysis over the session |

## Environment variables

| Variable | Required | Default |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | ✅ | — |
| `DEEPGRAM_API_KEY` | optional (silent without it) | — |
| `ARIZE_PHOENIX_ENDPOINT` | optional | `http://localhost:6006` |
| `ANTHROPIC_MODEL` | optional | `claude-opus-4-8` |
| `FORMIQ_WEBCAM_INDEX` | optional | `0` |
| `FORMIQ_TARGET_FPS` | optional | `15` |

## Notes

- MediaPipe runs on CPU — no GPU needed. It pins `numpy<2`.
- Tracing, TTS, and Phoenix are all optional; the workout loop runs without them.
