# Deploying FormIQ

FormIQ ships as one Docker image: the FastAPI service serves the built React app
and the coach API on the same origin. The browser does the camera and pose work;
the server only makes the model and text-to-speech calls (keys stay server-side).

## Build and run the image

```bash
docker build -t formiq .
docker run -p 8000:7860 \
  -e LLM_API_KEY=... \
  -e FORMIQ_REP_MODEL=... \
  -e FORMIQ_SUMMARY_MODEL=... \
  -e DEEPGRAM_API_KEY=... \
  -e FORMIQ_ACCESS_CODE=... \
  formiq
# open http://localhost:8000
```

## Deploy to a container host

Any host that builds a Dockerfile works (Render, Fly, a Docker-based Space, etc.).

- Point the host at this repo's `Dockerfile`.
- Set the env vars above as secrets in the host dashboard.
- The container listens on `$PORT` (default 7860).
- Health check path: `/health`.

`render.yaml` is included as a one-service blueprint for Render.

## Notes

- HTTPS is required for camera access; managed hosts provide it.
- The access passcode gate is optional. With it set, the browser prompts once and
  stores the code locally; without it, the API is open (rely on the rate limit).
- Each rep is one model vision call; each session end is one summary call. The
  per-IP rate limit caps abuse on public deployments.

## Local dev (without Docker)

```bash
# Single-image behavior: build the app, let the API serve it
cd frontend && npm run build
cd ../web-backend && FORMIQ_STATIC_DIR=$PWD/../frontend/dist \
  uvicorn server:app --port 8009    # open http://localhost:8009
```
