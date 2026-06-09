import json
from fastapi import APIRouter, HTTPException, status

from app.config import settings
from app.schemas.settings import (
    CookiesConfig,
    TelegramConfig,
    AutoCleanupConfig,
    SettingsResponse,
    SettingsUpdate
)
from app.core.recorder_service import recorder_service
from app.core.settings_store import settings_store
from app.core.cleanup_service import cleanup_service
from app.core.task_manager import monitor_service

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
    
    auto_cleanup_data = settings_store.get("auto_cleanup", {
        "enabled": False,
        "days": 7,
        "action": "delete"
    })
    
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
        proxy=settings_store.get("proxy", settings.DEFAULT_PROXY),
        output_dir=str(settings.RECORDINGS_DIR),
        default_bitrate=settings_store.get("default_bitrate", settings.DEFAULT_BITRATE),
        automatic_interval=settings_store.get("automatic_interval", settings.DEFAULT_AUTOMATIC_INTERVAL),
        auto_cleanup=AutoCleanupConfig(**auto_cleanup_data),
        timezone=settings_store.get("timezone", "UTC")
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
        proxy = update.proxy.strip() or None
        settings_store.set("proxy", proxy)
        recorder_service.set_proxy(proxy)

    if update.default_bitrate is not None:
        bitrate = update.default_bitrate.strip() or None
        settings_store.set("default_bitrate", bitrate)

    if update.automatic_interval is not None:
        interval = max(1, int(update.automatic_interval))
        settings_store.set("automatic_interval", interval)

    if update.auto_cleanup is not None:
        settings_store.set("auto_cleanup", {
            "enabled": update.auto_cleanup.enabled,
            "days": update.auto_cleanup.days,
            "action": update.auto_cleanup.action
        })

    if update.timezone is not None:
        settings_store.set("timezone", update.timezone.strip() or "UTC")

    return get_settings()


@router.get("/health")
async def health_check():
    cookies_data = _read_json_file(settings.COOKIES_FILE, {})
    has_cookies = bool(cookies_data.get("sessionid_ss"))

    recorder_ready = recorder_service.is_available()
    is_blacklisted = recorder_service.is_country_blacklisted() if recorder_ready else False

    return {
        "status": "healthy",
        "recorder_available": recorder_ready,
        "country_blacklisted": is_blacklisted,
        "cookies_configured": has_cookies,
        "recordings_dir": str(settings.RECORDINGS_DIR),
        "recordings_dir_exists": settings.RECORDINGS_DIR.exists()
    }


@router.get("/cleanup/stats")
def get_cleanup_stats():
    """Get statistics about recordings that would be cleaned up."""
    return cleanup_service.get_cleanup_stats()


@router.post("/cleanup/run")
def run_cleanup():
    """Manually trigger the cleanup process."""
    return cleanup_service.run_cleanup()


@router.get("/monitor-status")
async def get_monitor_status():
    """Return current monitor service timer state for the navbar countdown."""
    return monitor_service.get_status()


@router.post("/monitor-check")
def trigger_monitor_check():
    """Trigger an immediate live-status check and reset the interval timer."""
    monitor_service.trigger_check()
    return {"triggered": True}
