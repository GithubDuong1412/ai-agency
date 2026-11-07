"""Ảnh Sếp đính kèm khi giao lệnh / góp ý: kiểm tra, lưu vào workspace và đổi thành khối ảnh cho Claude.

Ảnh nằm ở <workspace>/.agency/attachments (ngoài git — xem versions.EXCLUDES — và agent chỉ đọc được).
"""
from __future__ import annotations

import base64
import binascii
import re
import time
from pathlib import Path

MAX_IMAGES = 4
MAX_BYTES = 5 * 1024 * 1024  # giới hạn của Claude cho mỗi ảnh
MEDIA = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
EXT_MEDIA = {ext: media for media, ext in MEDIA.items()} | {"jpeg": "image/jpeg"}
DATA_URL = re.compile(r"^data:(image/[a-z]+);base64,(.+)$", re.S)
SUBDIR = Path(".agency") / "attachments"


def decode_images(items: list[str] | None) -> list[tuple[bytes, str]]:
    """Data URL → [(bytes, đuôi file)]. Ném ValueError (thông báo tiếng Việt) nếu không hợp lệ."""
    items = items or []
    if len(items) > MAX_IMAGES:
        raise ValueError(f"Tối đa {MAX_IMAGES} ảnh mỗi lần gửi.")
    out = []
    for n, item in enumerate(items, 1):
        m = DATA_URL.match(item or "")
        if not m or m.group(1) not in MEDIA:
            raise ValueError(f"Ảnh {n}: chỉ nhận PNG, JPEG, WebP hoặc GIF.")
        try:
            data = base64.b64decode(m.group(2), validate=True)
        except (binascii.Error, ValueError):
            raise ValueError(f"Ảnh {n}: dữ liệu ảnh bị hỏng.")
        if not data:
            raise ValueError(f"Ảnh {n}: rỗng.")
        if len(data) > MAX_BYTES:
            raise ValueError(f"Ảnh {n} quá lớn (tối đa 5MB).")
        out.append((data, MEDIA[m.group(1)]))
    return out


def save_attachments(ws: Path, images: list[tuple[bytes, str]]) -> list[str]:
    """Ghi ảnh vào workspace, trả về tên file (để hiển thị và để agent đọc)."""
    if not images:
        return []
    folder = ws / SUBDIR
    folder.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time() * 1000)
    names = []
    for i, (data, ext) in enumerate(images, 1):
        name = f"{stamp}_{i}.{ext}"
        (folder / name).write_bytes(data)
        names.append(name)
    return names


def rel_paths(names: list[str]) -> list[str]:
    return [(SUBDIR / n).as_posix() for n in names]


def media_type(path: Path) -> str | None:
    return EXT_MEDIA.get(path.suffix.lower().lstrip("."))


def image_block(path: Path) -> dict:
    """Khối ảnh base64 cho Messages API. Ném ValueError nếu không phải ảnh hỗ trợ hoặc quá lớn."""
    media = media_type(path)
    if not media:
        raise ValueError("Chỉ xem được ảnh PNG, JPEG, WebP hoặc GIF.")
    data = path.read_bytes()
    if len(data) > MAX_BYTES:
        raise ValueError("Ảnh quá lớn (tối đa 5MB).")
    return {"type": "image", "source": {"type": "base64", "media_type": media,
                                        "data": base64.standard_b64encode(data).decode()}}
