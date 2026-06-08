import json
from fastapi import APIRouter, HTTPException, status

from app.config import settings
from app.schemas.settings import (
    CookiesConfig,
    TelegramConfig,
    SettingsResponse,
    SettingsUpdate
)
from app.core.recorder_service import recorder_service

router = APIRouter(prefix="/settings", tags=["settings"])


def _read_json_file(path, default: dict) -> dict:
    if path.exists():
        try:
            with open(path, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return default


def _write_json_file(path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


@router.get("", response_model=SettingsResponse)
def get_settings():
    cookies_data = _read_json_file(
        settings.COOKIES_FILE,
        {"sessionid_ss": "", "tt-target-idc": "useast2a"}
    )
    
    telegram_data = _read_json_file(
        settings.TELEGRAM_CONFIG_FILE,
        {"api_id": "", "api_hash": "", "chat_id": "me"}
    )
    
    return SettingsResponse(
        cookies=CookiesConfig(
            sessionid_ss=cookies_data.get("sessionid_ss", ""),
            tt_target_idc=cookies_data.get("tt-target-idc", "useast2a")
        ),
        telegram=TelegramConfig(
            api_id=telegram_data.get("api_id", ""),
            api_hash=telegram_data.get("api_hash", ""),
            chat_id=telegram_data.get("chat_id", "me")
        ),
        proxy=settings.DEFAULT_PROXY,
        output_dir=str(settings.RECORDINGS_DIR),
        default_bitrate=settings.DEFAULT_BITRATE,
        automatic_interval=settings.DEFAULT_AUTOMATIC_INTERVAL
    )


@router.put("", response_model=SettingsResponse)
def update_settings(update: SettingsUpdate):
    if update.cookies:
        cookies_data = {
            "sessionid_ss": update.cookies.sessionid_ss,
            "tt-target-idc": update.cookies.tt_target_idc
        }
        _write_json_file(settings.COOKIES_FILE, cookies_data)
        recorder_service.reload_cookies()
    
    if update.telegram:
        telegram_data = {
            "api_id": update.telegram.api_id,
            "api_hash": update.telegram.api_hash,
            "chat_id": update.telegram.chat_id
        }
        _write_json_file(settings.TELEGRAM_CONFIG_FILE, telegram_data)
    
    if update.proxy is not None:
        recorder_service.set_proxy(update.proxy if update.proxy else None)
    
    return get_settings()


@router.get("/health")
def health_check():
    is_blacklisted = recorder_service.is_country_blacklisted()
    
    cookies_data = _read_json_file(settings.COOKIES_FILE, {})
    has_cookies = bool(cookies_data.get("sessionid_ss"))
    
    return {
        "status": "healthy",
        "country_blacklisted": is_blacklisted,
        "cookies_configured": has_cookies,
        "recordings_dir": str(settings.RECORDINGS_DIR),
        "recordings_dir_exists": settings.RECORDINGS_DIR.exists()
    }
