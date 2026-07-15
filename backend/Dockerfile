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
# Pinned to a specific commit SHA rather than a tag or "main": every tagged
# release up to and including 8.0.0 ships a naive is_room_alive() that trusts
# a single "check_alive" boolean with no cross-check, causing ended rooms to
# be reported as still live (root cause of recordings starting/running for
# users who are not actually live). The maintainer fixed this upstream in
# commit 98dfde24 ("fix: reject ended TikTok rooms with stale streams") and a
# same-day follow-up 898c2320 ("fix: try alternate live stream urls") — but
# neither has been tagged in a release yet. Pinning to the exact commit SHA
# (instead of floating "main") gets today's real fix while keeping the build
# reproducible and immune to unrelated future drift. Re-evaluate and switch
# back to tracking tags once this fix ships in an official release:
# https://github.com/Michele0303/tiktok-live-recorder/releases
ARG TIKTOK_RECORDER_REF=898c2320c07674f7cd8b1d5f198da80091fef2a1
RUN git init /app/tiktok-live-recorder && \
    cd /app/tiktok-live-recorder && \
    git remote add origin https://github.com/Michele0303/tiktok-live-recorder.git && \
    git fetch --depth 1 origin "${TIKTOK_RECORDER_REF}" && \
    git checkout FETCH_HEAD

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
