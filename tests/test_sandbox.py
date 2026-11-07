import pytest

from backend.tools.fs_tools import Sandbox, SandboxError
from backend.tools.shell_tools import CommandRunner


@pytest.fixture
def sb(tmp_path):
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "a.php").write_text("<?php echo 1;", encoding="utf-8")
    return Sandbox(tmp_path)


@pytest.mark.parametrize("bad", ["../x", "app/../../x", "/etc/passwd", "C:/Windows/win.ini", "C:\\x", "..\\x"])
def test_rejects_escape(sb, bad):
    with pytest.raises(SandboxError):
        sb.resolve(bad)


def test_read_write_edit(sb):
    assert "Đã tạo" in sb.write_file("resources/views/home.blade.php", "hello world")
    assert sb.read_file("resources/views/home.blade.php") == "hello world"
    sb.edit_file("resources/views/home.blade.php", "world", "agency")
    assert sb.read_file("resources/views/home.blade.php") == "hello agency"
    with pytest.raises(SandboxError):
        sb.edit_file("resources/views/home.blade.php", "missing", "x")


def test_readonly_vendor(sb):
    with pytest.raises(SandboxError):
        sb.write_file("vendor/autoload.php", "x")


def test_list_and_search(sb):
    assert "a.php" in sb.list_dir(".")
    assert "app/a.php:1" in sb.search_files("echo")


@pytest.fixture
def runner(tmp_path):
    return CommandRunner(tmp_path, "PHP", "COMPOSER.phar", "npm")


@pytest.mark.parametrize("cmd,expected", [
    ("php artisan test", ["PHP", "artisan", "test"]),
    ("php artisan migrate --force", ["PHP", "artisan", "migrate", "--force"]),
    ("php -l app/a.php", ["PHP", "-l", "app/a.php"]),
    ("composer require laravel/sanctum", ["PHP", "COMPOSER.phar", "require", "laravel/sanctum", "--no-interaction"]),
    ("npm run build", ["npm", "run", "build"]),
])
def test_allowed_commands(runner, cmd, expected):
    assert runner.build_argv(cmd) == expected


@pytest.mark.parametrize("cmd", [
    "php artisan tinker", "php artisan serve", "php -r \"echo 1;\"", "rm -rf .", "php artisan test && del x",
    "composer run-script evil", "npm run dev", "php -l ../outside.php", "powershell -c x", "php artisan test > out",
    "cmd /c dir", "php -l C:/x.php",
    # xoá dữ liệu thật trong database.sqlite
    "php artisan migrate:fresh --seed --force", "php artisan migrate:refresh", "php artisan migrate:reset",
    "php artisan migrate:rollback", "php artisan DB:WIPE",
])
def test_blocked_commands(runner, cmd):
    with pytest.raises(SandboxError):
        runner.build_argv(cmd)
