import os
import zipfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path


from app.config import settings
from app.core.settings_store import settings_store
from app.db.database import get_session
from app.db.models import Recording


class CleanupService:
    """Service for auto-cleaning old recordings."""
    
    BACKUPS_DIR = Path(settings.DATA_DIR) / "backups"
    
    def __init__(self):
        self.BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    
    def get_config(self) -> dict:
        """Get current auto-cleanup configuration."""
        return settings_store.get("auto_cleanup", {
            "enabled": False,
            "days": 7,
            "action": "delete"
        })
    
    def get_old_recordings(self, days: int) -> list[Recording]:
        """Get recordings older than specified days."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        with get_session() as db:
            recordings = db.query(Recording).filter(
                Recording.status.in_(["completed", "stopped", "failed"]),
                Recording.created_at < cutoff
            ).all()
            return recordings
    
    def delete_recording(self, recording: Recording) -> bool:
        """Delete a recording file and its thumbnail."""
        file_path = Path(settings.RECORDINGS_DIR) / recording.filename
        thumb_path = file_path.with_suffix("").with_name(file_path.stem + "_thumb.jpg")
        
        deleted = False
        
        if file_path.exists():
            try:
                os.remove(file_path)
                deleted = True
            except OSError:
                pass
        
        if thumb_path.exists():
            try:
                os.remove(thumb_path)
            except OSError:
                pass
        
        return deleted
    
    def compress_recordings(self, recordings: list[Recording]) -> str | None:
        """Compress recordings into a ZIP file in the backups folder."""
        if not recordings:
            return None
        
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        zip_filename = f"backup_{timestamp}.zip"
        zip_path = self.BACKUPS_DIR / zip_filename
        
        try:
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for recording in recordings:
                    file_path = Path(settings.RECORDINGS_DIR) / recording.filename
                    if file_path.exists():
                        zf.write(file_path, recording.filename)
            
            return str(zip_path)
        except Exception:
            if zip_path.exists():
                os.remove(zip_path)
            return None
    
    def run_cleanup(self) -> dict:
        """Run the cleanup process based on current settings."""
        config = self.get_config()
        
        if not config.get("enabled", False):
            return {"status": "disabled", "deleted": 0, "compressed": 0}
        
        days = config.get("days", 7)
        action = config.get("action", "delete")
        
        recordings = self.get_old_recordings(days)
        
        if not recordings:
            return {"status": "no_old_recordings", "deleted": 0, "compressed": 0}
        
        result = {"status": "completed", "deleted": 0, "compressed": 0}
        
        with get_session() as db:
            if action == "compress":
                zip_path = self.compress_recordings(recordings)
                if zip_path:
                    result["compressed"] = len(recordings)
                    result["backup_file"] = zip_path
                    
                    # Delete original files after compression
                    for recording in recordings:
                        if self.delete_recording(recording):
                            result["deleted"] += 1
                        db.delete(recording)
                    db.commit()
            else:  # delete
                for recording in recordings:
                    if self.delete_recording(recording):
                        result["deleted"] += 1
                    db.delete(recording)
                db.commit()
        
        return result
    
    def get_cleanup_stats(self) -> dict:
        """Get statistics about what would be cleaned up."""
        config = self.get_config()
        days = config.get("days", 7)
        
        recordings = self.get_old_recordings(days)
        total_size = 0
        
        for recording in recordings:
            file_path = Path(settings.RECORDINGS_DIR) / recording.filename
            if file_path.exists():
                total_size += file_path.stat().st_size
        
        return {
            "count": len(recordings),
            "total_size": total_size,
            "days": days
        }


cleanup_service = CleanupService()
