"""Quản lý server xem trước `php artisan serve` cho từng project."""
from __future__ import annotations

import socket
import subprocess
import threading
import time
from pathlib import Path


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _http_ready(url: str) -> bool:
    """True khi server trả về bất kỳ phản hồi HTTP nào (kể cả 404/500 — vẫn xem được trang lỗi Laravel)."""
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=3):
            return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


class PreviewManager:
    def __init__(self, php_bin: str, port_start: int = 8100):
        self.php_bin = php_bin
        self.port_start = port_start
        self._procs: dict[str, tuple[subprocess.Popen, int]] = {}
        self._lock = threading.Lock()

    def _free_port(self) -> int:
        used = {p for _, p in self._procs.values()}
        port = self.port_start
        while port in used or _port_open(port):
            port += 1
        return port

    def url(self, project_id: str) -> str | None:
        with self._lock:
            item = self._procs.get(project_id)
        if item and item[0].poll() is None:
            return f"http://127.0.0.1:{item[1]}"
        return None

    def start(self, project_id: str, workspace: Path, port: int | None = None) -> str:
        with self._lock:
            item = self._procs.get(project_id)
            if item and item[0].poll() is None:
                return f"http://127.0.0.1:{item[1]}"
            if port is None or _port_open(port):
                port = self._free_port()
            proc = subprocess.Popen(
                [self.php_bin, "artisan", "serve", "--host=127.0.0.1", f"--port={port}"],
                cwd=workspace, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            self._procs[project_id] = (proc, port)
        url = f"http://127.0.0.1:{port}"
        # Cổng mở chưa chắc Laravel đã trả lời được (lần đầu boot/compile view chậm): chờ tới khi có phản hồi HTTP
        # để khung xem trước không tải vào lúc server còn đang khởi động (hiện trang lỗi).
        deadline = time.time() + 20
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError("Không khởi động được php artisan serve.")
            if _port_open(port) and _http_ready(url):
                break
            time.sleep(0.25)
        return url

    def stop(self, project_id: str) -> None:
        with self._lock:
            item = self._procs.pop(project_id, None)
        if item:
            proc = item[0]
            # artisan serve sinh tiến trình con php -S; kill cả cây trên Windows
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                               capture_output=True, timeout=10)
            except Exception:
                proc.kill()

    def stop_all(self) -> None:
        for pid in list(self._procs):
            self.stop(pid)
