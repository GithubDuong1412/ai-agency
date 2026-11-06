"""Skill (định dạng SKILL.md như Claude Code) cho từng agent.

Nguồn skill:
- "agency": thư mục `skills/<tên>/` trong dự án (đã cài vào agency, đi cùng dự án).
- "machine": `~/.claude/skills/<tên>/` (skill Claude Code đã cài trên máy; chỉ đọc).
Trùng tên thì bản "agency" thắng. Gán skill cho vai trò lưu ở `agents/skills.yaml`.

Agent thấy tên + mô tả skill trong system prompt, đọc hướng dẫn bằng tool use_skill và chạy script
của skill (Python/Node) bằng tool run_skill_script. Script chạy với cwd là workspace dự án.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from ..settings import AGENTS_DIR, ROOT

AGENCY_SKILLS_DIR = ROOT / "skills"
MACHINE_SKILLS_DIR = Path.home() / ".claude" / "skills"
ASSIGN_FILE = AGENTS_DIR / "skills.yaml"

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
TEXT_EXT = {".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".html", ".css", ".py", ".js", ".mjs", ".cjs", ".ts"}
SKIP_DIRS = {"__pycache__", ".git", "node_modules", ".venv", "venv", "tests"}
MAX_READ = 30_000          # ký tự trả về mỗi lần use_skill (đọc tiếp bằng offset)
MAX_SCRIPT_OUTPUT = 15_000
SCRIPT_TIMEOUT = 120
MAX_INSTALL_BYTES = 60 * 1024 * 1024


class SkillError(ValueError):
    pass


@dataclass
class Skill:
    name: str
    description: str
    source: str        # "agency" | "machine"
    path: Path

    def to_dict(self) -> dict:
        files = [p for p in _iter_files(self.path)]
        return {
            "name": self.name, "description": self.description, "source": self.source,
            "path": str(self.path), "files": len(files),
            "size": sum(p.stat().st_size for p in files),
            "scripts": sorted(p.relative_to(self.path).as_posix() for p in files
                              if p.suffix in (".py", ".js", ".mjs", ".cjs") and p.parent.name == "scripts"),
        }


def _iter_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            p = Path(dirpath) / f
            if not p.is_symlink():
                yield p


def _frontmatter(text: str) -> dict:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1)) or {}
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError:
        return {}


def _load(dir_: Path, source: str) -> Skill | None:
    md = dir_ / "SKILL.md"
    if not md.is_file() or not NAME_RE.match(dir_.name):
        return None
    fm = _frontmatter(md.read_text(encoding="utf-8", errors="replace"))
    desc = str(fm.get("description") or "").strip()
    return Skill(name=dir_.name, description=desc, source=source, path=dir_)


def list_skills(agency_dir: Path | None = None, machine_dir: Path | None = None) -> list[Skill]:
    agency_dir = agency_dir or AGENCY_SKILLS_DIR
    machine_dir = machine_dir or MACHINE_SKILLS_DIR
    found: dict[str, Skill] = {}
    for base, source in ((agency_dir, "agency"), (machine_dir, "machine")):
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            if d.is_dir() and d.name not in found:
                s = _load(d, source)
                if s:
                    found[s.name] = s
    return list(found.values())


def get_skill(name: str, agency_dir: Path | None = None, machine_dir: Path | None = None) -> Skill:
    for s in list_skills(agency_dir, machine_dir):
        if s.name == name:
            return s
    raise SkillError(f"Không tìm thấy skill '{name}'.")


# ---------- gán skill cho vai trò ----------
def load_assignments(path: Path | None = None) -> dict[str, list[str]]:
    path = path or ASSIGN_FILE
    if not path.is_file():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {str(k): [str(x) for x in (v or [])] for k, v in data.items() if isinstance(v, list)}


def save_assignment(role: str, names: list[str], valid_roles: list[str], path: Path | None = None,
                    **dirs) -> list[str]:
    path = path or ASSIGN_FILE
    if role not in valid_roles:
        raise SkillError(f"Không có vai trò '{role}'.")
    clean = []
    for n in names:
        get_skill(n, **dirs)  # phải tồn tại
        if n not in clean:
            clean.append(n)
    data = load_assignments(path)
    data[role] = clean
    path.parent.mkdir(parents=True, exist_ok=True)
    header = "# Skill gán cho từng nhân viên (sửa trên dashboard: Hồ sơ nhân sự). Tên = thư mục trong skills/ hoặc ~/.claude/skills/\n"
    body = yaml.safe_dump({r: data.get(r, []) for r in valid_roles if data.get(r)}, allow_unicode=True, sort_keys=False)
    path.write_text(header + body, encoding="utf-8")
    return clean


def skills_for(role: str, path: Path | None = None, **dirs) -> list[Skill]:
    out = []
    for n in load_assignments(path).get(role, []):
        try:
            out.append(get_skill(n, **dirs))
        except SkillError:
            continue  # skill đã gỡ khỏi máy: bỏ qua, không làm hỏng agent
    return out


def prompt_section(role: str, **kw) -> str:
    skills = skills_for(role, **kw)
    if not skills:
        return ""
    lines = []
    for s in skills:
        desc = s.description if len(s.description) <= 400 else s.description[:400] + "…"
        lines.append(f"- `{s.name}`: {desc}")
    return (
        "# Skill bạn được giao\n"
        "Skill là bộ hướng dẫn + công cụ chuyên môn. Khi việc đang làm khớp mô tả của skill, hãy dùng nó:\n"
        "1. Gọi use_skill(skill) để đọc SKILL.md (dài thì đọc tiếp bằng offset; tài liệu kèm theo đọc bằng file).\n"
        "2. Khi SKILL.md bảo chạy script, vd. `python3 ~/.claude/skills/<skill>/scripts/search.py \"từ khoá\" --domain ux`,\n"
        "   hãy gọi run_skill_script(skill, script=\"scripts/search.py\", args=[\"từ khoá\", \"--domain\", \"ux\"]).\n"
        "3. Bỏ qua phần skill cần công cụ bạn không có (tạo ảnh AI, API key, trình duyệt riêng…).\n"
        "4. **Luật của đội và stack dự án ưu tiên hơn skill** (vd. skill gợi ý React/shadcn thì vẫn dùng Blade + Tailwind CDN).\n"
        + "\n".join(lines)
    )


# ---------- dùng skill (cho agent) ----------
def _resolve_inside(skill: Skill, rel: str) -> Path:
    rel = (rel or "SKILL.md").replace("\\", "/").strip()
    if rel.startswith("/") or re.match(r"^[A-Za-z]:", rel) or ".." in rel.split("/"):
        raise SkillError("Đường dẫn phải là đường dẫn tương đối bên trong skill.")
    p = (skill.path / rel).resolve()
    if skill.path.resolve() not in p.parents and p != skill.path.resolve():
        raise SkillError("Đường dẫn nằm ngoài skill.")
    return p


def read_skill(role: str, name: str, file: str | None = None, offset: int = 0, **kw) -> str:
    allowed = {s.name: s for s in skills_for(role, **kw)}
    if name not in allowed:
        raise SkillError(f"Bạn không được giao skill '{name}'. Skill của bạn: {', '.join(allowed) or 'không có'}.")
    s = allowed[name]
    p = _resolve_inside(s, file or "SKILL.md")
    if p.is_dir():
        items = sorted(x.relative_to(s.path).as_posix() for x in _iter_files(p))[:300]
        return "Các file:\n" + "\n".join(items)
    if not p.is_file():
        raise SkillError(f"Không có file '{file}' trong skill. Gọi với file='.' để xem danh sách.")
    if p.suffix.lower() not in TEXT_EXT:
        raise SkillError("Chỉ đọc được file văn bản (.md, .txt, .csv, .json, .py, .js…).")
    text = p.read_text(encoding="utf-8", errors="replace")
    offset = max(0, int(offset or 0))
    chunk = text[offset:offset + MAX_READ]
    rest = len(text) - (offset + len(chunk))
    note = f"\n\n…(còn {rest} ký tự, gọi lại với offset={offset + len(chunk)})" if rest > 0 else ""
    return chunk + note


def _check_args(args: list) -> list[str]:
    if not isinstance(args, list) or len(args) > 40:
        raise SkillError("args phải là danh sách tối đa 40 chuỗi.")
    out = []
    for a in args:
        if not isinstance(a, str) or len(a) > 500:
            raise SkillError("Mỗi tham số phải là chuỗi ≤ 500 ký tự.")
        if (re.search(r"(^|[=\s])[/\\~]", a) or re.search(r"(^|[=\s])[A-Za-z]:[\\/]", a)
                or re.search(r"(^|[=\\/\s])\.\.([\\/]|$)", a)):
            raise SkillError(f"Tham số '{a}' chứa đường dẫn ngoài workspace; chỉ dùng đường dẫn tương đối.")
        out.append(a)
    return out


def run_script(role: str, name: str, script: str, args: list, cwd: Path, **kw) -> tuple[int, str]:
    allowed = {s.name: s for s in skills_for(role, **kw)}
    if name not in allowed:
        raise SkillError(f"Bạn không được giao skill '{name}'.")
    s = allowed[name]
    p = _resolve_inside(s, script)
    if not p.is_file():
        raise SkillError(f"Không có script '{script}' trong skill '{name}'.")
    ext = p.suffix.lower()
    if ext == ".py":
        argv = [sys.executable, "-E", "-s", str(p)]
    elif ext in (".js", ".mjs", ".cjs"):
        argv = ["node", str(p)]
    else:
        raise SkillError("Chỉ chạy được script Python (.py) hoặc Node (.js/.mjs/.cjs).")
    argv += _check_args(args)
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith(("ANTHROPIC", "AWS_", "OPENAI", "GITHUB_TOKEN", "GEMINI", "GOOGLE_API"))}
    env["PYTHONIOENCODING"] = "utf-8"
    env["NO_COLOR"] = "1"
    try:
        proc = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=SCRIPT_TIMEOUT)
    except subprocess.TimeoutExpired:
        return 124, f"Hết thời gian ({SCRIPT_TIMEOUT}s)."
    except FileNotFoundError as e:
        return 127, f"Không tìm thấy chương trình: {e}"
    out = (proc.stdout or "") + (("\n[stderr]\n" + proc.stderr) if proc.stderr else "")
    if len(out) > MAX_SCRIPT_OUTPUT:
        out = out[:MAX_SCRIPT_OUTPUT] + "\n…(đã cắt bớt output)"
    return proc.returncode, out.strip() or "(không có output)"


# ---------- cài / gỡ skill trong agency ----------
def install(source: Path, name: str | None = None, overwrite: bool = False, agency_dir: Path | None = None) -> Skill:
    """Copy một thư mục skill (có SKILL.md) vào skills/ của agency."""
    agency_dir = agency_dir or AGENCY_SKILLS_DIR
    source = Path(source).expanduser()
    if not (source / "SKILL.md").is_file():
        raise SkillError("Thư mục này không có SKILL.md.")
    name = name or source.name
    if not NAME_RE.match(name):
        raise SkillError("Tên skill chỉ gồm chữ thường, số, dấu chấm, gạch ngang/gạch dưới.")
    dest = agency_dir / name
    if source.resolve() == dest.resolve():
        raise SkillError("Skill này đã nằm trong agency.")
    total = 0
    files = list(_iter_files(source))
    for f in files:
        total += f.stat().st_size
        if total > MAX_INSTALL_BYTES:
            raise SkillError("Skill quá lớn (> 60MB).")
    if dest.exists():
        if not overwrite:
            raise SkillError(f"Agency đã có skill '{name}'. Bật ghi đè nếu muốn cập nhật.")
        shutil.rmtree(dest)
    for f in files:
        target = dest / f.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)
    s = _load(dest, "agency")
    assert s is not None
    return s


def uninstall(name: str, agency_dir: Path | None = None) -> None:
    agency_dir = agency_dir or AGENCY_SKILLS_DIR
    if not NAME_RE.match(name):
        raise SkillError("Tên skill không hợp lệ.")
    dest = agency_dir / name
    if not (dest / "SKILL.md").is_file():
        raise SkillError("Chỉ gỡ được skill đã cài trong agency (thư mục skills/).")
    shutil.rmtree(dest)
