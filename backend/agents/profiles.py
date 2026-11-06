"""Hồ sơ chuyên môn của từng agent: luật, checklist, kiến thức (file Markdown trong thư mục agents/).

- rules.md + checklist.md (của đội và của vai trò) luôn được đưa vào system prompt.
- knowledge/*.md chỉ liệt kê tiêu đề trong prompt; agent đọc nội dung bằng tool read_knowledge khi cần.
File được đọc lại mỗi lần agent khởi tạo, nên sửa trên dashboard là có hiệu lực ở lượt chạy sau.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from ..settings import AGENTS_DIR

TEAM = "_team"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_FILE_CHARS = 40_000          # giới hạn khi lưu từ dashboard
MAX_KNOWLEDGE_CHARS = 20_000     # giới hạn trả về cho agent mỗi lần đọc
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


class ProfileError(ValueError):
    pass


@dataclass
class Topic:
    slug: str
    title: str
    scope: str  # "team" hoặc mã vai trò


@dataclass
class Profile:
    role: str
    team_rules: str = ""
    rules: str = ""
    checklist: str = ""
    topics: list[Topic] = field(default_factory=list)

    def prompt_section(self) -> str:
        parts = []
        if self.team_rules:
            parts.append(self.team_rules)
        if self.rules:
            parts.append(self.rules)
        if self.checklist:
            parts.append(self.checklist)
        if self.topics:
            lines = [f"- `{t.slug}`: {t.title}" for t in self.topics]
            parts.append("# Kiến thức chuyên môn tra cứu được\n"
                         "Dùng tool read_knowledge với topic là mã bên dưới khi việc đang làm liên quan. "
                         "Không cần đọc hết; đọc đúng phần cần.\n" + "\n".join(lines))
        return "\n\n".join(parts)


def _clean(text: str) -> str:
    """Bỏ chú thích HTML (ghi nguồn, ghi chú cho người) trước khi đưa vào prompt."""
    return re.sub(r"\n{3,}", "\n\n", _COMMENT_RE.sub("", text)).strip()


def _read(path: Path) -> str:
    try:
        return _clean(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ""


def _title_of(path: Path) -> str:
    for line in _clean(path.read_text(encoding="utf-8")).splitlines():
        line = line.strip()
        if line:
            return line.lstrip("#").strip()[:160]
    return path.stem


def _check_scope(scope: str, valid_roles: list[str]) -> None:
    if scope != TEAM and scope not in valid_roles:
        raise ProfileError(f"Không có hồ sơ '{scope}'.")


def list_topics(role: str, base: Path | None = None) -> list[Topic]:
    base = base or AGENTS_DIR
    out: list[Topic] = []
    seen: set[str] = set()
    for scope in (role, TEAM):   # vai trò trước: trùng tên thì bản của vai trò thắng
        d = base / scope / "knowledge"
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.md")):
            if SLUG_RE.match(f.stem) and f.stem not in seen:
                seen.add(f.stem)
                out.append(Topic(f.stem, _title_of(f), "team" if scope == TEAM else role))
    return out


def load_profile(role: str, base: Path | None = None) -> Profile:
    base = base or AGENTS_DIR
    return Profile(
        role=role,
        team_rules=_read(base / TEAM / "rules.md"),
        rules=_read(base / role / "rules.md"),
        checklist=_read(base / role / "checklist.md"),
        topics=list_topics(role, base),
    )


def read_knowledge(role: str, topic: str, base: Path | None = None) -> str:
    """Nội dung một chủ đề kiến thức cho agent (tìm ở vai trò, rồi ở _team)."""
    base = base or AGENTS_DIR
    slug = topic.strip().removesuffix(".md").lower()
    if not SLUG_RE.match(slug):
        raise ProfileError("Mã chủ đề không hợp lệ (chỉ chữ thường, số, gạch ngang).")
    for scope in (role, TEAM):
        f = base / scope / "knowledge" / f"{slug}.md"
        if f.is_file():
            text = _clean(f.read_text(encoding="utf-8"))
            if len(text) > MAX_KNOWLEDGE_CHARS:
                text = text[:MAX_KNOWLEDGE_CHARS] + "\n\n…(đã cắt bớt)"
            return text
    available = ", ".join(t.slug for t in list_topics(role, base)) or "không có"
    raise ProfileError(f"Không có chủ đề '{slug}'. Các chủ đề có: {available}.")


# ---------- đọc/ghi file hồ sơ (cho dashboard) ----------
def _resolve_file(scope: str, rel: str, valid_roles: list[str], base: Path) -> Path:
    _check_scope(scope, valid_roles)
    rel = rel.replace("\\", "/").strip("/")
    if rel in ("rules.md", "checklist.md"):
        return base / scope / rel
    m = re.fullmatch(r"knowledge/([a-z0-9][a-z0-9-]{0,63})\.md", rel)
    if m:
        return base / scope / "knowledge" / f"{m.group(1)}.md"
    raise ProfileError("Chỉ được sửa rules.md, checklist.md hoặc knowledge/<ten-khong-dau>.md")


def list_files(scope: str, valid_roles: list[str], base: Path | None = None) -> list[dict]:
    base = base or AGENTS_DIR
    _check_scope(scope, valid_roles)
    d = base / scope
    files = []
    for rel in ("rules.md", "checklist.md"):
        f = d / rel
        files.append({"path": rel, "exists": f.is_file(), "size": f.stat().st_size if f.is_file() else 0,
                      "title": "Luật" if rel == "rules.md" else "Checklist tự kiểm"})
    kd = d / "knowledge"
    if kd.is_dir():
        for f in sorted(kd.glob("*.md")):
            if SLUG_RE.match(f.stem):
                files.append({"path": f"knowledge/{f.name}", "exists": True, "size": f.stat().st_size,
                              "title": _title_of(f)})
    return files


def read_file(scope: str, rel: str, valid_roles: list[str], base: Path | None = None) -> str:
    f = _resolve_file(scope, rel, valid_roles, base or AGENTS_DIR)
    return f.read_text(encoding="utf-8") if f.is_file() else ""


def write_file(scope: str, rel: str, content: str, valid_roles: list[str], base: Path | None = None) -> None:
    if len(content) > MAX_FILE_CHARS:
        raise ProfileError(f"File quá dài (tối đa {MAX_FILE_CHARS} ký tự). Hãy tách thành nhiều chủ đề.")
    f = _resolve_file(scope, rel, valid_roles, base or AGENTS_DIR)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content.replace("\r\n", "\n"), encoding="utf-8")


def delete_file(scope: str, rel: str, valid_roles: list[str], base: Path | None = None) -> None:
    f = _resolve_file(scope, rel, valid_roles, base or AGENTS_DIR)
    if not rel.startswith("knowledge/"):
        raise ProfileError("Không xoá rules.md/checklist.md; hãy để trống nội dung nếu không dùng.")
    if f.is_file():
        f.unlink()
