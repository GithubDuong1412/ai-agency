import base64

import pytest

from backend import attachments
from backend.agents.base import first_content
from backend.tools.fs_tools import Sandbox
from backend.tools.registry import ToolContext, execute_tool

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


def test_decode_ok():
    assert attachments.decode_images([URL, URL.replace("image/png", "image/jpeg")]) == [(PNG, "png"), (PNG, "jpg")]
    assert attachments.decode_images(None) == []


@pytest.mark.parametrize("items", [
    [URL] * 5,                                        # quá 4 ảnh
    ["data:image/svg+xml;base64,PHN2Zz4="],           # SVG không nhận
    ["data:text/plain;base64,aGk="],
    ["data:image/png;base64,@@@"],                    # base64 hỏng
    ["data:image/png;base64," + base64.b64encode(b"x" * (5 * 1024 * 1024 + 1)).decode()],  # quá 5MB
])
def test_decode_rejects(items):
    with pytest.raises(ValueError):
        attachments.decode_images(items)


def test_save_and_first_content(tmp_path):
    names = attachments.save_attachments(tmp_path, [(PNG, "png"), (PNG, "jpg")])
    paths = [tmp_path / p for p in attachments.rel_paths(names)]
    assert all(p.read_bytes() == PNG for p in paths)
    assert all(p.parent == tmp_path / ".agency" / "attachments" for p in paths)

    content = first_content("Làm theo ảnh", paths + [tmp_path / "missing.png"])
    assert [b["type"] for b in content] == ["image", "image", "text"]  # ảnh thiếu bị bỏ qua
    assert content[0]["source"]["media_type"] == "image/png"
    assert content[1]["source"]["media_type"] == "image/jpeg"
    assert first_content("Chỉ chữ") == "Chỉ chữ"
    assert first_content("Chỉ chữ", []) == "Chỉ chữ"


def _ctx(ws):
    return ToolContext(sandbox=Sandbox(ws), runner=None, screenshot_dir=ws, get_preview_url=lambda: "",
                       post_message=lambda to, text: None)


def test_view_image_tool(tmp_path):
    name = attachments.save_attachments(tmp_path, [(PNG, "png")])[0]
    content, is_error, _ = execute_tool("view_image", {"path": f".agency/attachments/{name}"}, _ctx(tmp_path))
    assert not is_error and content[0]["type"] == "image"

    (tmp_path / "notes.txt").write_text("x")
    for bad in ["../secret.png", "C:/x.png", "notes.txt", "nope.png"]:
        _, is_error, _ = execute_tool("view_image", {"path": bad}, _ctx(tmp_path))
        assert is_error, bad
