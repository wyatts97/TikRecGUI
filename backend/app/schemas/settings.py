from pydantic import BaseModel


class CookiesConfig(BaseModel):
    sessionid_ss: str = ""
    tt_target_idc: str = "useast2a"


class TelegramConfig(BaseModel):
    api_id: str = ""
    api_hash: str = ""
    chat_id: str = "me"


class SettingsResponse(BaseModel):
    cookies: CookiesConfig
    telegram: TelegramConfig
    proxy: str | None = None
    output_dir: str
    default_bitrate: str | None = None
    automatic_interval: int = 5


class SettingsUpdate(BaseModel):
    cookies: CookiesConfig | None = None
    telegram: TelegramConfig | None = None
    proxy: str | None = None
    default_bitrate: str | None = None
    automatic_interval: int | None = None
