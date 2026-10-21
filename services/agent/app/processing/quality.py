"""
Document quality check using numpy only (no OpenCV dependency needed).
Computes Laplacian variance as blur score and mean pixel brightness.
Falls back gracefully if Pillow is unavailable.
"""
import io
import struct
import zlib
from dataclasses import dataclass

from .models import QualityFlags

# Minimum acceptable values
_MIN_BLUR_SCORE = 80.0       # Laplacian variance below this → blurry
_MIN_BRIGHTNESS = 30.0       # Mean brightness below this → too dark
_MIN_DIMENSION = 200          # Width or height below this → too small


def _decode_png_to_gray(data: bytes) -> list[list[int]] | None:
    """Minimal pure-Python PNG → grayscale pixel grid (no deps)."""
    try:
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        pos = 8
        chunks: dict[str, bytes] = {}
        while pos < len(data):
            length = struct.unpack(">I", data[pos:pos+4])[0]
            chunk_type = data[pos+4:pos+8].decode("ascii", errors="replace")
            chunk_data = data[pos+8:pos+8+length]
            chunks[chunk_type] = chunk_data
            pos += 12 + length

        ihdr = chunks.get("IHDR", b"")
        if len(ihdr) < 13:
            return None
        width, height = struct.unpack(">II", ihdr[:8])
        bit_depth, color_type = ihdr[8], ihdr[9]
        if bit_depth != 8 or width > 4000 or height > 4000:
            return None  # Only handle 8-bit

        raw = zlib.decompress(chunks.get("IDAT", b""))
        channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type, 0)
        if not channels:
            return None

        stride = width * channels + 1  # +1 for filter byte
        if len(raw) < stride * height:
            return None

        rows: list[list[int]] = []
        prev = [0] * (width * channels)
        for y in range(height):
            row_start = y * stride
            filt = raw[row_start]
            raw_row = list(raw[row_start+1:row_start+1+width*channels])
            # Apply filter
            if filt == 1:   # Sub
                for i in range(channels, len(raw_row)):
                    raw_row[i] = (raw_row[i] + raw_row[i-channels]) & 0xFF
            elif filt == 2:  # Up
                for i in range(len(raw_row)):
                    raw_row[i] = (raw_row[i] + prev[i]) & 0xFF
            elif filt == 3:  # Average
                for i in range(len(raw_row)):
                    a = raw_row[i-channels] if i >= channels else 0
                    raw_row[i] = (raw_row[i] + (a + prev[i]) // 2) & 0xFF
            prev = raw_row

            # Convert to grayscale
            gray_row: list[int] = []
            for x in range(width):
                if channels == 1:
                    gray_row.append(raw_row[x])
                elif channels >= 3:
                    r, g, b = raw_row[x*channels], raw_row[x*channels+1], raw_row[x*channels+2]
                    gray_row.append(int(0.299*r + 0.587*g + 0.114*b))
                else:
                    gray_row.append(raw_row[x*channels])
            rows.append(gray_row)
        return rows
    except Exception:
        return None


def _laplacian_variance(rows: list[list[int]]) -> float:
    """Simplified 3×3 Laplacian variance as blur measure."""
    h, w = len(rows), len(rows[0]) if rows else 0
    if h < 3 or w < 3:
        return 0.0
    total = 0.0
    count = 0
    for y in range(1, h-1):
        for x in range(1, w-1):
            lap = (
                -rows[y-1][x] - rows[y+1][x]
                - rows[y][x-1] - rows[y][x+1]
                + 4 * rows[y][x]
            )
            total += lap * lap
            count += 1
    return total / count if count else 0.0


def _mean_brightness(rows: list[list[int]]) -> float:
    if not rows or not rows[0]:
        return 0.0
    total = sum(sum(row) for row in rows)
    return total / (len(rows) * len(rows[0]))


def _try_pillow_gray(data: bytes, content_type: str) -> list[list[int]] | None:
    """Use Pillow to decode any image format to grayscale pixel grid."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data)).convert("L")
        # Downsample large images for speed
        if img.width > 800 or img.height > 800:
            img = img.resize((min(img.width, 800), min(img.height, 800)))
        return [list(img.getdata()[y*img.width:(y+1)*img.width]) for y in range(img.height)]
    except Exception:
        return None


def check_quality(image_bytes: bytes, content_type: str = "image/png") -> QualityFlags:
    """
    Check image quality: blur, brightness, dimensions.
    Works for PNG and JPEG via Pillow; falls back gracefully.
    """
    rows: list[list[int]] | None = None

    if content_type == "image/png":
        rows = _decode_png_to_gray(image_bytes)

    if rows is None:
        rows = _try_pillow_gray(image_bytes, content_type)

    if rows is None:
        # Cannot decode → assume OK (don't block processing)
        return QualityFlags()

    h, w = len(rows), len(rows[0]) if rows else 0
    blur_score = round(_laplacian_variance(rows), 2)
    brightness = round(_mean_brightness(rows), 2)

    return QualityFlags(
        is_blurry=blur_score < _MIN_BLUR_SCORE,
        is_too_dark=brightness < _MIN_BRIGHTNESS,
        is_too_small=w < _MIN_DIMENSION or h < _MIN_DIMENSION,
        blur_score=blur_score,
        mean_brightness=brightness,
    )
