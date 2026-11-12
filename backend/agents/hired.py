"""Sổ nhân sự tuyển thêm: các vai trò do Trưởng dự án đề xuất và Sếp duyệt (agents/hired.yaml).

Khác 6 vai trò gốc (cố định trong roles.py), vai trò tuyển thêm được tạo / sửa / cho nghỉ lúc đang chạy.
File được đọc lại mỗi lần dùng (nhỏ, không cache) để mọi thay đổi có hiệu lực ngay.
Quyền chọn theo nhóm, mỗi nhóm ứng với một bộ tool.
"""
from __future__ import annotations

import re
import shutil
import threading
import time
from pathlib import Path

import yaml

from ..settings import AGENTS_DIR
from ..tools.registry import READ_TOOLS, WRITE_TOOLS

HIRED_FILE = AGENTS_DIR / "hired.yaml"
BASE_DIR = AGENTS_DIR          # nơi tạo thư mục hồ sơ agents/<key>
SKILLS_FILE = AGENTS_DIR / "skills.yaml"

BUILTIN = ("pm", "designer", "frontend", "backend", "qa", "reviewer")
RESERVED = {"team", "owner", "all", "_team", "_archive", "skills", "hired", "none"}
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{2,24}$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# Nhóm quyền → tool. "Đọc file dự án" + tra kiến thức luôn có.
BASE_TOOLS = [*READ_TOOLS, "read_knowledge"]
PERMISSION_TOOLS: dict[str, list[str]] = {
    "write": list(WRITE_TOOLS),
    "run": ["run_command"],
    "screenshot": ["screenshot"],
    "message": ["post_message"],
}
PERMISSION_LABELS = {
    "write": "Ghi / sửa file dự án",
    "run": "Chạy lệnh (php artisan, composer, npm…)",
    "screenshot": "Chụp màn hình trang web",
    "message": "Nhắn tin cho đồng đội",
}
EFFORTS = ("low", "medium", "high")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")   # trùng profiles.SLUG_RE (tên file knowledge/)
MAX_KNOWLEDGE_DOCS = 8
MAX_DOC_CHARS = 40_000                               # trùng profiles.MAX_FILE_CHARS
SOURCES_SLUG = "nguon-tham-khao"
DISPLAY_FIELDS = ("name", "title", "department", "color", "model", "effort")

_lock = threading.RLock()


class HiredError(ValueError):
    pass


def tools_for(perms: list[str]) -> tuple[str, ...]:
    names = list(BASE_TOOLS)
    for p in PERMISSION_TOOLS:  # thứ tự cố định để prompt cache ổn định
        if p in perms:
            names += [t for t in PERMISSION_TOOLS[p] if t not in names]
    return tuple(names)


def can_take_tasks(entry: dict) -> bool:
    """Chỉ người có quyền ghi file mới được Trưởng dự án giao task (task nào cũng phải tạo ra thay đổi)."""
    return "write" in (entry.get("permissions") or [])


# ---------- đọc / ghi ----------
def load(path: Path | None = None) -> dict[str, dict]:
    path = path or HIRED_FILE
    if not path.is_file():
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return {}
    out: dict[str, dict] = {}
    for k, v in data.items():
        if isinstance(v, dict) and KEY_RE.match(str(k)) and str(k) not in BUILTIN:
            v = dict(v)
            v["permissions"] = [p for p in (v.get("permissions") or []) if p in PERMISSION_TOOLS]
            v.setdefault("working_style", "")
            out[str(k)] = v
    return out


def _save(data: dict[str, dict], path: Path | None = None) -> None:
    path = path or HIRED_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    header = ("# Nhân sự tuyển thêm (Trưởng dự án đề xuất, Sếp duyệt trên dashboard: Tuyển dụng).\n"
              "# Rules / checklist / bài học của từng người nằm ở agents/<mã>/.\n")
    body = yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(header + body, encoding="utf-8")
    tmp.replace(path)


def get(key: str, path: Path | None = None) -> dict | None:
    return load(path).get(key)


# ---------- kiểm tra ----------
def _clean_fields(fields: dict, models: list[str] | None) -> dict:
    out: dict = {}
    for f in ("name", "title", "department"):
        if f in fields:
            v = str(fields[f] or "").strip()
            if not v:
                raise HiredError(f"Thiếu {f}.")
            out[f] = v[:60]
    if "color" in fields:
        c = str(fields["color"] or "").strip()
        if not HEX_RE.match(c):
            raise HiredError(f"Màu '{c}' không hợp lệ (dạng #RRGGBB).")
        out["color"] = c.lower()
    if "model" in fields:
        m = str(fields["model"] or "").strip()
        if not m or (models and m not in models):
            raise HiredError(f"Model '{m}' không có trong danh sách cho phép.")
        out["model"] = m
    if "effort" in fields:
        e = str(fields["effort"] or "").strip()
        if e not in EFFORTS:
            raise HiredError(f"Effort phải là một trong {list(EFFORTS)}.")
        out["effort"] = e
    if "permissions" in fields:
        perms = fields["permissions"] or []
        bad = [p for p in perms if p not in PERMISSION_TOOLS]
        if bad:
            raise HiredError(f"Quyền không hợp lệ: {bad}.")
        out["permissions"] = [p for p in PERMISSION_TOOLS if p in perms]
    if "working_style" in fields:
        ws = str(fields["working_style"] or "").strip()
        if not ws:
            raise HiredError("Thiếu cách làm việc.")
        out["working_style"] = ws[:6000]
    return out


def check_key(key: str, path: Path | None = None) -> None:
    if not KEY_RE.match(key or ""):
        raise HiredError(f"Mã '{key}' không hợp lệ: chữ thường không dấu, số, gạch dưới; 3–25 ký tự, bắt đầu bằng chữ.")
    if key in BUILTIN or key in RESERVED:
        raise HiredError(f"Mã '{key}' trùng vai trò có sẵn.")
    if key in load(path):
        raise HiredError(f"Đã có nhân sự mã '{key}'.")


# ---------- tuyển / sửa / cho nghỉ ----------
def clean_knowledge(items: list | None) -> list[dict]:
    """Tài liệu chuyên môn của ứng viên → [{slug, title, content_markdown}] hợp lệ (lỗi → HiredError)."""
    out: list[dict] = []
    seen: set[str] = set()
    for it in items or []:
        if not isinstance(it, dict):
            raise HiredError("Tài liệu kiến thức không hợp lệ.")
        slug = str(it.get("slug") or "").strip().lower()
        title = str(it.get("title") or "").strip()
        body = str(it.get("content_markdown") or "").strip()
        if not body:
            continue
        if not SLUG_RE.match(slug) or slug == SOURCES_SLUG:
            raise HiredError(f"Tên file kiến thức '{slug}' không hợp lệ (chữ thường không dấu, số, gạch ngang).")
        if slug in seen:
            raise HiredError(f"Trùng tên file kiến thức '{slug}'.")
        if len(body) > MAX_DOC_CHARS:
            raise HiredError(f"Tài liệu '{title or slug}' quá dài (> {MAX_DOC_CHARS} ký tự).")
        seen.add(slug)
        out.append({"slug": slug, "title": title[:120] or slug, "content_markdown": body})
    if len(out) > MAX_KNOWLEDGE_DOCS:
        raise HiredError(f"Tối đa {MAX_KNOWLEDGE_DOCS} tài liệu kiến thức.")
    return out


def _sources_md(sources: list | None) -> str:
    lines = []
    for s in sources or []:
        if not isinstance(s, dict):
            continue
        url = str(s.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            continue
        title = str(s.get("title") or url).strip()[:200]
        note = str(s.get("note") or "").strip()[:300]
        lines.append(f"- [{title}]({url})" + (f": {note}" if note else ""))
    if not lines:
        return ""
    return ("# Nguồn tham khảo\n\nCác tài liệu Trưởng dự án đã đọc khi soạn hồ sơ này. "
            "Đọc lại bản gốc khi cần chi tiết.\n\n" + "\n".join(lines) + "\n")


def add(cand: dict, models: list[str] | None = None, request_id: str | None = None,
        path: Path | None = None, base: Path | None = None) -> dict:
    """Tuyển một người: ghi vào hired.yaml và tạo hồ sơ agents/<key>/ (rules.md, checklist.md)."""
    base = base or BASE_DIR
    with _lock:
        key = str(cand.get("key") or "").strip()
        check_key(key, path)
        entry = _clean_fields({f: cand.get(f) for f in (*DISPLAY_FIELDS, "permissions", "working_style")}, models)
        missing = [f for f in (*DISPLAY_FIELDS, "working_style") if f not in entry]
        if missing:
            raise HiredError(f"Thiếu thông tin: {', '.join(missing)}.")
        entry["hired_at"] = time.strftime("%Y-%m-%d %H:%M")
        if request_id:
            entry["request_id"] = request_id
        folder = base / key
        folder.mkdir(parents=True, exist_ok=True)
        rules = str(cand.get("rules_markdown") or "").strip()
        checklist = str(cand.get("checklist_markdown") or "").strip()
        (folder / "rules.md").write_text(
            f"# Luật nghiệp vụ — {entry['name']} ({entry['title']})\n\n{rules}\n" if rules else
            f"# Luật nghiệp vụ — {entry['name']} ({entry['title']})\n", encoding="utf-8")
        (folder / "checklist.md").write_text(
            f"# Checklist trước khi nộp\n\n{checklist}\n" if checklist else "# Checklist trước khi nộp\n",
            encoding="utf-8")
        knowledge = clean_knowledge(cand.get("knowledge"))
        sources = _sources_md(cand.get("sources"))
        if knowledge or sources:
            kd = folder / "knowledge"
            kd.mkdir(exist_ok=True)
            for k in knowledge:
                body = k["content_markdown"]
                if not body.lstrip().startswith("#"):
                    body = f"# {k['title']}\n\n{body}"
                (kd / f"{k['slug']}.md").write_text(body.rstrip() + "\n", encoding="utf-8")
            if sources:
                (kd / f"{SOURCES_SLUG}.md").write_text(sources, encoding="utf-8")
        data = load(path)
        data[key] = entry
        _save(data, path)
        return {"key": key, **entry}


def update(key: str, fields: dict, models: list[str] | None = None, path: Path | None = None) -> dict:
    with _lock:
        data = load(path)
        if key not in data:
            raise HiredError(f"Không có nhân sự tuyển thêm mã '{key}'.")
        clean = _clean_fields({k: v for k, v in fields.items() if k in (*DISPLAY_FIELDS, "permissions",
                                                                       "working_style")}, models)
        data[key].update(clean)
        _save(data, path)
        return {"key": key, **data[key]}


def remove(key: str, path: Path | None = None, base: Path | None = None,
           skills_file: Path | None = None) -> None:
    """Cho nghỉ việc: xoá khỏi sổ; hồ sơ (kể cả bài học) chuyển vào agents/_archive/ để không mất."""
    base = base or BASE_DIR
    skills_file = skills_file or SKILLS_FILE
    with _lock:
        data = load(path)
        if key not in data:
            raise HiredError(f"Không có nhân sự tuyển thêm mã '{key}'.")
        del data[key]
        _save(data, path)
        folder = base / key
        if folder.is_dir():
            dest = base / "_archive" / f"{key}-{time.strftime('%Y%m%d-%H%M%S')}"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(folder), str(dest))
        if skills_file.is_file():
            try:
                sk = yaml.safe_load(skills_file.read_text(encoding="utf-8")) or {}
            except yaml.YAMLError:
                sk = None
            if isinstance(sk, dict) and key in sk:
                del sk[key]
                head = "".join(ln + "\n" for ln in skills_file.read_text(encoding="utf-8").splitlines()
                               if ln.startswith("#"))
                skills_file.write_text(head + yaml.safe_dump(sk, allow_unicode=True, sort_keys=False),
                                       encoding="utf-8")
