"""Server tool web của Anthropic (web_search / web_fetch): API tự chạy, không cần code tải trang ở máy.

Chỉ dùng cho lượt PM nghiên cứu khi soạn đề xuất tuyển dụng.
"""
from __future__ import annotations

import re

# Model hỗ trợ bản _20260209 (có lọc động); model cũ hơn dùng bản cơ bản
_DYNAMIC = re.compile(r"^claude-(fable|mythos|opus-(4-[6-9]|5)|sonnet-(4-6|5))")


def web_tools(model: str, cfg: dict | None = None) -> list[dict]:
    cfg = cfg or {}
    search_uses = max(1, int(cfg.get("web_search_uses", 10)))
    fetch_uses = max(1, int(cfg.get("web_fetch_uses", 15)))
    dynamic = bool(_DYNAMIC.match(model or ""))
    return [
        {"type": "web_search_20260209" if dynamic else "web_search_20250305", "name": "web_search",
         "max_uses": search_uses},
        {"type": "web_fetch_20260209" if dynamic else "web_fetch_20250910", "name": "web_fetch",
         "max_uses": fetch_uses, "max_content_tokens": int(cfg.get("web_fetch_max_tokens", 12000))},
    ]
