"""Công cụ file giới hạn trong workspace của một project."""
from __future__ import annotations

import fnmatch
import os
from pathlib import Path, PurePosixPath, PureWindowsPath


class SandboxError(Exception):
    pass


# Thư mục bỏ qua khi liệt kê / tìm kiếm (quá lớn hoặc không cần đọc)
SKIP_DIRS = {"vendor", "node_modules", ".git", "storage", ".agency", "bootstrap/cache"}
MAX_READ_CHARS = 60_000
MAX_WRITE_CHARS = 400_000


class Sandbox:
    def __init__(self, root: Path | str, read_only_globs: list[str] | None = None):
        self.root = Path(root).resolve()
        # Các file agent không được ghi (vd. composer.lock, vendor/)
        self.read_only_globs = read_only_globs or ["vendor/*", "node_modules/*", ".git/*", ".agency/*"]

    # ---------- path ----------
    def resolve(self, rel: str) -> Path:
        if rel is None:
            raise SandboxError("Thiếu đường dẫn.")
        rel = str(rel).strip().replace("\\", "/")
        if rel in ("", "."):
            return self.root
        if PurePosixPath(rel).is_absolute() or PureWindowsPath(rel).is_absolute() or PureWindowsPath(rel).drive:
            raise SandboxError("Chỉ dùng đường dẫn tương đối trong workspace.")
        if any(part == ".." for part in PurePosixPath(rel).parts):
            raise SandboxError("Không được dùng '..' để thoát khỏi workspace.")
        p = (self.root / rel).resolve()
        if p != self.root and self.root not in p.parents:
            raise SandboxError("Đường dẫn nằm ngoài workspace.")
        return p

    def rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix() or "."

    def _check_writable(self, p: Path) -> None:
        r = self.rel(p)
        for g in self.read_only_globs:
            if fnmatch.fnmatch(r, g) or r == g.rstrip("/*"):
                raise SandboxError(f"Không được ghi vào '{r}' (vùng chỉ đọc).")

    # ---------- tools ----------
    def list_dir(self, path: str = ".", depth: int = 2) -> str:
        base = self.resolve(path)
        if not base.is_dir():
            raise SandboxError(f"'{path}' không phải thư mục.")
        depth = max(1, min(int(depth or 2), 5))
        lines: list[str] = []
        base_depth = len(base.relative_to(self.root).parts)
        for dirpath, dirnames, filenames in os.walk(base):
            d = Path(dirpath)
            rel = self.rel(d)
            level = len(d.relative_to(self.root).parts) - base_depth
            dirnames[:] = sorted(
                n for n in dirnames
                if n not in SKIP_DIRS and (Path(rel) / n).as_posix() not in SKIP_DIRS
            )
            if level >= depth:
                dirnames[:] = []
            indent = "  " * level
            if level > 0:
                lines.append(f"{indent[:-2]}{d.name}/")
            for f in sorted(filenames):
                lines.append(f"{indent}{f}")
            if len(lines) > 400:
                lines.append("... (đã cắt bớt)")
                break
        return "\n".join(lines) or "(trống)"

    def read_file(self, path: str, start_line: int | None = None, end_line: int | None = None) -> str:
        p = self.resolve(path)
        if not p.is_file():
            raise SandboxError(f"Không tìm thấy file '{path}'.")
        text = p.read_text(encoding="utf-8", errors="replace")
        if start_line or end_line:
            lines = text.splitlines()
            s = max(1, int(start_line or 1))
            e = min(len(lines), int(end_line or len(lines)))
            text = "\n".join(f"{i}: {lines[i - 1]}" for i in range(s, e + 1))
        if len(text) > MAX_READ_CHARS:
            text = text[:MAX_READ_CHARS] + f"\n... (đã cắt, file dài {len(text)} ký tự; dùng start_line/end_line)"
        return text

    def write_file(self, path: str, content: str) -> str:
        p = self.resolve(path)
        self._check_writable(p)
        if len(content) > MAX_WRITE_CHARS:
            raise SandboxError("Nội dung quá lớn.")
        p.parent.mkdir(parents=True, exist_ok=True)
        existed = p.exists()
        p.write_text(content, encoding="utf-8", newline="\n")
        return f"{'Đã cập nhật' if existed else 'Đã tạo'} {self.rel(p)} ({len(content)} ký tự)."

    def edit_file(self, path: str, old_text: str, new_text: str) -> str:
        p = self.resolve(path)
        self._check_writable(p)
        if not p.is_file():
            raise SandboxError(f"Không tìm thấy file '{path}'.")
        text = p.read_text(encoding="utf-8")
        count = text.count(old_text)
        if count == 0:
            raise SandboxError("Không tìm thấy old_text trong file. Hãy read_file lại để lấy đúng nội dung.")
        if count > 1:
            raise SandboxError(f"old_text xuất hiện {count} lần; hãy thêm ngữ cảnh để nó là duy nhất.")
        p.write_text(text.replace(old_text, new_text, 1), encoding="utf-8", newline="\n")
        return f"Đã sửa {self.rel(p)}."

    def delete_file(self, path: str) -> str:
        p = self.resolve(path)
        self._check_writable(p)
        if not p.is_file():
            raise SandboxError(f"Không tìm thấy file '{path}'.")
        p.unlink()
        return f"Đã xoá {self.rel(p)}."

    def search_files(self, pattern: str, path: str = ".") -> str:
        base = self.resolve(path)
        pattern_l = pattern.lower()
        hits: list[str] = []
        for dirpath, dirnames, filenames in os.walk(base):
            d = Path(dirpath)
            dirnames[:] = [n for n in dirnames if n not in SKIP_DIRS]
            for f in filenames:
                fp = d / f
                if fp.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".ico", ".sqlite", ".woff", ".woff2"}:
                    continue
                try:
                    for i, line in enumerate(fp.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                        if pattern_l in line.lower():
                            hits.append(f"{self.rel(fp)}:{i}: {line.strip()[:200]}")
                            if len(hits) >= 100:
                                return "\n".join(hits) + "\n... (đã cắt ở 100 kết quả)"
                except OSError:
                    continue
        return "\n".join(hits) or "Không có kết quả."
