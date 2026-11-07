"""Lưu trữ SQLite: projects, tasks, events, reports."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .settings import DATA_DIR

_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    spec TEXT,
    preview_port INTEGER,
    run_count INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    assignee TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'plan',
    run_no INTEGER NOT NULL DEFAULT 1,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    agent TEXT,
    data TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, id);
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_no INTEGER NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL,
    feedback TEXT,
    created_at REAL NOT NULL
);
"""


class DB:
    def __init__(self, path: Path | str | None = None):
        if path is None:
            path = DATA_DIR / "agency.db"
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    # ---------- helpers ----------
    def _exec(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def _all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def _one(self, sql: str, params: tuple = ()) -> dict | None:
        with self._lock:
            r = self._conn.execute(sql, params).fetchone()
            return dict(r) if r else None

    # ---------- projects ----------
    def create_project(self, prompt: str, title: str | None = None) -> dict:
        pid = uuid.uuid4().hex[:10]
        now = time.time()
        title = title or (prompt.strip().splitlines()[0][:80] if prompt.strip() else "Dự án mới")
        self._exec(
            "INSERT INTO projects (id, title, prompt, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (pid, title, prompt, "queued", now, now),
        )
        return self.get_project(pid)  # type: ignore[return-value]

    def get_project(self, pid: str) -> dict | None:
        return self._one("SELECT * FROM projects WHERE id=?", (pid,))

    def list_projects(self) -> list[dict]:
        return self._all("SELECT * FROM projects ORDER BY created_at DESC")

    def update_project(self, pid: str, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k}=?" for k in fields)
        self._exec(f"UPDATE projects SET {cols} WHERE id=?", (*fields.values(), pid))

    def add_usage(self, pid: str, input_tokens: int, output_tokens: int, cost: float) -> None:
        self._exec(
            "UPDATE projects SET input_tokens=input_tokens+?, output_tokens=output_tokens+?, "
            "cost_usd=cost_usd+?, updated_at=? WHERE id=?",
            (input_tokens, output_tokens, cost, time.time(), pid),
        )

    # Câu cố định do hệ thống sinh ở các bản cũ (ghi cứng tên) -> mã vai trò. Chạy lại không sao (idempotent).
    _NAME_TOKEN_MIGRATIONS = [
        ("nhờ Lan lên thiết kế", "nhờ {@designer} lên thiết kế"),
        ("nhờ Quang kiểm duyệt tổng thể", "nhờ {@reviewer} kiểm duyệt tổng thể"),
        ("nhờ anh Minh tổng hợp báo cáo", "nhờ anh {@pm} tổng hợp báo cáo"),
        ("Kế hoạch: Nam làm route + form, Huy dựng giao diện. Thảo test, Quang duyệt.",
         "Kế hoạch: {@backend} làm route + form, {@frontend} dựng giao diện. {@qa} test, {@reviewer} duyệt."),
        ("Đã nhận lệnh của Sếp. Mình đọc yêu cầu", "Đã nhận lệnh của {@owner}. Mình đọc yêu cầu"),
        ("Tổng hợp báo cáo gửi Sếp.", "Tổng hợp báo cáo gửi {@owner}."),
    ]

    def migrate_name_tokens(self) -> None:
        for old, new in self._NAME_TOKEN_MIGRATIONS:
            self._exec("UPDATE events SET data = replace(data, ?, ?) WHERE instr(data, ?) > 0", (old, new, old))

    def mark_interrupted(self) -> None:
        """Khi server khởi động lại, các project đang chạy dở bị đánh dấu gián đoạn."""
        self._exec(
            "UPDATE projects SET status='interrupted', updated_at=? WHERE status IN ('queued','running')",
            (time.time(),),
        )

    # ---------- tasks ----------
    def create_task(self, pid: str, title: str, description: str, assignee: str,
                    source: str = "plan", run_no: int = 1) -> dict:
        tid = uuid.uuid4().hex[:10]
        now = time.time()
        self._exec(
            "INSERT INTO tasks (id, project_id, title, description, assignee, status, source, run_no, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (tid, pid, title, description, assignee, "todo", source, run_no, now, now),
        )
        return self._one("SELECT * FROM tasks WHERE id=?", (tid,))  # type: ignore[return-value]

    def update_task(self, tid: str, **fields: Any) -> None:
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k}=?" for k in fields)
        self._exec(f"UPDATE tasks SET {cols} WHERE id=?", (*fields.values(), tid))

    def list_tasks(self, pid: str | None = None) -> list[dict]:
        if pid:
            return self._all("SELECT * FROM tasks WHERE project_id=? ORDER BY created_at", (pid,))
        return self._all("SELECT * FROM tasks ORDER BY created_at")

    # ---------- events ----------
    def add_event(self, pid: str, type_: str, agent: str | None, data: dict) -> dict:
        now = time.time()
        cur = self._exec(
            "INSERT INTO events (project_id, type, agent, data, created_at) VALUES (?,?,?,?,?)",
            (pid, type_, agent, json.dumps(data, ensure_ascii=False), now),
        )
        return {"id": cur.lastrowid, "project_id": pid, "type": type_, "agent": agent,
                "data": data, "created_at": now}

    def list_events(self, pid: str | None = None, after: int = 0, limit: int = 500) -> list[dict]:
        if pid:
            rows = self._all(
                "SELECT * FROM events WHERE project_id=? AND id>? ORDER BY id LIMIT ?", (pid, after, limit))
        else:
            rows = self._all(
                "SELECT * FROM (SELECT * FROM events WHERE id>? ORDER BY id DESC LIMIT ?) ORDER BY id",
                (after, limit))
        for r in rows:
            r["data"] = json.loads(r["data"])
        return rows

    # ---------- reports ----------
    def create_report(self, pid: str, run_no: int, content: dict) -> dict:
        rid = uuid.uuid4().hex[:10]
        self._exec(
            "INSERT INTO reports (id, project_id, run_no, content, status, created_at) VALUES (?,?,?,?,?,?)",
            (rid, pid, run_no, json.dumps(content, ensure_ascii=False), "pending", time.time()),
        )
        return self.get_report(rid)  # type: ignore[return-value]

    def get_report(self, rid: str) -> dict | None:
        r = self._one("SELECT * FROM reports WHERE id=?", (rid,))
        if r:
            r["content"] = json.loads(r["content"])
        return r

    def list_reports(self, pid: str | None = None) -> list[dict]:
        if pid:
            rows = self._all("SELECT * FROM reports WHERE project_id=? ORDER BY created_at DESC", (pid,))
        else:
            rows = self._all("SELECT * FROM reports ORDER BY created_at DESC")
        for r in rows:
            r["content"] = json.loads(r["content"])
        return rows

    def update_report(self, rid: str, **fields: Any) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        self._exec(f"UPDATE reports SET {cols} WHERE id=?", (*fields.values(), rid))
