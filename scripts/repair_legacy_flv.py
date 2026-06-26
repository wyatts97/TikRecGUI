#!/usr/bin/env python3
"""Repair legacy TikRec recordings that are actually multiple concatenated FLV
streams stored in a ``.mp4``-named file.

Background
----------
The old recorder appended every reconnect's HTTP response straight into one
file. Each TikTok reconnect begins with its own ``FLV`` header and timestamps
restarting near zero, so the file ends up as ``[FLV #1][FLV #2]...``. ffmpeg's
FLV demuxer reads the first stream, hits the next embedded ``FLV`` header
mid-file, treats it as corruption, and stops — which is why a normal remux or
re-encode only ever recovers the first segment (e.g. the first ~30 minutes) and
the rest is slow-mo / glitchy / silent.

This tool:
  1. Scans the file (chunked, low memory) for valid embedded FLV headers.
  2. Splits the file into one ``.flv`` per stream.
  3. Re-encodes every segment to a uniform MPEG-TS (constant fps, fixed canvas
     via scale+pad so resolution switches at guest-join don't break concat,
     audio resynced).
  4. Concatenates the segments into a single clean, faststart ``.mp4``.

Usage
-----
    python scripts/repair_legacy_flv.py "INPUT.mp4" [-o OUTPUT.mp4]
                                        [--fps 25] [--width 720] [--height 1280]
                                        [--crf 20] [--keep-temp]

Requires ``ffmpeg`` and ``ffprobe`` on PATH.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# FLV header: "FLV"(3) + version(1) + flags(1) + DataOffset(4 = 0x00000009)
_FLV_SIG = b"FLV\x01"
_FLV_DATAOFFSET = b"\x00\x00\x00\x09"
_READ_CHUNK = 8 * 1024 * 1024  # 8 MiB


def find_flv_offsets(path: Path) -> list[int]:
    """Return byte offsets of every valid FLV header in *path* (low memory).

    Reads the file in overlapping chunks so a header straddling a chunk
    boundary is still detected.
    """
    offsets: list[int] = []
    overlap = 9  # enough to validate the 9-byte header across boundaries
    base = 0
    tail = b""
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(_READ_CHUNK)
            if not chunk:
                break
            buf = tail + chunk
            buf_base = base - len(tail)
            start = 0
            while True:
                idx = buf.find(_FLV_SIG, start)
                if idx == -1:
                    break
                # Validate the DataOffset field (bytes 5..9) to avoid matching
                # the literal "FLV\x01" inside payload data.
                if buf[idx + 5: idx + 9] == _FLV_DATAOFFSET:
                    offsets.append(buf_base + idx)
                start = idx + 1
            tail = buf[-overlap:]
            base += len(chunk)
    return offsets


def split_segments(path: Path, offsets: list[int], work_dir: Path) -> list[Path]:
    """Write each FLV stream between consecutive offsets to its own file."""
    if not offsets:
        return []
    bounds = offsets + [path.stat().st_size]
    segments: list[Path] = []
    with path.open("rb") as fh:
        for i in range(len(offsets)):
            start, end = bounds[i], bounds[i + 1]
            seg_path = work_dir / f"segment_{i:03d}.flv"
            fh.seek(start)
            remaining = end - start
            with seg_path.open("wb") as out:
                while remaining > 0:
                    data = fh.read(min(_READ_CHUNK, remaining))
                    if not data:
                        break
                    out.write(data)
                    remaining -= len(data)
            if seg_path.stat().st_size > 0:
                segments.append(seg_path)
    return segments


def reencode_segment(
    seg: Path, out_ts: Path, fps: int, width: int, height: int, crf: int
) -> bool:
    """Re-encode one FLV segment to a normalized MPEG-TS chunk."""
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}"
    )
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-fflags", "+genpts+igndts+discardcorrupt",
        "-err_detect", "ignore_err",
        "-i", str(seg),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", vf,
        "-r", str(fps),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-c:a", "aac", "-b:a", "160k",
        "-af", "aresample=async=1:first_pts=0",
        "-f", "mpegts",
        str(out_ts),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        sys.stderr.write(
            f"  ! segment {seg.name} failed: "
            f"{result.stderr.decode('utf-8', 'replace')[:300]}\n"
        )
        return False
    return out_ts.exists() and out_ts.stat().st_size > 0


def concat_ts(ts_files: list[Path], output: Path) -> bool:
    """Concatenate normalized MPEG-TS chunks into one faststart MP4."""
    concat_arg = "concat:" + "|".join(str(p) for p in ts_files)
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", concat_arg,
        "-c", "copy",
        "-movflags", "+faststart",
        str(output),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        sys.stderr.write(
            "concat failed: "
            f"{result.stderr.decode('utf-8', 'replace')[:300]}\n"
        )
        return False
    return output.exists() and output.stat().st_size > 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Damaged .mp4/.flv file")
    parser.add_argument("-o", "--output", type=Path, default=None,
                        help="Output path (default: <input>_repaired.mp4)")
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--width", type=int, default=720)
    parser.add_argument("--height", type=int, default=1280)
    parser.add_argument("--crf", type=int, default=20)
    parser.add_argument("--keep-temp", action="store_true",
                        help="Keep the intermediate segment files")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        sys.stderr.write("ffmpeg/ffprobe not found on PATH.\n")
        return 2

    src: Path = args.input
    if not src.exists():
        sys.stderr.write(f"Input not found: {src}\n")
        return 2

    output: Path = args.output or src.with_name(src.stem + "_repaired.mp4")

    print(f"Scanning {src.name} for embedded FLV headers...")
    offsets = find_flv_offsets(src)
    print(f"Found {len(offsets)} FLV stream(s) at byte offsets: {offsets}")

    if len(offsets) <= 1:
        print(
            "Only one FLV stream detected — this file is not multi-segment.\n"
            "A normal CFR re-encode should suffice; no splitting needed."
        )
        # Still offer a single-pass clean re-encode for convenience.
        ok = reencode_segment(src, output.with_suffix(".ts"), args.fps,
                              args.width, args.height, args.crf)
        if ok and concat_ts([output.with_suffix(".ts")], output):
            output.with_suffix(".ts").unlink(missing_ok=True)
            print(f"Done -> {output}")
            return 0
        return 1

    work_dir = Path(tempfile.mkdtemp(prefix="flv_repair_"))
    try:
        print("Splitting into segments...")
        segments = split_segments(src, offsets, work_dir)
        print(f"Wrote {len(segments)} segment file(s).")

        ts_files: list[Path] = []
        for i, seg in enumerate(segments):
            out_ts = work_dir / f"norm_{i:03d}.ts"
            print(f"Re-encoding segment {i + 1}/{len(segments)} "
                  f"({seg.stat().st_size / 1e6:.1f} MB)...")
            if reencode_segment(seg, out_ts, args.fps, args.width,
                                args.height, args.crf):
                ts_files.append(out_ts)
            else:
                print(f"  skipping unrecoverable segment {i}")

        if not ts_files:
            sys.stderr.write("No segments could be re-encoded.\n")
            return 1

        print(f"Concatenating {len(ts_files)} segment(s) -> {output.name}")
        if concat_ts(ts_files, output):
            print(f"Done -> {output}")
            return 0
        return 1
    finally:
        if args.keep_temp:
            print(f"Temp files kept in: {work_dir}")
        else:
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
