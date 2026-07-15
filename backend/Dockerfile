# ---- Stage 1: Builder ----
FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN uv pip install --system --no-cache --prerelease=allow -r requirements.txt

# Vendor the TikTok recorder into the image so it is always present,
# independent of the host filesystem / git state.
#
# Pinned to a tagged release rather than "main": this upstream repo has open
# issues describing recordings that never stop / never detect the live has
# ended (e.g. #365, #416, #437). Tracking "main" means a rebuild can
# silently pull in an unreleased regression with no changelog to check
# against. Bump this deliberately after checking the release notes at
# https://github.com/Michele0303/tiktok-live-recorder/releases
ARG TIKTOK_RECORDER_REF=7.6.0
RUN git clone --depth 1 --branch "${TIKTOK_RECORDER_REF}" \
    https://github.com/Michele0303/tiktok-live-recorder.git \
    /app/tiktok-live-recorder

COPY alembic.ini ./alembic.ini
COPY alembic/ ./alembic/
COPY app/ ./app/

# ---- Stage 2: Runtime ----
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /app /app

RUN mkdir -p /app/recordings /app/data

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
