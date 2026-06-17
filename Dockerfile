# FormIQ — single-image deployment.
# Builds the React app, then runs the FastAPI coach API which also serves the
# built frontend on the same origin. One image, one service, one URL.

# ---- Stage 1: build the frontend ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
# Same-origin API in prod (api.js defaults to "") — no API base needed.
RUN npm run build

# ---- Stage 2: backend + static ----
FROM python:3.11-slim
WORKDIR /app
COPY web-backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY web-backend/ ./
COPY --from=frontend /app/frontend/dist ./static
ENV FORMIQ_STATIC_DIR=/app/static
# HF Spaces serves on 7860 by default; Render/Fly override $PORT at runtime.
ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
