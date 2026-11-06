"""Lịch sử phiên bản của workspace: mỗi vòng chạy là một commit git trong workspaces/<id>.

Agent không gọi được git (run_command không cho phép), chỉ orchestrator dùng module này.
Nếu máy không có git thì mọi hàm trở thành no-op / trả rỗng — dự án vẫn chạy bình thường.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

GIT = shutil.which("git")
# .agency/ chứa ảnh chụp QA (dữ liệu chạy, không phải code)
EXCLUDES = [".agency/"]
# DB SQLite của Laravel bị .gitignore bỏ qua nhưng cần lưu cùng code để quay về không lệch migration
FORCE_ADD = ["database/database.sqlite"]
STAT_LINE = re.compile(r"^\s*\d+ files? changed")
RUN_TRAILER = re.compile(r"^Agency-Run: (\d+)$", re.M)
MAX_PATCH = 60_000


class VersionError(Exception):
    pass


def available() -> bool:
    return GIT is not None


def _git(ws: Path, *args: str, check: bool = True) -> str:
    if not GIT:
        raise VersionError("Máy chưa cài git.")
    r = subprocess.run(
        [GIT, "-C", str(ws), "-c", "core.autocrlf=false", "-c", "core.quotepath=false",
         "-c", "user.name=AI Agency", "-c", "user.email=agency@localhost", "-c", "commit.gpgsign=false",
         *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
        env=_env(),
    )
    if check and r.returncode != 0:
        raise VersionError((r.stderr or r.stdout).strip()[:500])
    return r.stdout


def _env() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("ANTHROPIC", "GIT_"))}
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def ensure_repo(ws: Path) -> bool:
    """Khởi tạo repo nếu chưa có (kèm commit hiện trạng). Trả False nếu không dùng được git."""
    if not GIT or not ws.exists():
        return False
    if not (ws / ".git").exists():
        _git(ws, "init", "-q", "-b", "main")
        info = ws / ".git" / "info"
        info.mkdir(parents=True, exist_ok=True)
        (info / "exclude").write_text("\n".join(EXCLUDES) + "\n", encoding="utf-8")
        commit(ws, "Hiện trạng ban đầu", run_no=0, allow_empty=True)
    return True


def _stage(ws: Path) -> None:
    _git(ws, "add", "-A")
    for f in FORCE_ADD:
        if (ws / f).is_file():
            _git(ws, "add", "-f", "--", f)


def commit(ws: Path, title: str, run_no: int | None = None, allow_empty: bool = False) -> str | None:
    """Commit toàn bộ thay đổi. Trả sha, hoặc None nếu không có gì thay đổi (và không allow_empty)."""
    if not ensure_repo(ws) and not (ws / ".git").exists():
        return None
    _stage(ws)
    dirty = bool(_git(ws, "status", "--porcelain").strip())
    if not dirty and not allow_empty:
        return None
    msg = title.strip()[:200] or "Cập nhật"
    if run_no is not None:
        msg += f"\n\nAgency-Run: {run_no}"
    _git(ws, "commit", "-q", "--allow-empty", "--no-verify", "-m", msg)
    return _git(ws, "rev-parse", "HEAD").strip()


def safe_commit(ws: Path, title: str, run_no: int | None = None, allow_empty: bool = False) -> str | None:
    """Như commit() nhưng không bao giờ làm hỏng lần chạy."""
    try:
        return commit(ws, title, run_no, allow_empty)
    except Exception:  # noqa: BLE001
        return None


def _check_sha(sha: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{7,40}", sha):
        raise VersionError("Mã phiên bản không hợp lệ.")
    return sha


def list_versions(ws: Path, limit: int = 100) -> list[dict]:
    if not ensure_repo(ws):
        return []
    sep, end = "\x1f", "\x1e"
    out = _git(ws, "log", f"-n{limit}", f"--format=%H{sep}%at{sep}%s{sep}%b{end}", "--shortstat")
    versions = []
    for chunk in out.split(end):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        # chunk = "<stat của commit trước>\n<header commit này>" — stat đứng sau dấu end của commit nó thuộc về
        lines = chunk.split("\n")
        stat_lines = [ln for ln in lines if STAT_LINE.match(ln)]
        if stat_lines and versions:
            versions[-1].update(_parse_stat(stat_lines[0]))
        header = "\n".join(ln for ln in lines if ln not in stat_lines)
        if sep not in header:
            continue
        sha, ts, subject, body = header.split(sep, 3)
        m = RUN_TRAILER.search(body)
        versions.append({"sha": sha.strip(), "time": int(ts), "title": subject,
                         "run_no": int(m.group(1)) if m else None,
                         "files": 0, "insertions": 0, "deletions": 0})
    head = versions[0]["sha"] if versions else None
    for v in versions:
        v["current"] = v["sha"] == head
    return versions


def _parse_stat(line: str) -> dict:
    nums = {k: 0 for k in ("files", "insertions", "deletions")}
    for n, word in re.findall(r"(\d+) (file|insertion|deletion)", line):
        nums[{"file": "files", "insertion": "insertions", "deletion": "deletions"}[word]] = int(n)
    return nums


def diff(ws: Path, sha: str) -> list[dict]:
    """Các file thay đổi trong phiên bản `sha` so với phiên bản trước nó."""
    _check_sha(sha)
    if not (ws / ".git").exists():
        raise VersionError("Dự án chưa có lịch sử phiên bản.")
    parent = _git(ws, "rev-list", "--parents", "-n1", sha).split()
    base = parent[1] if len(parent) > 1 else "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # cây rỗng
    files = []
    for ln in _git(ws, "diff", "--numstat", "-M", base, sha).splitlines():
        add, dele, path = ln.split("\t", 2)
        files.append({"path": path, "insertions": int(add) if add.isdigit() else 0,
                      "deletions": int(dele) if dele.isdigit() else 0, "binary": add == "-"})
    status = {}
    for ln in _git(ws, "diff", "--name-status", "-M", base, sha).splitlines():
        parts = ln.split("\t")
        status[parts[-1]] = {"A": "added", "D": "deleted", "R": "renamed"}.get(parts[0][0], "modified")
    budget = MAX_PATCH
    for f in files:
        f["path"] = _numstat_path(f["path"])
        f["status"] = status.get(f["path"], "modified")
        if f["binary"] or budget <= 0:
            f["patch"] = None
            continue
        patch = _git(ws, "diff", "-M", "--no-color", "-U3", base, sha, "--", f["path"])
        patch = patch.split("\n@@", 1)
        patch = ("@@" + patch[1]) if len(patch) > 1 else ""
        f["patch"], f["truncated"] = patch[:budget], len(patch) > budget
        budget -= len(patch)
    return files


def _numstat_path(p: str) -> str:
    # đổi tên dạng "a/{x => y}/b" hoặc "x => y" → lấy tên mới
    if "=>" not in p:
        return p
    m = re.match(r"(.*)\{(.*) => (.*)\}(.*)", p)
    if m:
        return (m.group(1) + m.group(3) + m.group(4)).replace("//", "/")
    return p.split(" => ")[-1]


def restore(ws: Path, sha: str, label: str) -> str:
    """Đưa code về đúng trạng thái của `sha` bằng một commit mới (không xoá lịch sử)."""
    _check_sha(sha)
    if not ensure_repo(ws):
        raise VersionError("Máy chưa cài git.")
    commit(ws, "Lưu tạm trước khi quay về phiên bản cũ")
    _git(ws, "cat-file", "-e", f"{sha}^{{commit}}")
    # file thêm sau sha → xoá; file có ở sha → lấy nội dung cũ
    for path in _git(ws, "diff", "--name-only", "--diff-filter=A", "--no-renames", sha, "HEAD").splitlines():
        (ws / path).unlink(missing_ok=True)
    _git(ws, "checkout", sha, "--", ".")
    new = commit(ws, label, allow_empty=True)
    assert new
    return new
