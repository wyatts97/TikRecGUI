import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "TikRec WebUI"
    DEBUG: bool = False
    
    DATABASE_URL: str = "sqlite:///./data/tikrec.db"
    
    RECORDINGS_DIR: Path = Path("./recordings")
    DATA_DIR: Path = Path("./data")
    
    TIKTOK_RECORDER_PATH: Path = Path("./tiktok-live-recorder/src")
    COOKIES_FILE: Path = Path("./data/cookies.json")
    TELEGRAM_CONFIG_FILE: Path = Path("./data/telegram.json")
    
    DEFAULT_AUTOMATIC_INTERVAL: int = 5
    DEFAULT_BITRATE: str | None = None
    DEFAULT_PROXY: str | None = None
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

os.makedirs(settings.RECORDINGS_DIR, exist_ok=True)
os.makedirs(settings.DATA_DIR, exist_ok=True)
