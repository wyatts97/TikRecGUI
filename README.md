<div align="center">
  <h1>TikRec WebUI</h1>
  <p><strong>A modern web interface for <a href="https://github.com/Michele0303/tiktok-live-recorder">tiktok-live-recorder</a></strong></p>
  <p>
    <a href="#features">Features</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#configuration">Configuration</a> •
    <a href="#development">Development</a> •
    <a href="#api-endpoints">API</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Status-Development-yellow" alt="Status">
    <img src="https://img.shields.io/github/license/Michele0303/tiktok-live-recorder" alt="License">
  </p>
</div>

---

Monitor, record, and replay TikTok live streams from your browser. TikRec WebUI wraps the [tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder) engine with a real-time dashboard, video player with transcript and chat replay, and full recording management — all running in Docker.

---

## Features

### 📺 Dashboard
- Real-time overview of currently live users from your watchlist
- Active recording status and system health at a glance
- Quick-access record button for any live user

### 👥 Watchlist
- Add and manage TikTok users to monitor for live streams
- Automatic avatar fetching with retry and backoff
- Live status indicators per user
- Refresh user profile data on demand

### ⏺️ Recording
- Start/stop recordings with one click
- Supports manual and automatic recording modes
- Configurable recording duration and bitrate
- FFmpeg-based remuxing into MP4
- Automatic video repair for corrupted recordings
- Video sprite generation for timeline previews

### 🎬 Playback & Review
- Full video player with seek, pause, and resume
- **Transcript panel** with automatic speech-to-text (Whisper)
  - Searchable, timestamped transcript with click-to-seek
  - Export to SRT or TXT format
- **Chat & gift replay** — live chat and gift events captured during recording
  - Filterable by chat/gifts/all
  - Search by username or message content
  - Click timestamps to jump to that point in the video
  - Polls in real time for active recordings

### ✂️ Clips
- Create video clips from recordings
- Thumbnail and sprite generation for clips
- Download individual clips

### ⚙️ Settings
- Configure TikTok cookies (`sessionid_ss`) for authenticated access
- HTTP proxy support for region-restricted environments
- Telegram integration for automatic uploads
- Configurable default bitrate and monitoring intervals

---

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────────────┐
│  Browser │────▶│  Nginx   │────▶│  FastAPI Backend │
│  (React) │     │  (Proxy) │     │  (Port 8000)     │
└──────────┘     └──────────┘     └────────┬─────────┘
          Port 3000                         │
                                           ▼
                                   ┌──────────────────┐
                                   │  TikTok Recorder │
                                   │  (Python Engine) │
                                   └──────────────────┘
                                           │
                                           ▼
                                   ┌──────────────────┐
                                   │    TikTok Live    │
                                   └──────────────────┘
```

- **Frontend** (React + Vite) served by Nginx on port 3000
- **Backend** (FastAPI + SQLAlchemy) on port 8000
- **Recorder** bundled Python engine for TikTok stream access
- **Live chat** captured via TikTokLive WebSocket in a background thread
- All data stored in SQLite via volume mounts

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite 6, Tailwind CSS 4 |
| **UI Components** | Base UI React, Lucide Icons, Preline |
| **Data & State** | TanStack React Query, react-data-table-component |
| **Video Player** | Vidstack React |
| **Backend** | Python 3.13, FastAPI, Uvicorn |
| **Database** | SQLAlchemy 2.x, SQLite, Alembic |
| **Transcription** | faster-whisper (Whisper ASR) |
| **Container** | Docker, Docker Compose |
| **Recorder** | [tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder) |
| **Live Chat** | TikTokLive Python library |
| **Avatar Fetch** | tiktok-scraper (CLI), HTML scraper fallback |

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### Setup

```bash
# 1. Create the required data directories
mkdir -p recordings data

# 2. Start the stack
docker compose up -d

# 3. Access the WebUI
open http://localhost:3000
```

The backend will automatically:
- Run database migrations (Alembic)
- Start the monitoring service
- Be ready to accept requests

### Services

| Service   | URL                        |
|-----------|----------------------------|
| Frontend  | http://localhost:3000       |
| API       | http://localhost:8000       |
| API Docs  | http://localhost:8000/docs  |

### Environment Variables

All configuration is handled through the **Settings page** in the UI or the `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./data/tikrec.db` | SQLite database path |
| `RECORDINGS_DIR` | `./recordings` | Video storage directory |
| `DATA_DIR` | `./data` | Config and cache directory |
| `COOKIES_FILE` | `./data/cookies.json` | TikTok cookies file |
| `TIKTOK_RECORDER_PATH` | `./tiktok-live-recorder/src` | Recorder source path |

---

## Configuration

### TikTok Cookies (Required for most regions)

TikTok restricts livestream access in many regions. Setting cookies (especially `sessionid_ss`) authenticates requests and bypasses region blocks:

1. **Get your cookies**: Install a browser extension like [EditThisCookie](https://www.editthiscookie.com/) and export cookies for `tiktok.com`
2. **Upload in Settings**: Go to **Settings** → **TikTok Cookies** in the WebUI and paste your cookie JSON
3. **Verify**: The dashboard will show connected users if cookies are valid

For detailed instructions, see the [official guide](https://github.com/Michele0303/tiktok-live-recorder/blob/main/docs/GUIDE.md#how-to-set-cookies).

### Proxy

If TikTok is blocked in your region or you want to route traffic through a proxy:

1. Go to **Settings** → **Proxy**
2. Enter your HTTP proxy URL (e.g., `http://127.0.0.1:8080`)
3. The proxy is used for both recording and avatar fetching

### Telegram Integration

Automatically upload completed recordings to Telegram:

1. Go to **Settings** → **Telegram**
2. Enter your API `api_id`, `api_hash`, and `session_name`
3. Set a target `chat_id`
4. Completed recordings will be uploaded automatically

---

## Development

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                  # Vite dev server on port 5173
```

The frontend dev server proxies `/api` requests to `localhost:8000` via Vite's proxy config.

### Building for Production

```bash
# Rebuild images without cache
docker compose build --no-cache

# Or just rebuild one service
docker compose build --no-cache backend
docker compose build --no-cache frontend
```

---

## API Endpoints

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all monitored users |
| POST | `/api/users` | Add user to watchlist |
| GET | `/api/users/{id}` | Get user details |
| PATCH | `/api/users/{id}` | Update user (watchlist, monitoring) |
| DELETE | `/api/users/{id}` | Remove user from watchlist |
| GET | `/api/users/{id}/status` | Check if user is currently live |
| POST | `/api/users/{id}/refresh` | Refresh user profile data |
| GET | `/api/users/{id}/avatar` | Get user's avatar image |

### Recordings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/recordings` | List recordings (paginated, filterable) |
| POST | `/api/recordings/start` | Start a new recording |
| GET | `/api/recordings/active` | List currently active recordings |
| GET | `/api/recordings/{id}` | Get recording details |
| POST | `/api/recordings/{id}/stop` | Stop an active recording |
| POST | `/api/recordings/{id}/favorite` | Toggle favorite status |
| DELETE | `/api/recordings/{id}` | Delete recording |
| GET | `/api/recordings/{id}/download` | Download recording file |
| GET | `/api/recordings/{id}/thumbnail` | Get recording thumbnail |
| GET | `/api/recordings/{id}/sprite` | Get video sprite sheet |
| GET | `/api/recordings/{id}/thumbnails.vtt` | Get sprite VTT for seek preview |
| POST | `/api/recordings/{id}/transcribe` | Generate transcript (Whisper) |
| GET | `/api/recordings/{id}/events` | Get live chat/gift events |
| GET | `/api/recordings/{id}/health` | Video health check |
| POST | `/api/recordings/{id}/repair` | Attempt video repair |
| GET | `/api/recordings/transcripts/search` | Search transcripts |
| POST | `/api/recordings/batch/delete` | Batch delete recordings |
| POST | `/api/recordings/batch/download` | Batch download recordings |
| POST | `/api/recordings/sprites/regenerate` | Regenerate sprites |

### Clips

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clips` | List all clips |
| POST | `/api/clips` | Create a clip from a recording |
| GET | `/api/clips/{id}` | Get clip details |
| PATCH | `/api/clips/{id}` | Update clip metadata |
| POST | `/api/clips/{id}/favorite` | Toggle favorite status |
| DELETE | `/api/clips/{id}` | Delete clip |
| GET | `/api/clips/{id}/download` | Download clip |
| GET | `/api/clips/{id}/thumbnail` | Get clip thumbnail |
| GET | `/api/clips/{id}/sprite` | Get clip sprite |
| GET | `/api/clips/{id}/thumbnails.vtt` | Get clip sprite VTT |

### Settings & System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/settings/health` | System health check |
| GET | `/api/settings/cleanup/stats` | Disk cleanup statistics |
| POST | `/api/settings/cleanup/run` | Run disk cleanup |
| GET | `/api/settings/monitor-status` | Monitor service status |
| POST | `/api/settings/monitor-check` | Trigger monitor check |
| GET | `/api/health` | Backend health check |

---

## Project Structure

```
TikRecGUI/
├── docker-compose.yml          # Docker orchestration
├── .env                        # Environment variables (optional)
├── README.md                   # You are here
│
├── backend/
│   ├── Dockerfile              # Multi-stage Docker build
│   ├── requirements.txt        # Python dependencies
│   ├── alembic.ini             # Alembic configuration
│   ├── alembic/                # Database migrations
│   │   ├── env.py
│   │   └── versions/
│   └── app/
│       ├── main.py             # FastAPI application & lifecycle
│       ├── config.py           # Pydantic settings
│       ├── api/routes/         # API endpoint handlers
│       │   ├── users.py
│       │   ├── recordings.py
│       │   ├── clips.py
│       │   └── settings.py
│       ├── core/               # Business logic
│       │   ├── recorder_service.py   # TikTok recorder integration
│       │   ├── recorder_loader.py    # Safe recorder import
│       │   ├── task_manager.py       # Recording thread management
│       │   ├── live_chat_service.py  # Live chat/gift capture
│       │   ├── unified_avatar_service.py  # Avatar fetching
│       │   ├── user_info_service.py  # Profile data fetching
│       │   ├── transcription_service.py  # Whisper ASR
│       │   ├── media_utils.py       # FFmpeg helpers
│       │   └── settings_store.py    # Settings persistence
│       ├── db/                 # Database layer
│       │   ├── database.py     # Engine, sessions, init_db
│       │   └── models.py       # SQLAlchemy models
│       └── schemas/            # Pydantic schemas
│           ├── user.py
│           ├── recording.py
│           ├── clip.py
│           ├── settings.py
│           └── live_event.py
│
├── frontend/
│   ├── Dockerfile              # Multi-stage Nginx build
│   ├── nginx.conf              # Reverse proxy configuration
│   ├── package.json            # Node dependencies
│   ├── vite.config.ts          # Vite configuration
│   ├── tsconfig.json           # TypeScript configuration
│   └── src/
│       ├── App.tsx             # Root component & routing
│       ├── main.tsx            # Application entry point
│       ├── index.css           # Global styles (Tailwind)
│       ├── lib/
│       │   ├── api.ts          # API client & TypeScript types
│       │   ├── utils.ts        # Utility functions
│       │   └── timezone-context.tsx
│       ├── components/         # Reusable UI components
│       │   ├── selia/          # Base UI component library
│       │   ├── ChatPanel.tsx   # Live chat/gift display
│       │   ├── TranscriptPanel.tsx
│       │   ├── ClipDialog.tsx
│       │   └── AvatarIndicator.tsx
│       └── pages/              # Route pages
│           ├── Dashboard.tsx
│           ├── Watchlist.tsx
│           ├── Recordings.tsx
│           ├── WatchPlayer.tsx
│           ├── Settings.tsx
│           └── Clips.tsx
│
├── recordings/                 # Recorded videos (Docker volume)
└── data/                       # SQLite DB & config (Docker volume)
    ├── tikrec.db
    ├── cookies.json
    ├── telegram.json
    └── avatars/
```

---

## Design System

The UI uses a custom design system built on Base UI React:

- **Primary Color**: Kraken Purple (`#7132f5`)
- **Typography**: System font stack (IBM Plex Sans preferred)
- **Border Radius**: 12px for interactive elements
- **Shadows**: Subtle (`rgba(0,0,0,0.03) 0px 4px 24px`)
- **Components**: Accessible, composable primitives from Base UI
- **Icons**: Lucide icon set

---

## Troubleshooting

### Backend logs are silent

If you only see Alembic/database logs and nothing else:

```bash
docker compose logs backend
```

The application logger may have been suppressed. Restart the backend:

```bash
docker compose restart backend
```

### "Region Restricted" warning

Your IP may be blocked by TikTok. Try:

1. **Configure cookies** in Settings (most effective)
2. **Set a proxy** in Settings
3. **Use a VPN** at the network level

### Recordings not starting

1. Verify the user is actually live (`/api/users/{id}/status`)
2. Check your TikTok cookies are valid (renew from browser if expired)
3. Review backend logs: `docker compose logs backend`
4. If using a proxy, verify it's reachable

### Frontend not loading

1. Confirm backend is running: `docker compose ps`
2. Check frontend logs: `docker compose logs frontend`
3. Verify port 3000 is free: `curl http://localhost:3000`
4. Hard refresh the browser (Cmd/Ctrl + Shift + R)

### Transcript fails

- Whisper transcription runs on CPU by default and may take several minutes
- Check `docker compose logs backend` for `transcription_service` messages
- The recording must be completed (not in progress)

---

## License

This project is for educational purposes. See the [tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder) license for the underlying recorder.

## Acknowledgments

- [Michele0303/tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder) — The core recording engine
- [isaackogan/TikTokLive](https://github.com/isaackogan/TikTokLive) — Live chat WebSocket library
- [Base UI](https://base-ui.com/) — Accessible React primitives
- [Vidstack](https://www.vidstack.io/) — Video player framework
- [Vite](https://vitejs.dev/) — Build tooling
