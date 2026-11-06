"""Kiểm tra vòng lặp Agent với client Claude giả."""
from types import SimpleNamespace as NS

from backend.settings import role_config
from backend.agents.base import Agent
from backend.tools.fs_tools import Sandbox
from backend.tools.registry import ToolContext
from backend.tools.shell_tools import CommandRunner


class FakeStream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.beta = NS(messages=NS(stream=self._stream))

    def _stream(self, **params):
        self.requests.append({**params, "messages": list(params["messages"])})  # chụp lại trạng thái
        return FakeStream(self.responses.pop(0))


def msg(content, stop="tool_use"):
    return NS(content=content, stop_reason=stop, model="claude-opus-5-5",
              usage=NS(input_tokens=10, output_tokens=5, cache_creation_input_tokens=0, cache_read_input_tokens=0))


class Hooks:
    def __init__(self):
        self.events = []
        self.usage = 0

    def emit(self, t, agent, **d):
        self.events.append((t, agent, d))

    def add_usage(self, model, usage):
        self.usage += usage.input_tokens + usage.output_tokens

    def should_stop(self):
        return False

    def over_budget(self):
        return False


def test_agent_writes_file_then_submits(tmp_path):
    ctx = ToolContext(sandbox=Sandbox(tmp_path), runner=CommandRunner(tmp_path, "php", "c.phar"),
                      screenshot_dir=tmp_path / "s", get_preview_url=lambda: "", post_message=lambda to, t: None)
    client = FakeClient([
        msg([NS(type="text", text="Bắt đầu viết DESIGN.md"),
             NS(type="tool_use", id="t1", name="write_file", input={"path": "DESIGN.md", "content": "# D"})]),
        msg([NS(type="text", text="Xong")], stop="end_turn"),  # quên nộp → bị nhắc
        msg([NS(type="tool_use", id="t2", name="submit_design",
                input={"summary": "ok", "pages": ["/"], "palette": ["#000"], "fonts": ["Inter"]})]),
    ])
    hooks = Hooks()
    res = Agent("designer", client, ctx, hooks).run("Thiết kế", "submit_design")
    assert res.data["summary"] == "ok"
    assert (tmp_path / "DESIGN.md").read_text(encoding="utf-8") == "# D"
    assert hooks.usage == 45
    req = client.requests[0]
    assert req["model"] == role_config("designer")["model"] and req["fallbacks"] == "default"
    assert any(t["name"] == "submit_design" and t["strict"] for t in req["tools"])
    assert "run_command" not in [t["name"] for t in req["tools"]]  # designer không được chạy lệnh
    # tool_result được gửi lại đúng id
    assert client.requests[1]["messages"][-1]["content"][0]["tool_use_id"] == "t1"
    assert client.requests[2]["messages"][-1]["content"].startswith("Bạn chưa nộp")
    assert any(e[0] == "tool" for e in hooks.events)


def test_invalid_submit_is_rejected(tmp_path):
    ctx = ToolContext(sandbox=Sandbox(tmp_path), runner=CommandRunner(tmp_path, "php", "c.phar"),
                      screenshot_dir=tmp_path / "s", get_preview_url=lambda: "", post_message=lambda to, t: None)
    client = FakeClient([
        msg([NS(type="tool_use", id="a", name="submit_qa", input={"passed": True, "summary": "x"})]),
        msg([NS(type="tool_use", id="b", name="submit_qa",
                input={"passed": True, "summary": "x", "tests_run": [], "issues": []})]),
    ])
    res = Agent("qa", client, ctx, Hooks()).run("QA", "submit_qa")
    assert res.data["passed"] is True
    err = client.requests[1]["messages"][-1]["content"][0]
    assert err["is_error"] and "tests_run" in err["content"]
