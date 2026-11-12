"""Định nghĩa schema tool cho Claude và thực thi tool theo quyền của từng vai trò."""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .fs_tools import Sandbox, SandboxError
from .shell_tools import CommandRunner

# ---------- schema các tool dùng chung ----------
TOOL_SCHEMAS: dict[str, dict] = {
    "list_dir": {
        "description": "Liệt kê file/thư mục trong workspace (bỏ qua vendor, node_modules, storage).",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Đường dẫn tương đối, '.' là gốc dự án."},
                "depth": {"type": "integer", "description": "Độ sâu 1-5, mặc định 2."},
            },
            "required": ["path"],
        },
    },
    "read_file": {
        "description": "Đọc nội dung một file trong workspace. Có thể đọc theo khoảng dòng.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "start_line": {"type": "integer"},
                "end_line": {"type": "integer"},
            },
            "required": ["path"],
        },
    },
    "search_files": {
        "description": "Tìm chuỗi (không phân biệt hoa thường) trong các file của workspace.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "path": {"type": "string", "description": "Thư mục tìm, mặc định '.'"},
            },
            "required": ["pattern"],
        },
    },
    "view_image": {
        "description": ("Xem một file ảnh trong workspace (PNG, JPEG, WebP, GIF; tối đa 5MB), vd. ảnh Sếp đính kèm "
                        "ở .agency/attachments/ hoặc ảnh trong public/. Trả về chính ảnh để bạn nhìn."),
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Đường dẫn tương đối, vd. .agency/attachments/1_1.jpg"}},
            "required": ["path"],
        },
    },
    "write_file": {
        "description": "Tạo mới hoặc ghi đè toàn bộ một file. Dùng edit_file cho thay đổi nhỏ.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    "edit_file": {
        "description": "Thay một đoạn old_text (phải xuất hiện đúng 1 lần) bằng new_text.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_text": {"type": "string"},
                "new_text": {"type": "string"},
            },
            "required": ["path", "old_text", "new_text"],
        },
    },
    "delete_file": {
        "description": "Xoá một file trong workspace.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    "run_command": {
        "description": (
            "Chạy một lệnh trong thư mục dự án Laravel. Chỉ cho phép: 'php artisan <lệnh>' (trừ tinker/serve và các lệnh xoá DB như migrate:fresh/refresh/reset/rollback, db:wipe), "
            "'php -l <file>', 'php vendor/bin/phpunit', 'composer install|require|remove|dump-autoload|update', "
            "'npm install', 'npm run build'. Không dùng &&, |, >."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"command": {"type": "string", "description": "Ví dụ: php artisan test"}},
            "required": ["command"],
        },
    },
    "screenshot": {
        "description": (
            "Mở trang trên server xem trước của dự án và chụp màn hình để bạn xem giao diện. "
            "Trả về ảnh, HTTP status, title và lỗi console. Trang cần đăng nhập (vd. /admin/...): truyền thêm "
            "login_path, login_email, login_password (tài khoản mẫu trong database/seeders) để công cụ đăng nhập "
            "qua form trước rồi mới chụp."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Đường dẫn URL, ví dụ '/' hoặc '/menu'."},
                "viewport": {"type": "string", "enum": ["desktop", "mobile"]},
                "login_path": {"type": "string", "description": "Trang đăng nhập, vd. '/admin/dang-nhap' hoặc '/login'."},
                "login_email": {"type": "string", "description": "Email/tên đăng nhập tài khoản mẫu."},
                "login_password": {"type": "string", "description": "Mật khẩu tài khoản mẫu."},
            },
            "required": ["path", "viewport"],
        },
    },
    "read_knowledge": {
        "description": (
            "Đọc một tài liệu kiến thức chuyên môn trong hồ sơ của bạn (mẫu code, checklist, quy ước). "
            "Danh sách mã chủ đề có trong phần 'Kiến thức chuyên môn tra cứu được' của system prompt."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"topic": {"type": "string", "description": "Mã chủ đề, ví dụ 'laravel-quy-uoc'."}},
            "required": ["topic"],
        },
    },
    "read_reference": {
        "description": (
            "Đọc một file agent mẫu trong thư viện agency-agents (đường dẫn lấy từ danh mục trong lời giao việc). "
            "File dài: đọc tiếp bằng offset."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Vd. 'marketing/marketing-seo-specialist.md'"},
                "offset": {"type": "integer", "description": "Vị trí ký tự bắt đầu đọc, mặc định 0"},
            },
            "required": ["path"],
        },
    },
    "use_skill": {
        "description": (
            "Đọc hướng dẫn của một skill bạn được giao (mặc định SKILL.md). Có thể đọc file kèm theo trong skill "
            "(vd. references/x.md) hoặc file='.' để xem danh sách file. File dài: đọc tiếp bằng offset."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "skill": {"type": "string"},
                "file": {"type": "string", "description": "Đường dẫn tương đối trong skill, mặc định SKILL.md"},
                "offset": {"type": "integer", "description": "Vị trí ký tự bắt đầu đọc, mặc định 0"},
            },
            "required": ["skill"],
        },
    },
    "run_skill_script": {
        "description": (
            "Chạy một script (Python/Node) của skill bạn được giao, thư mục làm việc là gốc dự án. "
            "Truyền tham số dạng danh sách, không qua shell. Chỉ dùng đường dẫn tương đối."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "skill": {"type": "string"},
                "script": {"type": "string", "description": "Vd. scripts/search.py"},
                "args": {"type": "array", "items": {"type": "string"}, "description": "Vd. [\"bakery landing\", \"--domain\", \"color\"]"},
            },
            "required": ["skill", "script"],
        },
    },
    "post_message": {
        "description": (
            "Gửi một tin nhắn ngắn tới đồng đội (hiện trên bảng tin chung của agency). "
            "Dùng để hỏi, báo tiến độ hoặc dặn dò người làm bước sau."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Mã vai trò người nhận (xem danh sách đội: pm, designer, "
                                                        "frontend, backend, qa, reviewer, người tuyển thêm…) hoặc all"},
                "text": {"type": "string"},
            },
            "required": ["to", "text"],
        },
    },
}

READ_TOOLS = ["list_dir", "read_file", "search_files", "view_image"]
WRITE_TOOLS = ["write_file", "edit_file", "delete_file"]


@dataclass
class ToolContext:
    sandbox: Sandbox
    runner: CommandRunner
    screenshot_dir: Path
    get_preview_url: Callable[[], str]
    post_message: Callable[[str, str], None]
    on_file_changed: Callable[[str, str], None] = lambda path, action: None
    screenshots: list[str] = field(default_factory=list)
    # đọc kiến thức chuyên môn theo vai trò (orchestrator gắn vào); ném ValueError nếu không có
    read_knowledge: Callable[[str], str] | None = None
    # skill được giao: đọc hướng dẫn (skill, file, offset) và chạy script (skill, script, args)
    use_skill: Callable[[str, str | None, int], str] | None = None
    run_skill_script: Callable[[str, str, list], tuple[int, str]] | None = None
    # thư viện agent mẫu (chỉ luồng tuyển dụng): (path, offset) -> nội dung; ném ValueError nếu không có
    read_reference: Callable[[str, int], str] | None = None


def _validate(name: str, schema: dict, inp: Any) -> str | None:
    """Kiểm tra input tool (cần vì bật eager_input_streaming)."""
    if not isinstance(inp, dict):
        return "Input phải là object JSON."
    props = schema["input_schema"].get("properties", {})
    for req in schema["input_schema"].get("required", []):
        if req not in inp:
            return f"Thiếu tham số bắt buộc '{req}'."
    for k, v in inp.items():
        t = props.get(k, {}).get("type")
        if t == "string" and not isinstance(v, str):
            return f"Tham số '{k}' phải là chuỗi."
        if t == "integer" and not (isinstance(v, int) and not isinstance(v, bool)):
            return f"Tham số '{k}' phải là số nguyên."
        if t == "array" and not (isinstance(v, list) and all(isinstance(x, str) for x in v)):
            return f"Tham số '{k}' phải là danh sách chuỗi."
    return None


def execute_tool(name: str, inp: dict, ctx: ToolContext) -> tuple[list[dict] | str, bool, str]:
    """Thực thi tool. Trả về (nội dung tool_result, is_error, tóm tắt để hiển thị)."""
    schema = TOOL_SCHEMAS.get(name)
    if schema is None:
        return f"Tool '{name}' không tồn tại.", True, "tool không tồn tại"
    err = _validate(name, schema, inp)
    if err:
        return err, True, err
    sb = ctx.sandbox
    try:
        if name == "list_dir":
            return sb.list_dir(inp.get("path", "."), inp.get("depth", 2)), False, inp.get("path", ".")
        if name == "read_file":
            return sb.read_file(inp["path"], inp.get("start_line"), inp.get("end_line")), False, inp["path"]
        if name == "search_files":
            return sb.search_files(inp["pattern"], inp.get("path", ".")), False, inp["pattern"]
        if name == "view_image":
            from ..attachments import image_block
            p = sb.resolve(inp["path"])
            if not p.is_file():
                return f"Không có file {inp['path']}.", True, inp["path"]
            try:
                block = image_block(p)
            except ValueError as e:
                return str(e), True, inp["path"]
            return [block, {"type": "text", "text": f"Ảnh: {sb.rel(p)}"}], False, inp["path"]
        if name == "write_file":
            msg = sb.write_file(inp["path"], inp["content"])
            ctx.on_file_changed(inp["path"], "write")
            return msg, False, inp["path"]
        if name == "edit_file":
            msg = sb.edit_file(inp["path"], inp["old_text"], inp["new_text"])
            ctx.on_file_changed(inp["path"], "edit")
            return msg, False, inp["path"]
        if name == "delete_file":
            msg = sb.delete_file(inp["path"])
            ctx.on_file_changed(inp["path"], "delete")
            return msg, False, inp["path"]
        if name == "run_command":
            code, out = ctx.runner.run(inp["command"])
            return f"exit code: {code}\n{out}", code != 0, f"{inp['command']} → {code}"
        if name == "screenshot":
            from .browser_tools import take_screenshot
            url = ctx.get_preview_url()
            login = ({"path": inp.get("login_path"), "email": inp.get("login_email", ""),
                      "password": inp.get("login_password", "")} if inp.get("login_email") else None)
            img, info = take_screenshot(url, inp["path"], inp.get("viewport", "desktop"), ctx.screenshot_dir,
                                        login=login)
            ctx.screenshots.append(img.name)
            data = base64.standard_b64encode(img.read_bytes()).decode()
            text = (f"URL: {url}{inp['path']} | viewport: {inp.get('viewport')} | HTTP {info['status']} | "
                    f"title: {info['title']!r} | lỗi console: {info['console_errors'] or 'không có'} | "
                    + (f"đăng nhập: {info['login']} | trang cuối: {info['final_url']} | " if login else "")
                    + f"file ảnh: {img.name}")
            return ([{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}},
                     {"type": "text", "text": text}], False, f"{inp['path']} ({inp.get('viewport')})")
        if name == "post_message":
            ctx.post_message(inp["to"], inp["text"])
            return "Đã gửi.", False, inp["text"][:80]
        if name == "read_knowledge":
            if ctx.read_knowledge is None:
                return "Hồ sơ kiến thức chưa được cấu hình.", True, "không có hồ sơ"
            try:
                return ctx.read_knowledge(inp["topic"]), False, inp["topic"]
            except ValueError as e:
                return str(e), True, str(e)
        if name == "read_reference":
            if ctx.read_reference is None:
                return "Thư viện mẫu chưa sẵn sàng.", True, "không có thư viện"
            try:
                return ctx.read_reference(inp["path"], inp.get("offset", 0)), False, inp["path"]
            except ValueError as e:
                return str(e), True, str(e)
        if name == "use_skill":
            if ctx.use_skill is None:
                return "Bạn chưa được giao skill nào.", True, "không có skill"
            try:
                text = ctx.use_skill(inp["skill"], inp.get("file"), inp.get("offset", 0))
                return text, False, f"{inp['skill']}/{inp.get('file') or 'SKILL.md'}"
            except ValueError as e:
                return str(e), True, str(e)
        if name == "run_skill_script":
            if ctx.run_skill_script is None:
                return "Bạn chưa được giao skill nào.", True, "không có skill"
            try:
                code, out = ctx.run_skill_script(inp["skill"], inp["script"], inp.get("args", []))
            except ValueError as e:
                return str(e), True, str(e)
            shown = " ".join(inp.get("args", []))[:80]
            return f"exit code: {code}\n{out}", code != 0, f"{inp['skill']}: {inp['script']} {shown} → {code}"
    except SandboxError as e:
        return f"Lỗi: {e}", True, str(e)
    except Exception as e:  # lỗi bất ngờ: trả về cho agent tự xử lý
        return f"Lỗi khi chạy tool: {type(e).__name__}: {e}", True, f"{type(e).__name__}: {e}"
    return "Không xử lý được.", True, "?"
