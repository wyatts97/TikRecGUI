"""Shared media processing utilities for TikRec.

Consolidates thumbnail generation, sprite sheet generation, video remuxing,
corruption repair, and health checks that were previously duplicated across
task_manager.py and recordings.py.

Every function takes an explicit ``video_path`` argument rather than a
recording ID, keeping this module free of route-layer concerns.
"""
import json
import logging
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from app.config import settings

logger = logging.getLogger("tikrec.media_utils")


# ----------------------------------------------------------------
# Clip helpers
# ----------------------------------------------------------------

def clip_directory() -> Path:
    """Return the directory for storing clip files."""
    return Path(settings.RECORDINGS_DIR) / "clips"


def create_clip(video_path: Path, start: int, end: int, output_path: Path) -> bool:
    """Extract a segment from *video_path* using ffmpeg.

    Tries stream-copy first (fast, lossless) and falls back to a
    full re-encode if the copy produces an empty or unreadable file.
    """
    if not video_path.exists():
        return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    duration = end - start

    # Strategy 1 — stream copy (fast, preserves quality)
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-t", str(duration),
                "-i", str(video_path),
                "-c", "copy",
                "-movflags", "+faststart",
                str(output_path),
            ],
            capture_output=True,
            check=True,
            timeout=180,
        )
        if output_path.exists() and output_path.stat().st_size > 0:
            # Sanity-check the output is playable
            health = analyze_video_health(output_path)
            if not health.get("is_corrupt"):
                logger.info("Clip created (stream copy): %s", output_path.name)
                return True
    except Exception:
        logger.warning("Stream-copy clip failed for %s, trying re-encode", video_path)
    finally:
        if output_path.exists() and output_path.stat().st_size == 0:
            output_path.unlink(missing_ok=True)

    # Strategy 2 — re-encode (slower but more robust)
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-t", str(duration),
                "-i", str(video_path),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(output_path),
            ],
            capture_output=True,
            check=True,
            timeout=300,
        )
        if output_path.exists() and output_path.stat().st_size > 0:
            logger.info("Clip created (re-encode): %s", output_path.name)
            return True
    except Exception:
        logger.error("Re-encode clip also failed for %s", video_path)

    if output_path.exists():
        output_path.unlink(missing_ok=True)
    return False


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

    Uses error-tolerant ffmpeg flags to handle mid-stream codec switches
    common in TikTok live recordings. Falls back to a full re-encode if
    the stream-copy remux encounters corrupt frames.

    Replaces *input_path* with the remuxed file in-place.  Returns
    ``True`` on success.
    """
    if not input_path.exists():
        return False

    # Strategy 1 — error-tolerant stream copy (fast, preserves quality)
    temp_path = input_path.with_suffix(".tmp.mp4")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-fflags", "+igndts+genpts",
                "-i", str(input_path),
                "-c", "copy",
                "-bsf:v", "h264_mp4toannexb",
                "-movflags", "+faststart",
                str(temp_path),
            ],
            capture_output=True,
            check=True,
            timeout=180,
        )
        if temp_path.exists() and temp_path.stat().st_size > 0:
            temp_path.replace(input_path)
            return True
    except Exception:
        logger.warning("Stream-copy remux failed for %s, trying re-encode", input_path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    # Strategy 2 — full re-encode (recovers corrupt frames at quality cost)
    reencode_path = input_path.with_suffix(".tmp.reencode.mp4")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-fflags", "+igndts+genpts",
                "-err_detect", "ignore_err",
                "-i", str(input_path),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(reencode_path),
            ],
            capture_output=True,
            check=True,
            timeout=300,
        )
        if reencode_path.exists() and reencode_path.stat().st_size > 0:
            reencode_path.replace(input_path)
            return True
    except Exception:
        logger.error("Re-encode remux also failed for %s", input_path)
    finally:
        if reencode_path.exists():
            reencode_path.unlink(missing_ok=True)

    return False


# ----------------------------------------------------------------
# Repair
# ----------------------------------------------------------------

def repair_video(input_path: Path, output_path: Path | None = None) -> bool:
    """Attempt to repair a corrupted TikTok recording.

    Uses two ffmpeg strategies in order:

    1. **Error-tolerant stream copy** — fast, preserves original quality.
       Adds ``-fflags +igndts+genpts``, ``-err_detect ignore_err``, and the
       ``h264_mp4toannexb`` bitstream filter to work around corrupt headers.

    2. **Full re-encode** — slower but can recover frames that the
       stream-copy path skips.  Uses ``libx264 veryfast crf 23``.

    If *output_path* is not provided, the repaired file replaces the
    original in-place.  Returns ``True`` on success.
    """
    if not input_path.exists():
        return False

    target = output_path or input_path
    target.parent.mkdir(parents=True, exist_ok=True)

    # Strategy 1 — error-tolerant stream copy
    temp_path = target.with_suffix(".tmp.repair.mp4")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-fflags", "+igndts+genpts",
                "-err_detect", "ignore_err",
                "-i", str(input_path),
                "-c", "copy",
                "-bsf:v", "h264_mp4toannexb",
                "-movflags", "+faststart",
                str(temp_path),
            ],
            capture_output=True,
            check=True,
            timeout=180,
        )
        if temp_path.exists() and temp_path.stat().st_size > 0:
            temp_path.replace(target)
            logger.info("Repair (stream copy) succeeded for %s", input_path)
            return True
    except Exception:
        logger.warning("Stream-copy repair failed for %s, trying re-encode", input_path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    # Strategy 2 — full re-encode
    reencode_path = target.with_suffix(".tmp.repair.reencode.mp4")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-fflags", "+igndts+genpts",
                "-err_detect", "ignore_err",
                "-i", str(input_path),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(reencode_path),
            ],
            capture_output=True,
            check=True,
            timeout=300,
        )
        if reencode_path.exists() and reencode_path.stat().st_size > 0:
            reencode_path.replace(target)
            logger.info("Repair (re-encode) succeeded for %s", input_path)
            return True
    except Exception:
        logger.error("Re-encode repair also failed for %s", input_path)
    finally:
        if reencode_path.exists():
            reencode_path.unlink(missing_ok=True)

    return False


# ----------------------------------------------------------------
# Health check
# ----------------------------------------------------------------

def analyze_video_health(video_path: Path) -> dict:
    """Check a video file for structural integrity.

    Returns a dictionary with keys:

    * ``is_corrupt`` — ``True`` when ffprobe cannot parse the file
    * ``duration`` — detected duration in seconds (or ``None``)
    * ``has_video`` — at least one video stream present
    * ``has_audio`` — at least one audio stream present
    * ``error`` — error message if probing failed
    """
    result: dict = {
        "is_corrupt": True,
        "duration": None,
        "has_video": False,
        "has_audio": False,
        "error": None,
    }

    if not video_path.exists():
        result["error"] = "File not found"
        return result

    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-show_entries", "stream=codec_type,codec_name",
                "-of", "json",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )

        if probe.returncode != 0:
            result["error"] = (probe.stderr or "").strip() or "ffprobe returned non-zero"
            return result

        data = json.loads(probe.stdout)

        if "format" in data and "duration" in data.get("format", {}):
            try:
                result["duration"] = float(data["format"]["duration"])
            except (ValueError, TypeError):
                pass

        for stream in data.get("streams", []):
            ctype = stream.get("codec_type")
            if ctype == "video":
                result["has_video"] = True
            elif ctype == "audio":
                result["has_audio"] = True

        result["is_corrupt"] = False

    except json.JSONDecodeError as exc:
        result["error"] = f"Failed to parse ffprobe output: {exc}"
    except FileNotFoundError:
        result["error"] = "ffprobe not found — is FFmpeg installed?"
    except Exception as exc:
        result["error"] = str(exc)

    return result
