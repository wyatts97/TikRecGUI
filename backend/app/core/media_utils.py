"""Shared media processing utilities for TikRec.

Consolidates thumbnail generation, sprite sheet generation, and video remuxing
that were previously duplicated across task_manager.py and recordings.py.

Every function takes an explicit ``video_path`` argument rather than a
recording ID, keeping this module free of route-layer concerns.
"""
import logging
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from app.config import settings

logger = logging.getLogger("tikrec.media_utils")


def generate_recording_filename(username: str) -> str:
    """Build a standardised filename for a recorded TikTok live stream.

    Format: ``TK_{username}_{YYYY.MM.DD_HH-MM-SS}.mp4``
    """
    return f"TK_{username}_{time.strftime('%Y.%m.%d_%H-%M-%S', time.localtime())}.mp4"


# ----------------------------------------------------------------
# Sprite generation — at most 2 concurrent invocations
# ----------------------------------------------------------------
_sprite_sem = threading.Semaphore(2)


# ----------------------------------------------------------------
# Thumbnail helpers
# ----------------------------------------------------------------

def thumbnail_path(video_path: Path) -> Path:
    """Return the expected filesystem path for a video's thumbnail JPEG."""
    return video_path.with_suffix("").with_name(video_path.stem + "_thumb.jpg")


def generate_thumbnail(video_path: Path, thumb_path: Path | None = None) -> bool:
    """Extract a single JPEG thumbnail from *video_path*.

    If *thumb_path* is not provided it is derived from *video_path* via
    :func:`thumbnail_path`.

    Tries several seek positions (1s, 0.5s, 2s, 0s) to handle very short
    or oddly-structured videos.

    Returns ``True`` when a non-empty JPEG was written, ``False`` otherwise.
    """
    if not video_path.exists():
        return False

    thumb = thumb_path or thumbnail_path(video_path)
    thumb.parent.mkdir(parents=True, exist_ok=True)

    seek_positions = ["1", "0.5", "2", "0"]

    for seek_time in seek_positions:
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-ss", seek_time,
                    "-i", str(video_path),
                    "-vframes", "1",
                    "-vf", "scale=480:-2",
                    str(thumb),
                ],
                capture_output=True,
                timeout=30,
            )
            if thumb.exists() and thumb.stat().st_size > 0:
                return True
        except Exception as exc:
            logger.warning("Thumbnail seek=%s failed for %s: %s",
                           seek_time, video_path, exc)
            continue

    return False


# ----------------------------------------------------------------
# Sprite / hover-scrub helpers
# ----------------------------------------------------------------

def _fmt_vtt_time(seconds: float) -> str:
    """Format *seconds* as ``HH:MM:SS.mmm`` for WebVTT timestamps."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def generate_sprite(video_path: Path) -> tuple[Path | None, Path | None]:
    """Generate a sprite sheet and WebVTT file for hover-scrub preview.

    Also persists ``sprite_ready = True`` on the corresponding
    ``Recording`` row so the API doesn't re-check the filesystem on
    every request.

    Returns ``(sprite_path, vtt_path)`` on success or ``(None, None)``
    on failure.

    **Locking:** a module-level semaphore limits concurrent sprite
    generation to 2 invocations.
    """
    THUMB_W, THUMB_H = 160, 90
    COLS = 10
    MAX_FRAMES = 120          # Hard cap to keep memory usage low
    BASE_INTERVAL = 10        # Default: one frame every 10s

    sprite_path = video_path.with_name(video_path.stem + "_sprite.jpg")
    vtt_path = video_path.with_name(video_path.stem + "_sprite.vtt")

    with _sprite_sem:
        try:
            probe = subprocess.run(
                [
                    "ffprobe", "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    str(video_path),
                ],
                capture_output=True, text=True, timeout=15,
            )
            duration = float(probe.stdout.strip())

            interval = max(BASE_INTERVAL, duration / MAX_FRAMES)
            expected_frames = min(MAX_FRAMES, int(duration / interval) + 1)

            temp_dir = tempfile.mkdtemp(prefix="sprite_frames_")
            try:
                extracted: list[Path] = []
                for i in range(expected_frames):
                    timestamp = i * interval
                    out_path = Path(temp_dir) / f"raw_{i:03d}.jpg"
                    try:
                        subprocess.run(
                            [
                                "ffmpeg", "-y",
                                "-nostdin", "-hide_banner", "-loglevel", "error",
                                "-ss", str(timestamp),
                                "-i", str(video_path),
                                "-vframes", "1",
                                "-vf", f"scale={THUMB_W}:{THUMB_H}",
                                "-an", "-sn", "-dn",
                                str(out_path),
                            ],
                            capture_output=True,
                            timeout=15,
                            check=True,
                        )
                        if out_path.exists() and out_path.stat().st_size > 0:
                            extracted.append(out_path)
                    except Exception:
                        pass

                if not extracted:
                    return None, None

                # Rename to contiguous sequence for ffmpeg tile
                for idx, src in enumerate(extracted):
                    dst = Path(temp_dir) / f"frame_{idx:03d}.jpg"
                    src.rename(dst)

                frame_count = len(extracted)
                rows = (frame_count + COLS - 1) // COLS
                frame_pattern = Path(temp_dir) / "frame_%03d.jpg"

                tile_result = subprocess.run(
                    [
                        "ffmpeg", "-y",
                        "-nostdin", "-hide_banner", "-loglevel", "error",
                        "-i", str(frame_pattern),
                        "-vf", f"tile={COLS}x{rows}",
                        str(sprite_path),
                    ],
                    capture_output=True,
                    timeout=60,
                )
                if tile_result.returncode != 0:
                    logger.warning(
                        "Sprite tiling failed for %s: %s",
                        video_path,
                        tile_result.stderr.decode("utf-8", errors="replace")[:200],
                    )
                    return None, None

                if not sprite_path.exists() or sprite_path.stat().st_size == 0:
                    return None, None

                lines = ["WEBVTT", ""]
                for i in range(frame_count):
                    start = i * interval
                    end = min(start + interval, duration)
                    col = i % COLS
                    row = i // COLS
                    lines.append(f"{_fmt_vtt_time(start)} --> {_fmt_vtt_time(end)}")
                    lines.append(
                        f"sprite#xywh={col * THUMB_W},{row * THUMB_H},{THUMB_W},{THUMB_H}"
                    )
                    lines.append("")
                vtt_path.write_text("\n".join(lines), encoding="utf-8")

            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

            # Persist sprite_ready flag in DB
            try:
                from app.db.database import get_session
                from app.db.models import Recording
                with get_session() as db:
                    rec = db.query(Recording).filter(
                        Recording.filename == video_path.name
                    ).first()
                    if rec:
                        rec.sprite_ready = True
                        db.commit()
            except Exception as db_exc:
                logger.warning("Failed to persist sprite_ready for %s: %s",
                               video_path, db_exc)

            logger.info(
                "Sprite generated for %s: %d frames (%dx%d) @ %.1fs interval",
                video_path.name, frame_count, COLS, rows, interval,
            )
            return sprite_path, vtt_path

        except Exception as exc:
            logger.warning("Sprite generation failed for %s: %s", video_path, exc)
            return None, None


# ----------------------------------------------------------------
# Remuxing
# ----------------------------------------------------------------

def remux_to_mp4(input_path: Path) -> bool:
    """Remux a raw stream to a faststart MP4 for browser seeking.

    Replaces *input_path* with the remuxed file in-place.  Returns
    ``True`` on success.
    """
    if not input_path.exists():
        return False
    temp_path = input_path.with_suffix(".tmp.mp4")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(input_path),
                "-c", "copy", "-movflags", "+faststart",
                str(temp_path),
            ],
            capture_output=True,
            check=True,
            timeout=120,
        )
        if temp_path.exists():
            temp_path.replace(input_path)
            return True
    except Exception:
        logger.error("FFmpeg remux failed for %s", input_path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
    return False
