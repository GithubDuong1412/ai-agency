"""Chụp màn hình trang preview bằng Playwright để QA / Kiểm duyệt "nhìn" giao diện."""
from __future__ import annotations

import time
from pathlib import Path

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "mobile": {"width": 390, "height": 844},
}


EMAIL_FIELD = ("input[type=email], input[name=email], input[name=username], input[name=login], "
               "input[name=user], input[autocomplete=username]")


def _login(page, base_url: str, login: dict) -> str:
    """Đăng nhập qua form của chính trang (cookie phiên giữ lại cho lần mở trang cần chụp). Trả về kết quả."""
    lp = login.get("path") or "/login"
    if not lp.startswith("/"):
        lp = "/" + lp
    page.goto(base_url + lp, wait_until="networkidle", timeout=30_000)
    pw_field = page.locator("input[type=password]").first
    if not pw_field.count():
        return f"không thấy ô mật khẩu ở {lp}"
    user_field = page.locator(EMAIL_FIELD).first
    if not user_field.count():
        return f"không thấy ô email/tên đăng nhập ở {lp}"
    user_field.fill(login.get("email", ""))
    pw_field.fill(login.get("password", ""))
    submit = page.locator("form:has(input[type=password]) [type=submit]").first
    with page.expect_navigation(wait_until="networkidle", timeout=30_000):
        submit.click() if submit.count() else pw_field.press("Enter")
    if page.locator("input[type=password]").count():
        return "thất bại (vẫn ở trang đăng nhập — kiểm tra email/mật khẩu trong seeder)"
    return "thành công"


def take_screenshot(base_url: str, path: str, viewport: str, out_dir: Path,
                    full_page: bool = True, login: dict | None = None) -> tuple[Path, dict]:
    """Trả về (file ảnh, thông tin trang: status, title, lỗi console, kết quả đăng nhập nếu có).

    login = {"path": "/admin/dang-nhap", "email": "...", "password": "..."}: đăng nhập trước rồi mới mở trang.
    """
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
            login_result = None
            if login:
                try:
                    login_result = _login(page, base_url, login)
                except Exception as e:  # noqa: BLE001 — vẫn chụp trang để agent thấy chuyện gì xảy ra
                    login_result = f"lỗi: {str(e)[:200]}"
                console_errors.clear()  # lỗi console của trang đăng nhập không thuộc trang cần chụp
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
                "login": login_result,
                "final_url": page.url,
            }
        finally:
            browser.close()
    return out, info
