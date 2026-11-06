"""Agent: một vòng lặp tool-use với Claude cho một vai trò và một nhiệm vụ.

Dùng vòng lặp tự viết (thay vì tool runner) để: phát sự kiện realtime cho từng tool call,
dừng giữa chừng khi Sếp bấm Dừng, kiểm soát ngân sách token và trả ảnh chụp màn hình cho model.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol

from ..settings import get_config, role_config
from ..tools.registry import TOOL_SCHEMAS, ToolContext, execute_tool
from . import skills as skills_mod
from .profiles import load_profile
from .roles import COMMON, FALLBACK_CONVENTIONS, ROLES
from .schemas import SUBMIT_TOOLS, submit_tool_def


def build_system(role: str) -> str:
    """System prompt đầy đủ của một vai trò: phần cố định + hồ sơ chuyên môn (agents/<role>)."""
    rcfg = role_config(role)
    me = f"Bạn là {rcfg['name']} — {rcfg['title']} (mã vai trò: {role})."
    prof = load_profile(role)
    rules = prof.prompt_section()
    sk = skills_mod.prompt_section(role)
    if sk:
        rules = f"{rules}\n\n{sk}"
    if not prof.team_rules:
        rules = f"{FALLBACK_CONVENTIONS}\n\n{rules}".strip()
    # Hồ sơ đặt sau phần cố định; nội dung ổn định trong một lần chạy nên vẫn được prompt cache.
    return f"{COMMON}\n\n{me}\n{ROLES[role].prompt}\n\n=== LUẬT VÀ KIẾN THỨC CỦA BẠN ===\n\n{rules}"


class AgentCancelled(Exception):
    pass


class AgentError(Exception):
    pass


class Hooks(Protocol):
    def emit(self, type_: str, agent: str, **data: Any) -> None: ...
    def add_usage(self, model: str, usage: Any) -> None: ...
    def should_stop(self) -> bool: ...
    def over_budget(self) -> bool: ...


@dataclass
class AgentResult:
    data: dict
    iterations: int


def _check_required(schema: dict, value: Any, path: str = "") -> str | None:
    """Kiểm tra cấu trúc tối thiểu của dữ liệu nộp (bổ sung cho strict schema)."""
    t = schema.get("type")
    if t == "object":
        if not isinstance(value, dict):
            return f"{path or 'input'} phải là object"
        for k in schema.get("required", []):
            if k not in value:
                return f"thiếu trường '{path + k}'"
        for k, sub in schema.get("properties", {}).items():
            if k in value:
                err = _check_required(sub, value[k], f"{path}{k}.")
                if err:
                    return err
    elif t == "array":
        if not isinstance(value, list):
            return f"'{path.rstrip('.')}' phải là mảng"
        for i, item in enumerate(value):
            err = _check_required(schema.get("items", {}), item, f"{path}{i}.")
            if err:
                return err
    elif "enum" in schema and value not in schema["enum"]:
        return f"'{path.rstrip('.')}' phải là một trong {schema['enum']}"
    return None


class Agent:
    def __init__(self, role: str, client: Any, ctx: ToolContext, hooks: Hooks):
        if role not in ROLES:
            raise ValueError(f"Vai trò không hợp lệ: {role}")
        self.role = role
        self.defn = ROLES[role]
        self.rcfg = role_config(role)
        self.client = client
        self.ctx = ctx
        self.hooks = hooks
        self.cfg = get_config()

    # ---------- request ----------
    def _tools(self, submit: str) -> list[dict]:
        tools = []
        names = list(self.defn.tools)
        if skills_mod.skills_for(self.role):   # chỉ thêm tool skill khi có skill được giao
            names += ["use_skill", "run_skill_script"]
        for name in names:
            s = TOOL_SCHEMAS[name]
            tools.append({"name": name, "description": s["description"], "input_schema": s["input_schema"],
                          "eager_input_streaming": True})
        sub = submit_tool_def(submit)
        sub["eager_input_streaming"] = True
        tools.append(sub)
        return tools

    def _system(self) -> str:
        return build_system(self.role)

    def _call(self, system: str, tools: list[dict], messages: list[dict]):
        params: dict[str, Any] = dict(
            model=self.rcfg["model"],
            max_tokens=int(self.cfg.get("max_tokens", 32000)),
            system=system,
            tools=tools,
            messages=messages,
            output_config={"effort": self.rcfg["effort"]},
            cache_control={"type": "ephemeral"},
        )
        if self.cfg.get("use_fallbacks", True):
            params["betas"] = ["server-side-fallback-2026-07-01"]
            params["fallbacks"] = "default"
        with self.client.beta.messages.stream(**params) as stream:
            return stream.get_final_message()

    # ---------- loop ----------
    def run(self, instruction: str, submit: str) -> AgentResult:
        if submit not in SUBMIT_TOOLS:
            raise ValueError(submit)
        submit_schema = SUBMIT_TOOLS[submit]["input_schema"]
        system = self._system()
        tools = self._tools(submit)
        messages: list[dict] = [{"role": "user", "content": instruction}]
        max_iter = int(self.cfg["limits"].get("max_tool_iterations", 40))
        nudges = 0
        emit: Callable[..., None] = lambda t, **d: self.hooks.emit(t, self.role, **d)

        emit("agent_status", status="working")
        try:
            for i in range(1, max_iter + 1):
                if self.hooks.should_stop():
                    raise AgentCancelled()
                if self.hooks.over_budget():
                    raise AgentError("Đã vượt ngân sách token của dự án (limits.token_budget).")

                resp = self._call(system, tools, messages)
                self.hooks.add_usage(resp.model, resp.usage)

                if resp.stop_reason == "refusal":
                    cat = getattr(getattr(resp, "stop_details", None), "category", None)
                    raise AgentError(f"Model từ chối yêu cầu (category: {cat}).")

                messages.append({"role": "assistant", "content": resp.content})
                text = "\n".join(b.text for b in resp.content if b.type == "text" and b.text.strip())
                if text:
                    emit("message", text=text, to="all", kind="note")

                tool_uses = [b for b in resp.content if b.type == "tool_use"]
                if not tool_uses:
                    if resp.stop_reason == "pause_turn":
                        continue
                    nudges += 1
                    if nudges > 2:
                        raise AgentError("Agent kết thúc mà không nộp kết quả.")
                    messages.append({"role": "user", "content":
                                     f"Bạn chưa nộp kết quả. Hãy hoàn tất và gọi tool {submit}."})
                    continue

                truncated = resp.stop_reason == "max_tokens"
                results: list[dict] = []
                submitted: dict | None = None
                for tu in tool_uses:
                    if self.hooks.should_stop():
                        raise AgentCancelled()
                    if truncated:
                        results.append({"type": "tool_result", "tool_use_id": tu.id, "is_error": True,
                                        "content": "Output bị cắt do max_tokens nên tool chưa chạy. "
                                                   "Hãy chia nhỏ: ghi file ngắn hơn hoặc dùng edit_file."})
                        continue
                    if tu.name == submit:
                        err = _check_required(submit_schema, tu.input)
                        if err:
                            results.append({"type": "tool_result", "tool_use_id": tu.id, "is_error": True,
                                            "content": f"Dữ liệu nộp không hợp lệ: {err}. Hãy nộp lại."})
                        else:
                            submitted = tu.input
                            results.append({"type": "tool_result", "tool_use_id": tu.id, "content": "Đã nhận."})
                        continue
                    content, is_error, summary = execute_tool(tu.name, tu.input, self.ctx)
                    emit("tool", tool=tu.name, summary=summary[:300], is_error=is_error)
                    block: dict = {"type": "tool_result", "tool_use_id": tu.id, "content": content}
                    if is_error:
                        block["is_error"] = True
                    results.append(block)

                if submitted is not None:
                    emit("agent_status", status="idle")
                    return AgentResult(data=submitted, iterations=i)
                messages.append({"role": "user", "content": results})
            raise AgentError(f"Vượt quá {max_iter} lượt làm việc mà chưa xong.")
        except BaseException:
            emit("agent_status", status="idle")
            raise
