# TikRec WebUI

A modern web interface for [tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder), built with React and FastAPI.

![Dashboard Preview](https://img.shields.io/badge/Status-Development-yellow)

## Features

- **Dashboard**: Real-time overview of live users, active recordings, and system status
- **Watchlist**: Add and manage TikTok users to monitor for live streams
- **Recordings**: View, download, and manage all your recordings
- **Settings**: Configure cookies, proxy, Telegram integration, and more

## Tech Stack

- **Frontend**: React 18, Vite, TailwindCSS, shadcn/ui, React Query
- **Backend**: FastAPI, SQLAlchemy, SQLite
- **Recorder**: [tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder)
- **Deployment**: Docker Compose

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- Git

### Installation

1. **Clone the repository** (already done if you're reading this):
   ```bash
   git clone https://github.com/Michele0303/tiktok-live-recorder tiktok-live-recorder
   ```

2. **Create required directories**:
   ```bash
   mkdir -p recordings data
   ```

3. **Start with Docker Compose**:
   ```bash
   docker-compose up -d
   ```

4. **Access the WebUI**:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

## Development Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Configuration

### TikTok Cookies (Optional but Recommended)

To access restricted content or bypass regional restrictions:

1. Go to **Settings** in the WebUI
2. Enter your TikTok `sessionid_ss` cookie
3. See the [official guide](https://github.com/Michele0303/tiktok-live-recorder/blob/main/docs/GUIDE.md#how-to-set-cookies) for details

### Proxy (Optional)

If TikTok is restricted in your region:

1. Go to **Settings** in the WebUI
2. Enter your HTTP proxy URL (e.g., `http://127.0.0.1:8080`)

### Telegram Integration (Optional)

To automatically upload recordings to Telegram:

1. Go to **Settings** in the WebUI
2. Enter your Telegram API credentials
3. See the [official guide](https://github.com/Michele0303/tiktok-live-recorder/blob/main/docs/GUIDE.md#how-to-enable-upload-to-telegram) for details

## Project Structure

```
TikRecGUI/
├── docker-compose.yml      # Docker orchestration
├── DESIGN.MD               # UI design system (Kraken-inspired)
├── README.md               # This file
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py         # FastAPI application
│       ├── config.py       # Configuration
│       ├── api/routes/     # API endpoints
│       ├── core/           # Recorder service & task manager
│       ├── db/             # Database models
│       └── schemas/        # Pydantic schemas
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── nginx.conf
│   └── src/
│       ├── App.tsx
│       ├── components/     # UI components
│       ├── pages/          # Page components
│       └── lib/            # Utilities & API client
├── tiktok-live-recorder/   # Original recorder (submodule/clone)
├── recordings/             # Recorded videos (volume)
└── data/                   # SQLite DB & config files (volume)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all monitored users |
| POST | `/api/users` | Add user to watchlist |
| DELETE | `/api/users/{id}` | Remove user |
| GET | `/api/users/{id}/status` | Check if user is live |
| POST | `/api/recordings/start` | Start recording |
| POST | `/api/recordings/{id}/stop` | Stop recording |
| GET | `/api/recordings` | List all recordings |
| GET | `/api/recordings/{id}/download` | Download recording |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings |

## Design System

The UI follows a Kraken-inspired design system defined in `DESIGN.MD`:

- **Primary Color**: Kraken Purple (`#7132f5`)
- **Typography**: IBM Plex Sans
- **Border Radius**: 12px for buttons
- **Shadows**: Subtle (`rgba(0,0,0,0.03) 0px 4px 24px`)

## Troubleshooting

### "Region Restricted" Warning

Your IP may be blocked by TikTok. Solutions:
1. Configure cookies in Settings
2. Use a proxy in Settings
3. Use a VPN

### Recordings Not Starting

1. Check if the user is actually live
2. Verify your cookies are valid
3. Check the backend logs: `docker-compose logs backend`

### Frontend Not Loading

1. Ensure backend is running: `docker-compose ps`
2. Check frontend logs: `docker-compose logs frontend`
3. Verify port 3000 is not in use

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is for educational purposes. See the [tiktok-live-recorder license](https://github.com/Michele0303/tiktok-live-recorder/blob/main/LICENSE) for the underlying recorder.

## Acknowledgments

- [Michele0303/tiktok-live-recorder](https://github.com/Michele0303/tiktok-live-recorder) - The core recording engine
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Kraken](https://www.kraken.com/) - Design inspiration
