"""run_command: chỉ cho phép một số lệnh PHP/Composer/NPM, chạy trong workspace."""
from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path

from .fs_tools import SandboxError

MAX_OUTPUT = 12_000

# Lệnh artisan bị cấm (chạy code tuỳ ý hoặc chặn tiến trình)
BLOCKED_ARTISAN = {"tinker", "serve", "down", "up", "queue:work", "queue:listen", "schedule:work",
                   "reverb:start", "octane:start", "pail", "env:decrypt", "env:encrypt"}
# Lệnh xoá dữ liệu thật trong database/database.sqlite (lịch đặt, đơn hàng… do khách nhập khi xem trước)
BLOCKED_DATA = {"migrate:fresh", "migrate:refresh", "migrate:reset", "migrate:rollback", "db:wipe"}
ALLOWED_COMPOSER = {"install", "require", "remove", "dump-autoload", "update", "show", "validate"}
ALLOWED_NPM = {"install", "ci", "run"}
ALLOWED_NPM_SCRIPTS = {"build"}
SHELL_META = set("&|;<>`$\n\r")


class CommandRunner:
    def __init__(self, root: Path, php_bin: str, composer_phar: str, npm_bin: str = "npm",
                 timeout: int = 240):
        self.root = Path(root).resolve()
        self.php_bin = php_bin
        self.composer_phar = composer_phar
        self.npm_bin = npm_bin
        self.timeout = timeout

    def build_argv(self, command: str) -> list[str]:
        """Kiểm tra lệnh và trả về argv thật sẽ chạy. Ném SandboxError nếu không hợp lệ."""
        command = (command or "").strip()
        if not command:
            raise SandboxError("Lệnh rỗng.")
        if any(c in SHELL_META for c in command):
            raise SandboxError("Không hỗ trợ ký tự shell (&, |, ;, >, <, $, `). Chạy từng lệnh một.")
        try:
            parts = shlex.split(command, posix=True)
        except ValueError as e:
            raise SandboxError(f"Lệnh không hợp lệ: {e}")
        for a in parts:
            a_n = a.replace("\\", "/")
            if ".." in a_n.split("/") or a_n.startswith("/") or (len(a_n) > 1 and a_n[1] == ":"):
                raise SandboxError("Tham số không được trỏ ra ngoài workspace.")
        prog, args = parts[0].lower(), parts[1:]

        if prog in ("php", "php.exe"):
            if not args:
                raise SandboxError("Thiếu tham số cho php.")
            if args[0] == "artisan":
                if len(args) < 2:
                    return [self.php_bin, "artisan", "list"]
                sub = args[1].lower()
                if sub in BLOCKED_DATA:
                    raise SandboxError(f"Không được chạy 'php artisan {sub}': lệnh này xoá dữ liệu thật mà Sếp/khách đã nhập. "
                                       "Dùng 'php artisan migrate --force' (chỉ thêm thay đổi mới) và seeder chạy lại được "
                                       "(updateOrCreate/firstOrCreate). Cần dữ liệu sạch thì viết test (test dùng DB riêng trong bộ nhớ).")
                if sub in BLOCKED_ARTISAN:
                    raise SandboxError(f"Không được chạy 'php artisan {sub}'. "
                                       "Server xem trước do hệ thống quản lý.")
                return [self.php_bin, *args]
            if args[0] == "-l" and len(args) == 2:
                return [self.php_bin, "-l", args[1]]
            if args[0].replace("\\", "/") in ("vendor/bin/phpunit", "vendor/bin/pint"):
                return [self.php_bin, *args]
            raise SandboxError("Chỉ cho phép: php artisan ..., php -l <file>, php vendor/bin/phpunit, "
                               "php vendor/bin/pint.")
        if prog == "composer":
            if not args or args[0] not in ALLOWED_COMPOSER:
                raise SandboxError(f"Chỉ cho phép composer: {', '.join(sorted(ALLOWED_COMPOSER))}.")
            return [self.php_bin, self.composer_phar, *args, "--no-interaction"]
        if prog == "npm":
            if not args or args[0] not in ALLOWED_NPM:
                raise SandboxError("Chỉ cho phép: npm install, npm ci, npm run build.")
            if args[0] == "run" and (len(args) < 2 or args[1] not in ALLOWED_NPM_SCRIPTS):
                raise SandboxError("Chỉ cho phép 'npm run build'.")
            return [self.npm_bin, *args]
        raise SandboxError("Lệnh không được phép. Dùng được: php artisan ..., php -l, composer ..., "
                           "npm install / npm run build.")

    def run(self, command: str) -> tuple[int, str]:
        argv = self.build_argv(command)
        env = {k: v for k, v in os.environ.items()
               if not k.upper().startswith(("ANTHROPIC", "AWS_", "OPENAI", "GITHUB_TOKEN"))}
        env["COMPOSER_NO_INTERACTION"] = "1"
        env["NO_COLOR"] = "1"
        try:
            proc = subprocess.run(
                argv, cwd=self.root, env=env, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=self.timeout,
                shell=(os.name == "nt" and argv[0] == self.npm_bin),  # npm là .cmd trên Windows
            )
        except subprocess.TimeoutExpired:
            return 124, f"Hết thời gian ({self.timeout}s)."
        except FileNotFoundError as e:
            return 127, f"Không tìm thấy chương trình: {e}"
        out = (proc.stdout or "") + (("\n[stderr]\n" + proc.stderr) if proc.stderr else "")
        if len(out) > MAX_OUTPUT:
            out = out[:3000] + "\n... (đã cắt) ...\n" + out[-(MAX_OUTPUT - 3000):]
        return proc.returncode, out.strip() or "(không có output)"
