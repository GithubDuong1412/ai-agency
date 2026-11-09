"""Hồ sơ chuyên môn của từng agent: luật, checklist, kiến thức (file Markdown trong thư mục agents/).

- rules.md + checklist.md (của đội và của vai trò) luôn được đưa vào system prompt.
- lessons.md: bài học Trưởng dự án tự rút ra sau mỗi vòng (Sếp sửa/xoá được), cũng luôn nạp vào prompt.
- knowledge/*.md chỉ liệt kê tiêu đề trong prompt; agent đọc nội dung bằng tool read_knowledge khi cần.
File được đọc lại mỗi lần agent khởi tạo, nên sửa trên dashboard là có hiệu lực ở lượt chạy sau.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..settings import AGENTS_DIR

TEAM = "_team"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_FILE_CHARS = 40_000          # giới hạn khi lưu từ dashboard
MAX_KNOWLEDGE_CHARS = 20_000     # giới hạn trả về cho agent mỗi lần đọc
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
LESSONS = "lessons.md"
MAX_LESSONS = 20                 # mỗi hồ sơ giữ tối đa bấy nhiêu bài học, bỏ bài cũ nhất
MAX_LESSON_CHARS = 300
FIXED_FILES = ("rules.md", "checklist.md", LESSONS)
LESSONS_HEADER = ("# Bài học từ các dự án trước\n"
                  "<!-- Trưởng dự án tự ghi sau mỗi vòng (lỗi QA/Kiểm duyệt bắt được, góp ý của Sếp). "
                  f"Sếp sửa hoặc xoá dòng nào cũng được. Tối đa {MAX_LESSONS} dòng; vượt thì bỏ dòng cũ nhất. -->\n")


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
    team_lessons: str = ""
    lessons: str = ""
    topics: list[Topic] = field(default_factory=list)

    def prompt_section(self) -> str:
        parts = []
        if self.team_rules:
            parts.append(self.team_rules)
        if self.rules:
            parts.append(self.rules)
        if self.checklist:
            parts.append(self.checklist)
        lessons = [x for x in (self.team_lessons, self.lessons) if _bullets(x)]
        if lessons:
            parts.append("# Bài học rút ra từ các dự án trước (tránh lặp lại)\n"
                         + "\n".join(line for x in lessons for line in _bullets(x)))
        if self.topics:
            lines = [f"- `{t.slug}`: {t.title}" for t in self.topics]
            parts.append("# Kiến thức chuyên môn tra cứu được\n"
                         "Dùng tool read_knowledge với topic là mã bên dưới khi việc đang làm liên quan. "
                         "Không cần đọc hết; đọc đúng phần cần.\n" + "\n".join(lines))
        return "\n\n".join(parts)


def _clean(text: str) -> str:
    """Bỏ chú thích HTML (ghi nguồn, ghi chú cho người) trước khi đưa vào prompt."""
    return re.sub(r"\n{3,}", "\n\n", _COMMENT_RE.sub("", text)).strip()


def _bullets(text: str) -> list[str]:
    return [ln.strip() for ln in text.splitlines() if ln.strip().startswith("- ")]


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
        team_lessons=_read(base / TEAM / LESSONS),
        lessons=_read(base / role / LESSONS),
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
    if rel in FIXED_FILES:
        return base / scope / rel
    m = re.fullmatch(r"knowledge/([a-z0-9][a-z0-9-]{0,63})\.md", rel)
    if m:
        return base / scope / "knowledge" / f"{m.group(1)}.md"
    raise ProfileError("Chỉ được sửa rules.md, checklist.md, lessons.md hoặc knowledge/<ten-khong-dau>.md")


def list_files(scope: str, valid_roles: list[str], base: Path | None = None) -> list[dict]:
    base = base or AGENTS_DIR
    _check_scope(scope, valid_roles)
    d = base / scope
    files = []
    titles = {"rules.md": "Luật", "checklist.md": "Checklist tự kiểm", LESSONS: "Bài học"}
    for rel in FIXED_FILES:
        f = d / rel
        files.append({"path": rel, "exists": f.is_file(), "size": f.stat().st_size if f.is_file() else 0,
                      "title": titles[rel], "count": len(_bullets(_read(f))) if rel == LESSONS else None})
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
        raise ProfileError("Không xoá rules.md/checklist.md/lessons.md; hãy để trống nội dung nếu không dùng.")
    if f.is_file():
        f.unlink()


# ---------- bài học tự rút ra ----------
def _norm(text: str) -> str:
    """Chuẩn hoá để so trùng: bỏ ghi nguồn _(...)_ cuối dòng, dấu câu, khoảng trắng, chữ hoa."""
    text = re.sub(r"_\(.*?\)_\s*$", "", text.strip().removeprefix("- "))
    return re.sub(r"[\W_]+", " ", text.lower()).strip()


def lessons_of(scope: str, base: Path | None = None) -> list[str]:
    return _bullets(_read((base or AGENTS_DIR) / scope / LESSONS))


def append_lessons(scope: str, items: list[str], source: str, base: Path | None = None,
                   now: float | None = None) -> list[str]:
    """Ghi thêm bài học vào lessons.md của một hồ sơ (vai trò hoặc _team). Bỏ dòng trùng, giữ tối đa
    MAX_LESSONS dòng mới nhất, giữ nguyên phần Sếp tự viết khác (tiêu đề, ghi chú). Trả về các dòng đã thêm."""
    base = base or AGENTS_DIR
    if not (base / scope).is_dir():
        raise ProfileError(f"Không có hồ sơ '{scope}'.")
    f = base / scope / LESSONS
    raw = f.read_text(encoding="utf-8") if f.is_file() else LESSONS_HEADER
    lines = raw.replace("\r\n", "\n").rstrip("\n").split("\n")
    seen = {_norm(ln) for ln in lines if ln.strip().startswith("- ")}
    date = time.strftime("%d/%m", time.localtime(now))
    tag = f" _({source[:60]}, {date})_" if source else f" _({date})_"
    added = []
    for item in items:
        text = " ".join(str(item).split())[:MAX_LESSON_CHARS].strip(" -")
        if len(text) < 8 or _norm(text) in seen:
            continue
        seen.add(_norm(text))
        line = f"- {text}{tag}"
        lines.append(line)
        added.append(line)
    if not added:
        return []
    bullet_idx = [i for i, ln in enumerate(lines) if ln.strip().startswith("- ")]
    for i in bullet_idx[:max(0, len(bullet_idx) - MAX_LESSONS)]:  # bỏ bài học cũ nhất
        lines[i] = None  # type: ignore[call-overload]
    content = "\n".join(ln for ln in lines if ln is not None) + "\n"
    if len(content) > MAX_FILE_CHARS:
        raise ProfileError("lessons.md quá dài.")
    f.write_text(content, encoding="utf-8")
    return added
