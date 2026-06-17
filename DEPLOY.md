# Deploying FormIQ

FormIQ ships as **one Docker image**: the FastAPI service serves the React app
*and* the coach API on a single origin. The browser does camera + MediaPipe pose;
the server only does the Claude/Deepgram calls (keys stay server-side).

## Live deployment — Hugging Face Space (current)

Deployed as a private Docker Space: **https://huggingface.co/spaces/zaydabash/formiq**
(app URL: `https://zaydabash-formiq.hf.space`).

- Secrets live in **Settings → Variables and secrets**: `ANTHROPIC_API_KEY`,
  `DEEPGRAM_API_KEY`, plus `FORMIQ_REP_MODEL` / `FORMIQ_SUMMARY_MODEL` variables.
- It's **private** (only you). The passcode gate is off because only you can
  reach it. To make it public: Space Settings → change visibility, then add a
  `FORMIQ_ACCESS_CODE` secret so visitors must enter a code.

### Redeploy after code changes

```bash
# rebuild the clean upload dir and push (triggers a Docker rebuild)
python3 - <<'PY'
from huggingface_hub import HfApi
HfApi().upload_folder(folder_path="/tmp/formiq-space", repo_id="zaydabash/formiq",
                      repo_type="space", commit_message="update")
PY
```
(Regenerate `/tmp/formiq-space` from `Dockerfile` + `frontend/` + `web-backend/`
+ the Space `README.md`, excluding `node_modules`/`dist`/`.env`.)

## Alternative — Render (one Docker service)

`render.yaml` defines a single Docker web service. render.com → New → Blueprint →
pick the repo → set `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `FORMIQ_ACCESS_CODE`.
One URL, free tier (sleeps when idle).

## Local dev

```bash
# API only (frontend runs separately via Vite on :5173)
cd web-backend && set -a && source ../.env && set +a
../backend/.venv/bin/python -m uvicorn server:app --port 8009
cd frontend && npm run dev

# Or the single-image path: build the app, let FastAPI serve it
cd frontend && npm run build
cd ../web-backend && FORMIQ_STATIC_DIR=$PWD/../frontend/dist \
  ../backend/.venv/bin/python -m uvicorn server:app --port 8009   # open :8009
```

## Notes

- HTTPS is required for camera (`getUserMedia`); HF and Render both provide it.
- Each rep = 1 Claude Haiku vision call; session end = 1 Opus call. The per-IP
  rate limit (`FORMIQ_RATE_LIMIT_PER_MIN`, default 40) caps abuse on public deploys.
