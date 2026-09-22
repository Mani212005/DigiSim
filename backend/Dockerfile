# DigiSim backend — Flask API (YOLO detection + circuit pipeline) on Render.
# Single worker: the ML stack (torch/onnx/rapidocr) is memory-heavy, so scale
# vertically (Render plan) before adding gunicorn workers. CPU-only: no GPU
# steps here; torch runs on CPU and /detect_gates can use Roboflow cloud.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Locked deps first for layer caching. --no-install-project: the app runs as
# top-level modules (app.py, auth.py, pipeline/...) from WORKDIR, it is not
# an installed package.
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev --no-install-project \
    && rm -rf /root/.cache/uv

COPY . .

# Render injects $PORT at runtime; 5001 matches local dev (app.py fallback).
EXPOSE 5001

CMD ["sh", "-c", ".venv/bin/gunicorn app:app --bind 0.0.0.0:${PORT:-5001} --workers 1 --threads 4 --timeout 120 --access-logfile -"]
