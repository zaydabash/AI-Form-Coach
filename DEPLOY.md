# Deploying FormIQ (web)

The web build runs the camera + MediaPipe pose **in the browser**; the server is a
small stateless Claude/Deepgram coaching API. Two free services:

- **Frontend (React/Vite)** → Vercel
- **Coach API (FastAPI)** → Render (`web-backend/`)

```
Browser (Vercel)                         Coach API (Render)
  getUserMedia + MediaPipe pose  ──►  /coach  (Claude Haiku)
  rep detection (JS)             ──►  /summary (Claude Opus)
  skeleton overlay               ──►  /speak  (Deepgram, optional)
        ▲ keys never touch the browser; gated by a shared passcode ▲
```

## 0. Push to GitHub

```bash
# from repo root
git add -A && git commit -m "feat: browser-based web build + deploy config"
gh repo create formiq --private --source=. --push   # or create on github.com and push
```

## 1. Deploy the Coach API to Render

1. render.com → **New → Blueprint** → pick this repo. It reads `render.yaml`
   (service `formiq-api`, root `web-backend/`).
2. Set these env vars (dashboard, marked secret):
   - `ANTHROPIC_API_KEY` — your Claude key (required)
   - `DEEPGRAM_API_KEY` — optional (enables `/speak`)
   - `FORMIQ_ACCESS_CODE` — pick any shared passcode (the access gate)
   - `FORMIQ_ALLOWED_ORIGINS` — your Vercel URL, e.g. `https://formiq.vercel.app`
3. Deploy. Note the URL, e.g. `https://formiq-api.onrender.com`. Check `/health`.

> Free Render instances sleep after ~15 min idle; the first request wakes it
> (~30s cold start). Fine for a demo.

## 2. Deploy the frontend to Vercel

1. vercel.com → **Add New → Project** → import this repo.
2. **Root Directory: `frontend`** (important — it's a monorepo).
3. Environment variables:
   - `VITE_API_BASE` = your Render URL (e.g. `https://formiq-api.onrender.com`)
   - `VITE_ACCESS_CODE` = the same passcode as `FORMIQ_ACCESS_CODE` (optional —
     bakes it in so users aren't prompted; omit to require manual entry)
4. Deploy. Open the URL, click **Start Session**, allow the camera.

## 3. After first deploy

- Put the real Vercel URL into Render's `FORMIQ_ALLOWED_ORIGINS` and redeploy
  (CORS). You can list several comma-separated.
- HTTPS is required for camera access — both Vercel and Render give that free.

## Local dev

```bash
# API
cd web-backend && set -a && source ../.env && set +a
../backend/.venv/bin/python -m uvicorn server:app --port 8009
# Frontend (VITE_API_BASE defaults to localhost:8009)
cd frontend && npm run dev
```

## Notes / costs

- Keys live only on Render. The browser sends the passcode header `x-formiq-code`.
- Rate limit: `FORMIQ_RATE_LIMIT_PER_MIN` (default 40/IP/min) caps abuse.
- Each rep = 1 Claude Haiku vision call; each session end = 1 Opus call. Watch
  spend if you make the passcode public.
