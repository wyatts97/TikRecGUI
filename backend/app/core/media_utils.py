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


def generate_thumbnail(video_path: Path, thumb_path: Path | None = None, recording_id: int | None = None) -> bool:
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
    success = False

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
                success = True
                break
        except Exception as exc:
            logger.warning("Thumbnail seek=%s failed for %s: %s",
                           seek_time, video_path, exc)
            continue

    if success and recording_id is not None:
        try:
            from app.db.database import get_session
            from app.db.models import Recording
            with get_session() as db:
                rec = db.query(Recording).filter(Recording.id == recording_id).first()
                if rec:
                    rec.thumbnail_ready = True
                    db.commit()
        except Exception as db_exc:
            logger.warning("Failed to persist thumbnail_ready for %s: %s",
                           video_path, db_exc)

    return success


def concat_ts_segments(segment_paths: list[Path], output_path: Path) -> bool:
    """Concatenate MPEG-TS segments into a single TS file.

    Uses ffmpeg's concat demuxer with stream copy so the result is a lossless
    join of the individual segments. The input list order is preserved.

    Returns ``True`` if the output file was created and non-empty.
    """
    if not segment_paths:
        return False
    segment_paths = [p for p in segment_paths if p.exists() and p.stat().st_size > 0]
    if not segment_paths:
        return False
    if len(segment_paths) == 1:
        try:
            import shutil
            shutil.copy2(segment_paths[0], output_path)
            return output_path.exists() and output_path.stat().st_size > 0
        except Exception:
            return False

    concat_list = output_path.with_suffix(".concat.txt")
    try:
        concat_list.write_text(
            "\n".join(f"file '{p.as_posix()}'" for p in segment_paths),
            encoding="utf-8",
        )
        subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
                "-fflags", "+igndts+genpts",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_list),
                "-c", "copy",
                "-f", "mpegts",
                str(output_path),
            ],
            capture_output=True,
            check=True,
            timeout=300,
        )
        return output_path.exists() and output_path.stat().st_size > 0
    except Exception as exc:
        logger.warning("Segment concat failed for %s: %s", output_path.name, exc)
        return False
    finally:
        concat_list.unlink(missing_ok=True)


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

def _probe_duration(video_path: Path) -> float | None:
    """Return the duration of *video_path* in seconds, or ``None``.

    First tries the container's ``format.duration``. If that is missing (common
    for MPEG-TS files before remux), it falls back to the last packet timestamp
    so callers still get a usable duration estimate without misclassifying a
    healthy stream as corrupt.
    """
    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            capture_output=True, text=True, timeout=15,
        )
        value = probe.stdout.strip()
        if value:
            duration = float(value)
            if duration > 0:
                return duration
    except Exception:
        pass

    # Fallback: estimate duration from the last video packet timestamp.
    # This is slower but necessary for containers without a global duration.
    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "packet=pts_time",
                "-of", "csv=p=0",
                str(video_path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        timestamps = [float(line.strip()) for line in probe.stdout.splitlines() if line.strip()]
        if timestamps:
            max_ts = max(timestamps)
            if max_ts > 0:
                return max_ts
    except Exception:
        pass

    return None


def remux_to_mp4(
    input_path: Path,
    expected_duration: float | None = None,
    output_path: Path | None = None,
) -> tuple[bool, float | None]:
    """Remux a captured stream to a faststart MP4 for browser seeking.

    Uses error-tolerant ffmpeg flags to handle mid-stream codec switches
    common in TikTok live recordings. Falls back to a full re-encode if
    the stream-copy remux encounters corrupt frames or if the resulting
    duration diverges from *expected_duration* by >5 %% or >30 s.

    When *output_path* is given the remuxed MP4 is written there (the
    typical flow: ``.ts`` source → ``.mp4`` output); otherwise *input_path*
    is replaced in-place.

    Note: no explicit ``h264_mp4toannexb`` bitstream filter is used — when
    copying H.264 from MPEG-TS/FLV into MP4, ffmpeg automatically applies
    the correct AVCC conversion. Forcing Annex-B start codes into an MP4
    container produces files that ffprobe can read but real players reject.

    Returns ``(success, actual_duration)``.
    """
    if not input_path.exists():
        return False, None

    target = output_path or input_path

    # Strategy 1 — error-tolerant stream copy (fast, preserves quality)
    temp_path = target.with_suffix(".tmp.mp4")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-fflags", "+igndts+genpts",
                "-err_detect", "ignore_err",
                "-i", str(input_path),
                "-c", "copy",
                "-movflags", "+faststart",
                str(temp_path),
            ],
            capture_output=True,
            check=True,
            timeout=180,
        )
        if temp_path.exists() and temp_path.stat().st_size > 0:
            actual_duration = _probe_duration(temp_path)
            # Validate duration before replacing the original file
            if expected_duration is not None and actual_duration is not None:
                diff = abs(actual_duration - expected_duration)
                threshold = max(expected_duration * 0.05, 30.0)
                if diff > threshold:
                    logger.warning(
                        "Stream-copy remux duration mismatch for %s: "
                        "expected %.1fs, got %.1fs (diff %.1fs > threshold %.1fs). "
                        "Falling back to re-encode.",
                        input_path.name, expected_duration, actual_duration, diff, threshold,
                    )
                    temp_path.unlink(missing_ok=True)
                    # Fall through to Strategy 2
                else:
                    temp_path.replace(target)
                    return True, actual_duration
            else:
                temp_path.replace(target)
                return True, actual_duration
    except Exception:
        logger.warning("Stream-copy remux failed for %s, trying re-encode", input_path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    # Strategy 2 — full re-encode (recovers corrupt frames and fixes timestamps)
    reencode_path = target.with_suffix(".tmp.reencode.mp4")
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
            actual_duration = _probe_duration(reencode_path)
            reencode_path.replace(target)
            return True, actual_duration
    except Exception:
        logger.error("Re-encode remux also failed for %s", input_path)
    finally:
        if reencode_path.exists():
            reencode_path.unlink(missing_ok=True)

    return False, None


# ----------------------------------------------------------------
# Repair
# ----------------------------------------------------------------

def repair_video(input_path: Path, output_path: Path | None = None) -> tuple[bool, float | None]:
    """Attempt to repair a corrupted TikTok recording.

    Uses two ffmpeg strategies in order:

    1. **Error-tolerant stream copy** — fast, preserves original quality.
       Adds ``-fflags +igndts+genpts`` and ``-err_detect ignore_err`` to work
       around corrupt headers/timestamps. No ``h264_mp4toannexb`` filter is
       used: forcing Annex-B start codes into MP4 yields files ffprobe can
       read but players reject. The output is validated: if ffprobe still
       cannot parse it or the duration is missing, we fall through to the
       re-encode strategy.

    2. **Full re-encode** — slower but can recover frames and rebuild
       correct duration metadata.  Uses ``libx264 veryfast crf 23``.

    If *output_path* is not provided, the repaired file replaces the
    original in-place.  Returns ``(True, duration)`` on success or
    ``(False, None)`` on failure.
    """
    if not input_path.exists():
        return False, None

    target = output_path or input_path
    target.parent.mkdir(parents=True, exist_ok=True)

    def _is_valid_repair(path: Path) -> tuple[bool, float | None]:
        health = analyze_video_health(path)
        duration = _probe_duration(path)
        valid = (
            path.exists()
            and path.stat().st_size > 0
            and not health.get("is_corrupt", True)
            and duration is not None
            and duration > 0
        )
        return valid, duration

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
                "-movflags", "+faststart",
                str(temp_path),
            ],
            capture_output=True,
            check=True,
            timeout=180,
        )
        valid, duration = _is_valid_repair(temp_path)
        if valid:
            temp_path.replace(target)
            logger.info("Repair (stream copy) succeeded for %s (%.1fs)", input_path, duration)
            return True, duration
        logger.warning(
            "Stream-copy repair for %s produced an invalid file (duration=%s); trying re-encode",
            input_path, duration,
        )
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
        valid, duration = _is_valid_repair(reencode_path)
        if valid:
            reencode_path.replace(target)
            logger.info("Repair (re-encode) succeeded for %s (%.1fs)", input_path, duration)
            return True, duration
        logger.warning("Re-encode repair for %s produced an invalid file (duration=%s)", input_path, duration)
    except Exception:
        logger.error("Re-encode repair also failed for %s", input_path)
    finally:
        if reencode_path.exists():
            reencode_path.unlink(missing_ok=True)

    return False, None


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

        # A file ffprobe can parse but with no usable duration is still broken
        # for playback (bad duration metadata), so treat it as corrupt.
        if result["duration"] is None or result["duration"] <= 0:
            result["is_corrupt"] = True
            result["error"] = "No valid duration detected"
        else:
            result["is_corrupt"] = False

    except json.JSONDecodeError as exc:
        result["error"] = f"Failed to parse ffprobe output: {exc}"
    except FileNotFoundError:
        result["error"] = "ffprobe not found — is FFmpeg installed?"
    except Exception as exc:
        result["error"] = str(exc)

    return result
