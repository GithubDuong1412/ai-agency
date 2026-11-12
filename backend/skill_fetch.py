"""Tải một skill (thư mục có SKILL.md) từ GitHub vào khu chờ, để Sếp xem trước rồi mới cài.

Chỉ nhận link github.com; tải bản zip của repo qua codeload.github.com rồi chỉ giải nén đúng thư mục skill,
với các chốt chặn: không đường dẫn tuyệt đối / '..', bỏ symlink, giới hạn số file và dung lượng.
Không chạy bất kỳ file nào đã tải.
"""
from __future__ import annotations

import io
import re
import shutil
import stat
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from .agents import skills as skills_mod

MAX_ZIP_BYTES = 20 * 1024 * 1024
MAX_FILES = 300
MAX_TOTAL = skills_mod.MAX_INSTALL_BYTES
TIMEOUT = 30
_SEG = re.compile(r"^[A-Za-z0-9._-]+$")


class FetchError(ValueError):
    pass


def parse_github_url(url: str) -> tuple[str, str, str | None, str]:
    """(owner, repo, ref | None, đường dẫn thư mục trong repo). Nhận /tree/<ref>/<path> hoặc /blob/<ref>/<path>/SKILL.md."""
    u = urllib.parse.urlparse((url or "").strip())
    if u.scheme != "https" or u.netloc.lower() not in ("github.com", "www.github.com"):
        raise FetchError("Chỉ tải được skill từ link https://github.com/…")
    parts = [p for p in u.path.split("/") if p]
    if len(parts) < 2:
        raise FetchError("Link GitHub thiếu tên repo.")
    owner, repo = parts[0], parts[1].removesuffix(".git")
    ref, sub = None, []
    if len(parts) >= 4 and parts[2] in ("tree", "blob"):
        ref, sub = parts[3], parts[4:]
        if parts[2] == "blob" and sub and sub[-1].lower() == "skill.md":
            sub = sub[:-1]
    elif len(parts) > 2:
        raise FetchError("Link GitHub không đúng dạng /tree/<nhánh>/<thư mục>.")
    for seg in [owner, repo, *(sub or []), *([ref] if ref else [])]:
        if not _SEG.match(seg) or seg in (".", ".."):
            raise FetchError(f"Link GitHub chứa phần không hợp lệ: '{seg}'.")
    return owner, repo, ref, "/".join(sub)


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "ai-agency-skill-fetch"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:  # noqa: S310 (chỉ https codeload.github.com)
            data = r.read(MAX_ZIP_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise FetchError(f"GitHub trả lỗi {e.code} (repo/nhánh không tồn tại hoặc riêng tư).") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise FetchError(f"Không tải được từ GitHub: {getattr(e, 'reason', e)}") from e
    if len(data) > MAX_ZIP_BYTES:
        raise FetchError("Repo quá lớn để tải (> 20MB).")
    return data


def _safe_rel(name: str) -> PurePosixPath | None:
    p = PurePosixPath(name.replace("\\", "/"))
    if p.is_absolute() or ".." in p.parts or (p.parts and re.match(r"^[A-Za-z]:", p.parts[0])):
        return None
    return p


def extract_skill(zip_bytes: bytes, subpath: str, dest: Path) -> None:
    """Giải nén thư mục `subpath` (tính từ gốc repo, bỏ thư mục bọc ngoài của zip) vào `dest`."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as e:
        raise FetchError("File tải về không phải zip hợp lệ.") from e
    prefix = PurePosixPath(subpath) if subpath else None
    picked: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
    total = 0
    for info in zf.infolist():
        rel = _safe_rel(info.filename)
        if rel is None:
            raise FetchError(f"Zip chứa đường dẫn không an toàn: {info.filename}")
        if info.is_dir() or len(rel.parts) < 2:
            continue
        if stat.S_ISLNK(info.external_attr >> 16):
            continue  # bỏ symlink
        inner = PurePosixPath(*rel.parts[1:])  # bỏ thư mục <repo>-<ref>/ bọc ngoài
        if prefix is not None:
            if inner.parts[:len(prefix.parts)] != prefix.parts:
                continue
            inner = PurePosixPath(*inner.parts[len(prefix.parts):])
        if not inner.parts or any(part in skills_mod.SKIP_DIRS or part.startswith(".") for part in inner.parts[:-1]):
            continue
        picked.append((info, inner))
        total += info.file_size
        if len(picked) > MAX_FILES:
            raise FetchError(f"Skill có quá nhiều file (> {MAX_FILES}).")
        if total > MAX_TOTAL:
            raise FetchError("Skill quá lớn (> 60MB).")
    if not any(inner.as_posix() == "SKILL.md" for _, inner in picked):
        raise FetchError("Thư mục này không có SKILL.md (không phải skill).")
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    root = dest.resolve()
    for info, inner in picked:
        target = (dest / Path(*inner.parts)).resolve()
        if root not in target.parents:
            raise FetchError(f"Zip chứa đường dẫn không an toàn: {info.filename}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)


def manifest(dir_: Path, url: str = "") -> dict:
    s = skills_mod._load(dir_, "staged")
    files = list(skills_mod._iter_files(dir_))
    return {
        "name": dir_.name, "description": s.description if s else "", "url": url,
        "files": len(files), "size": sum(f.stat().st_size for f in files),
        "scripts": sorted(f.relative_to(dir_).as_posix() for f in files
                          if f.suffix.lower() in (".py", ".js", ".mjs", ".cjs", ".sh", ".ps1", ".bat", ".cmd",
                                                  ".exe", ".rb", ".php")),
        "ok": True, "error": None,
    }


def fetch_github(url: str, dest: Path) -> dict:
    """Tải skill về `dest` (thư mục khu chờ, tên = tên skill). Lỗi → FetchError."""
    owner, repo, ref, sub = parse_github_url(url)
    data = _download(f"https://codeload.github.com/{owner}/{repo}/zip/{ref or 'HEAD'}")
    extract_skill(data, sub, dest)
    return manifest(dest, url)


def default_name(url: str) -> str:
    """Tên skill gợi ý từ link: thư mục cuối (hoặc tên repo)."""
    try:
        owner, repo, _, sub = parse_github_url(url)
    except FetchError:
        return "skill"
    raw = (sub.split("/")[-1] if sub else repo).lower()
    name = re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-._")[:60]
    return name or "skill"
