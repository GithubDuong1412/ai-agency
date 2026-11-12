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


DEMO_SEO_CANDIDATE = {
    "key": "seo_writer", "name": "Linh", "title": "Content SEO Writer", "department": "Nội dung",
    "color": "#e879f9", "model": "claude-sonnet-5-5", "effort": "medium", "permissions": ["write", "message"],
    "working_style": "Bạn là Content SEO Writer. Bạn viết nội dung trang (tiêu đề, mô tả, đoạn giới thiệu, bài viết) "
                     "chuẩn SEO theo SPEC.md, ghi thẳng vào view Blade mà Frontend đã dựng. Trước khi viết, đọc "
                     "knowledge seo-on-page; viết xong tự kiểm theo checklist rồi nộp cho QA.",
    "rules_markdown": (
        "## Tiêu đề và mô tả\n"
        "- Mỗi trang có `<title>` riêng, 50–60 ký tự, từ khoá chính ở đầu. Lý do: Google cắt tiêu đề dài trên kết quả tìm kiếm.\n"
        "- Meta description 120–160 ký tự, có lời kêu gọi hành động. Lý do: tăng tỉ lệ bấm, tránh bị cắt.\n"
        "- Không trùng title/description giữa các trang.\n"
        "## Cấu trúc nội dung\n"
        "- Mỗi trang đúng 1 thẻ `h1`, chứa từ khoá chính; `h2`/`h3` theo thứ bậc, không nhảy cấp.\n"
        "- Đoạn văn ≤ 4 câu, câu ≤ 25 từ; dùng danh sách khi liệt kê từ 3 ý.\n"
        "- Từ khoá chính xuất hiện trong 100 từ đầu, mật độ tự nhiên (không lặp quá 3 lần mỗi 300 từ).\n"
        "## Ảnh và liên kết\n"
        "- Mọi `<img>` có `alt` mô tả nội dung ảnh (không nhồi từ khoá); ảnh trang trí dùng `alt=\"\"`.\n"
        "- Anchor text mô tả đích đến, không dùng \"bấm vào đây\".\n"
        "## Dữ liệu có cấu trúc\n"
        "- Trang doanh nghiệp địa phương có JSON-LD `LocalBusiness` (tên, địa chỉ, giờ mở cửa, điện thoại) khớp nội dung trang.\n"
        "## Giọng văn\n"
        "- Tiếng Việt tự nhiên, có dấu đầy đủ, xưng hô thống nhất theo SPEC; không sao chép nội dung từ web khác."),
    "checklist_markdown": (
        "## Trước khi viết\n- [ ] Đã đọc SPEC.md và xác định từ khoá chính cho từng trang\n"
        "- [ ] Đã xem bố cục Blade của Frontend để biết vị trí từng đoạn\n"
        "## Tiêu đề và mô tả\n- [ ] Title 50–60 ký tự, không trùng giữa các trang\n"
        "- [ ] Meta description 120–160 ký tự, có lời kêu gọi hành động\n"
        "## Nội dung\n- [ ] Đúng 1 thẻ h1, các h2/h3 đúng thứ bậc\n- [ ] Từ khoá chính trong 100 từ đầu\n"
        "- [ ] Không còn chữ giữ chỗ (lorem ipsum, TODO)\n- [ ] Chính tả tiếng Việt, dấu câu đúng\n"
        "## Ảnh, liên kết, dữ liệu có cấu trúc\n- [ ] Ảnh có alt phù hợp\n- [ ] Anchor text mô tả đích đến\n"
        "- [ ] JSON-LD hợp lệ và khớp nội dung trang\n"
        "## Bàn giao\n- [ ] Ghi danh sách file đã sửa và từ khoá từng trang vào notes_for_qa"),
    "reason": "Đội chưa có ai phụ trách nội dung và SEO.",
    "reference_agents": ["marketing/marketing-seo-specialist.md", "marketing/marketing-content-creator.md"],
    "sources": [
        {"title": "Google Search Central: SEO Starter Guide",
         "url": "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
         "note": "Nền tảng: tiêu đề, mô tả, cấu trúc nội dung, ảnh."},
        {"title": "Google: Influencing your title links",
         "url": "https://developers.google.com/search/docs/appearance/title-link", "note": "Quy tắc viết title."},
        {"title": "schema.org LocalBusiness", "url": "https://schema.org/LocalBusiness",
         "note": "Dữ liệu có cấu trúc cho tiệm, quán, doanh nghiệp địa phương."},
    ],
    "knowledge": [
        {"slug": "seo-on-page", "title": "SEO on-page cho website Laravel",
         "content_markdown": "# SEO on-page cho website Laravel\n\n## Title và meta trong Blade\n"
                             "Đặt trong layout: `<title>@yield('title')</title>` và "
                             "`<meta name=\"description\" content=\"@yield('description')\">`; mỗi view khai báo "
                             "`@section('title', '…')`.\n\n## Ngưỡng nên nhớ\n- Title: 50–60 ký tự\n"
                             "- Meta description: 120–160 ký tự\n- 1 thẻ h1 mỗi trang\n\n## Nguồn\n"
                             "- https://developers.google.com/search/docs/fundamentals/seo-starter-guide"},
        {"slug": "json-ld-local-business", "title": "Mẫu JSON-LD LocalBusiness",
         "content_markdown": "# Mẫu JSON-LD LocalBusiness\n\n```html\n<script type=\"application/ld+json\">\n"
                             "{\"@context\": \"https://schema.org\", \"@type\": \"Bakery\", \"name\": \"Tiệm bánh\", "
                             "\"telephone\": \"+84…\", \"openingHours\": \"Mo-Su 06:00-21:00\"}\n</script>\n```\n\n"
                             "## Nguồn\n- https://schema.org/LocalBusiness"},
    ],
    "skill": {"name": "seo-content-workflow", "description": "Quy trình viết nội dung chuẩn SEO cho một trang web: "
                                                             "chọn từ khoá, dàn ý, viết, tự kiểm.",
              "content_markdown": "# Quy trình viết nội dung chuẩn SEO\n\n1. Đọc SPEC, chọn 1 từ khoá chính + 2–3 "
                                  "từ khoá phụ cho trang.\n2. Lập dàn ý: h1 → các h2 theo ý định tìm kiếm.\n"
                                  "3. Viết title, meta description theo ngưỡng trong knowledge seo-on-page.\n"
                                  "4. Viết nội dung, chèn vào view Blade.\n5. Tự kiểm theo checklist rồi nộp.\n"},
    "existing_skills": [],
    "skill_downloads": [],
}


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

    def submit_hiring(self, _):
        self._say("Đọc yêu cầu tuyển dụng của {@owner}. Mình tìm tài liệu chuẩn nghề trước rồi mới soạn hồ sơ.")
        self._tool("read_reference", "marketing/marketing-seo-specialist.md")
        self._tool("read_reference", "marketing/marketing-content-creator.md")
        self._tool("web_search", "Google title link meta description guidelines 2026")
        self._tool("web_fetch", "https://developers.google.com/search/docs/appearance/title-link")
        self._say("Đã đọc 3 nguồn chính thức, đang chắt lọc thành rules, checklist và tài liệu cho người mới.")
        return {"summary": "Đề xuất tuyển 1 người viết nội dung chuẩn SEO cho các website (demo, dữ liệu mẫu).",
                "candidates": [DEMO_SEO_CANDIDATE]}

    def submit_lessons(self, _):
        return {"lessons": [{"role": "frontend", "text": "Kiểm tiêu đề dài ở màn 375px trước khi nộp, tránh tràn chữ."}]}


def demo_factory():
    state = {"qa": 0}

    def make(role, ctx, hooks):
        return DemoAgent(role, ctx, hooks, state)

    return make
