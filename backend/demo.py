"""Chế độ demo (AGENCY_DEMO=1): agent giả có kịch bản để xem dashboard chạy mà không cần API key.

Không gọi Claude, không tốn tiền. Agent giả vẫn ghi vài file Laravel thật để xem trước được.
"""
from __future__ import annotations

import time

from .agents.base import AgentCancelled, AgentResult

LAYOUT = """<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>@yield('title', 'Demo')</title>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script></head>
<body class="bg-amber-50 text-stone-800">
<header class="bg-stone-900 text-amber-100 p-4 font-bold">Bánh Mì Demo</header>
<main class="max-w-4xl mx-auto p-6">@yield('content')</main></body></html>
"""
HOME = """@extends('layouts.app')
@section('content')
<h1 class="text-4xl font-bold mb-4">Bánh mì nóng giòn mỗi sáng</h1>
<p class="text-lg">Trang demo do đội agent giả tạo ra.</p>
@endsection
"""


class DemoAgent:
    def __init__(self, role, ctx, hooks, state):
        self.role, self.ctx, self.hooks, self.state = role, ctx, hooks, state

    def _say(self, text: str, wait: float = 1.6):
        self.hooks.emit("agent_status", self.role, status="thinking")  # như Agent thật: chờ model trả lời
        for _ in range(int(wait / 0.1)):
            if self.hooks.should_stop():
                raise AgentCancelled()
            time.sleep(0.1)
        self.hooks.emit("message", self.role, text=text, to="all", kind="note")
        self.hooks.emit("agent_status", self.role, status="working")

    def _tool(self, tool: str, summary: str):
        time.sleep(0.9)
        self.hooks.emit("tool", self.role, tool=tool, summary=summary, is_error=False)

    def run(self, instruction: str, submit: str, images=None) -> AgentResult:
        self.hooks.emit("agent_status", self.role, status="working")
        try:
            if images:
                self._say(f"Đã xem {len(images)} ảnh {{@owner}} đính kèm.")
            notes = [n for n in getattr(self.hooks, "owner_notes", lambda: [])() if not n.get("delivered")]
            for n in notes:  # demo: agent vừa tới lượt đọc lời nhắn chen ngang của Sếp
                n["delivered"] = True
                self._say(f"Đã nhận lời nhắn của {{@owner}}: “{n['text'][:80]}”, mình làm theo.")
            return AgentResult(getattr(self, submit)(instruction), 1)
        finally:
            self.hooks.emit("agent_status", self.role, status="idle")

    def submit_plan(self, _):
        self._say("Đã nhận lệnh của {@owner}. Mình đọc yêu cầu và chia việc nhé.")
        self._tool("list_dir", ".")
        self.ctx.post_message("all", "Kế hoạch: {@backend} làm route + form, {@frontend} dựng giao diện. {@qa} test, {@reviewer} duyệt.")
        return {"project_title": "Website tiệm bánh mì (demo)", "summary": "Landing page giới thiệu tiệm.",
                "spec_markdown": "## Trang\n- `/` trang chủ\n", "acceptance_criteria": ["Trang chủ trả 200"],
                "tasks": [{"title": "Route và controller trang chủ", "description": "routes/web.php", "assignee": "backend"},
                          {"title": "Layout + giao diện trang chủ", "description": "Blade + Tailwind", "assignee": "frontend"}]}

    def submit_design(self, _):
        self._say("Tông màu kem ấm + nâu đậm, font Be Vietnam Pro, hero ảnh bánh mì lớn.")
        self.ctx.sandbox.write_file("DESIGN.md", "# Thiết kế demo\n- Màu: #FFFBEB, #1C1917\n")
        self._tool("write_file", "DESIGN.md")
        return {"summary": "Phong cách ấm áp", "pages": ["/"], "palette": ["#FFFBEB", "#1C1917"], "fonts": ["Be Vietnam Pro"]}

    def submit_work(self, instr):
        self._say("Bắt đầu làm task này.")
        if self.role == "frontend":
            self.ctx.sandbox.write_file("resources/views/layouts/app.blade.php", LAYOUT)
            self._tool("write_file", "resources/views/layouts/app.blade.php")
            self.ctx.sandbox.write_file("resources/views/home.blade.php", HOME)
            self._tool("write_file", "resources/views/home.blade.php")
        else:
            self.ctx.sandbox.write_file("routes/web.php", "<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\n"
                                        "Route::get('/', fn () => view('welcome'));\nRoute::view('/home', 'home');\n")
            self._tool("write_file", "routes/web.php")
        self._tool("run_command", "php artisan test → 0")
        self._say("Xong, chuyển QA kiểm tra.")
        return {"summary": "Đã làm xong", "files_changed": ["routes/web.php"], "notes_for_qa": "Mở / và /home"}

    def submit_qa(self, _):
        self.state["qa"] += 1
        self._tool("run_command", "php artisan test → 0")
        self._tool("screenshot", "/ (mobile)")
        if self.state["qa"] == 1:
            self._say("Lần đầu: chữ tiêu đề bị tràn trên mobile, trả lại cho Dev.")
            return {"passed": False, "summary": "Tràn chữ mobile", "tests_run": ["php artisan test"],
                    "issues": [{"title": "Tràn chữ", "detail": "h1 quá lớn trên 390px", "assignee": "backend", "severity": "medium"}]}
        self._say("Đạt yêu cầu.")
        return {"passed": True, "summary": "OK", "tests_run": ["php artisan test"], "issues": []}

    def submit_review(self, _):
        self._tool("screenshot", "/home (desktop)")
        self._say("Đối chiếu spec: đạt. Code gọn, có layout chung.")
        return {"verdict": "approve", "score": 8, "summary": "Đạt tiêu chí demo.", "strengths": ["Gọn"], "issues": []}

    def submit_report(self, _):
        self._say("Tổng hợp báo cáo gửi {@owner}.")
        return {"headline": "Đã xong website demo tiệm bánh mì", "summary_markdown":
                "## Kết quả\n- Trang `/home` đã dựng xong.\n- QA phát hiện 1 lỗi, đã sửa.\n- Kiểm duyệt: đạt 8/10.\n\n"
                "_Đây là chế độ demo, agent là giả lập._",
                "how_to_check": ["Bấm Xem trước, mở /home"], "known_issues": [], "next_steps": ["Thêm API key để chạy thật"]}

    def submit_lessons(self, _):
        return {"lessons": [{"role": "frontend", "text": "Kiểm tiêu đề dài ở màn 375px trước khi nộp, tránh tràn chữ."}]}


def demo_factory():
    state = {"qa": 0}

    def make(role, ctx, hooks):
        return DemoAgent(role, ctx, hooks, state)

    return make
