"""Chụp màn hình trang preview bằng Playwright để QA / Kiểm duyệt "nhìn" giao diện."""
from __future__ import annotations

import time
from pathlib import Path

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "mobile": {"width": 390, "height": 844},
}


def take_screenshot(base_url: str, path: str, viewport: str, out_dir: Path,
                    full_page: bool = True) -> tuple[Path, dict]:
    """Trả về (file ảnh, thông tin trang: status, title, lỗi console)."""
    from playwright.sync_api import sync_playwright

    if not path.startswith("/"):
        path = "/" + path
    vp = VIEWPORTS.get(viewport, VIEWPORTS["desktop"])
    out_dir.mkdir(parents=True, exist_ok=True)
    safe = path.strip("/").replace("/", "_") or "home"
    out = out_dir / f"{int(time.time() * 1000)}_{safe}_{viewport}.png"
    console_errors: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport=vp, is_mobile=(viewport == "mobile"))
            page.on("console", lambda m: m.type == "error" and console_errors.append(m.text[:300]))
            page.on("pageerror", lambda e: console_errors.append(str(e)[:300]))
            resp = page.goto(base_url + path, wait_until="networkidle", timeout=30_000)
            page.wait_for_timeout(500)
            # giới hạn chiều cao ảnh để không quá lớn
            height = page.evaluate("document.documentElement.scrollHeight")
            if full_page and height > 3000:
                page.set_viewport_size({"width": vp["width"], "height": 3000})
                page.screenshot(path=str(out))
            else:
                page.screenshot(path=str(out), full_page=full_page)
            info = {
                "status": resp.status if resp else None,
                "title": page.title(),
                "console_errors": console_errors[:10],
                "page_height": height,
            }
        finally:
            browser.close()
    return out, info
