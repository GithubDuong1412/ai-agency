"""Thư viện agent mẫu (repo agency-agents) để PM chắt lọc rules / checklist khi soạn hồ sơ tuyển dụng.

Tải bản zip của repo qua codeload.github.com, chỉ giữ file .md trong các thư mục phòng ban, lưu cache
cục bộ kèm index.json (path, division, name, description, vibe). Làm mới sau `refresh_days` ngày;
tải lỗi thì dùng bản cache cũ, không có cache thì trả None (PM quay về nghiên cứu web).
Không chạy file nào đã tải; nội dung chỉ là tài liệu tham khảo.
"""
from __future__ import annotations

import io
import json
import logging
import shutil
import stat
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from . import skill_fetch
from .skill_fetch import FetchError

log = logging.getLogger(__name__)

DEFAULT_REPO = "https://github.com/msitarzewski/agency-agents"
SKIP_TOP = {".github", "scripts", "integrations", "examples", "strategy", "docs", "node_modules"}
MAX_FILES = 1000
MAX_FILE_BYTES = 300 * 1024
READ_CHUNK = 30000
INDEX = "index.json"


@dataclass
class Library:
    root: Path
    repo: str          # https://github.com/<owner>/<repo>
    ref: str
    entries: list[dict] = field(default_factory=list)

    def get(self, path: str) -> dict | None:
        p = (path or "").strip().replace("\\", "/").lstrip("/")
        return next((e for e in self.entries if e["path"] == p), None)


def github_url(repo: str, ref: str, path: str) -> str:
    return f"{repo.rstrip('/')}/blob/{ref}/{path}"


def _frontmatter(text: str) -> dict:
    """Parser frontmatter đơn giản (key: value trên một dòng), đủ cho name / description / vibe."""
    out: dict[str, str] = {}
    lines = text.lstrip("﻿").splitlines()
    if not lines or lines[0].strip() != "---":
        return out
    for line in lines[1:60]:
        if line.strip() == "---":
            break
        if ":" in line and not line.startswith((" ", "\t", "-")):
            k, v = line.split(":", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[k.strip().lower()] = v
    return out


def _title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def extract_library(zip_bytes: bytes, dest: Path) -> list[dict]:
    """Giải nén các file .md trong thư mục phòng ban (bỏ thư mục bọc ngoài của zip) vào `dest`, trả index."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as e:
        raise FetchError("File tải về không phải zip hợp lệ.") from e
    picked: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
    for info in zf.infolist():
        rel = skill_fetch._safe_rel(info.filename)
        if rel is None:
            raise FetchError(f"Zip chứa đường dẫn không an toàn: {info.filename}")
        if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
            continue
        inner = PurePosixPath(*rel.parts[1:]) if len(rel.parts) > 1 else PurePosixPath()
        if len(inner.parts) < 2 or inner.suffix.lower() != ".md":
            continue  # bỏ file ở gốc repo (README, CONTRIBUTING…) và file không phải .md
        if inner.parts[0] in SKIP_TOP or any(p.startswith(".") for p in inner.parts):
            continue
        if inner.name.lower() in ("readme.md", "contributing.md", "changelog.md", "license.md"):
            continue
        if info.file_size > MAX_FILE_BYTES:
            continue
        picked.append((info, inner))
        if len(picked) > MAX_FILES:
            raise FetchError(f"Thư viện có quá nhiều file (> {MAX_FILES}).")
    if not picked:
        raise FetchError("Repo không có file agent mẫu nào.")
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    root = dest.resolve()
    entries: list[dict] = []
    for info, inner in picked:
        target = (dest / Path(*inner.parts)).resolve()
        if root not in target.parents:
            raise FetchError(f"Zip chứa đường dẫn không an toàn: {info.filename}")
        target.parent.mkdir(parents=True, exist_ok=True)
        data = zf.read(info)
        target.write_bytes(data)
        text = data.decode("utf-8", errors="replace")
        fm = _frontmatter(text)
        entries.append({
            "path": inner.as_posix(), "division": inner.parts[0],
            "name": fm.get("name") or _title(text, inner.stem),
            "description": fm.get("description", ""), "vibe": fm.get("vibe", ""),
        })
    entries.sort(key=lambda e: e["path"])
    return entries


def _load(dir_: Path, repo: str, ref: str) -> Library | None:
    try:
        data = json.loads((dir_ / INDEX).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        return None
    return Library(root=dir_, repo=data.get("repo", repo), ref=data.get("ref", ref), entries=data["entries"])


def _age_days(dir_: Path) -> float:
    try:
        return (time.time() - (dir_ / INDEX).stat().st_mtime) / 86400
    except OSError:
        return float("inf")


def ensure_library(base: Path, cfg: dict | None = None) -> Library | None:
    """Thư viện trong `base/<tên repo>/`; tải (lại) khi chưa có hoặc đã cũ. Không bao giờ ném lỗi."""
    cfg = cfg or {}
    repo_url = str(cfg.get("reference_repo") or DEFAULT_REPO).rstrip("/")
    if not repo_url:
        return None
    try:
        owner, repo, ref0, _ = skill_fetch.parse_github_url(repo_url)
    except FetchError as e:
        log.warning("reference_repo không hợp lệ: %s", e)
        return None
    ref = str(cfg.get("reference_ref") or ref0 or "main")
    dir_ = base / repo
    cached = _load(dir_, f"https://github.com/{owner}/{repo}", ref)
    if cached and _age_days(dir_) < float(cfg.get("reference_refresh_days", 7)):
        return cached
    try:
        data = skill_fetch._download(f"https://codeload.github.com/{owner}/{repo}/zip/{ref}")
        tmp = base / f".{repo}.tmp"
        entries = extract_library(data, tmp)
        (tmp / INDEX).write_text(json.dumps({"repo": f"https://github.com/{owner}/{repo}", "ref": ref,
                                             "entries": entries}, ensure_ascii=False), encoding="utf-8")
        if dir_.exists():
            shutil.rmtree(dir_)
        tmp.rename(dir_)
        return _load(dir_, f"https://github.com/{owner}/{repo}", ref)
    except Exception as e:  # noqa: BLE001 — không có thư viện thì PM vẫn soạn bằng web
        log.warning("Không tải được thư viện mẫu %s: %s", repo_url, e)
        shutil.rmtree(base / f".{repo}.tmp", ignore_errors=True)
        return cached


def catalog_text(lib: Library, desc_chars: int = 90) -> str:
    """Danh mục gọn nhóm theo phòng ban: `path — name: mô tả`."""
    out: list[str] = []
    division = None
    for e in lib.entries:
        if e["division"] != division:
            division = e["division"]
            out.append(f"\n### {division}")
        d = " ".join((e.get("description") or "").split())
        if len(d) > desc_chars:
            d = d[:desc_chars].rstrip() + "…"
        out.append(f"- {e['path']} — {e['name']}" + (f": {d}" if d else ""))
    return "\n".join(out).strip()


def read(lib: Library, path: str, offset: int = 0) -> str:
    e = lib.get(path)
    if e is None:
        raise ValueError(f"Không có file mẫu '{path}' trong thư viện. Chọn đúng đường dẫn trong danh mục.")
    text = (lib.root / Path(*PurePosixPath(e["path"]).parts)).read_text(encoding="utf-8", errors="replace")
    offset = max(0, int(offset or 0))
    chunk = text[offset:offset + READ_CHUNK]
    end = offset + len(chunk)
    head = f"[{e['path']} — {e['name']} | ký tự {offset}-{end}/{len(text)}]\n"
    tail = (f"\n\n[Còn tiếp: gọi read_reference với offset={end}]" if end < len(text) else "\n\n[Hết file]")
    return head + chunk + tail
