"""Tool "nộp kết quả" (strict JSON schema) cho từng loại công việc.

Mỗi agent kết thúc công việc bằng cách gọi đúng một tool submit_* này;
nhờ strict: true, orchestrator luôn nhận được dữ liệu đúng cấu trúc.
"""
from __future__ import annotations

ASSIGNEES = ["frontend", "backend"]


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props,
            "required": required if required is not None else list(props), "additionalProperties": False}


_STR = {"type": "string"}
_STR_LIST = {"type": "array", "items": {"type": "string"}}
_ISSUE = _obj({
    "title": _STR,
    "detail": {"type": "string", "description": "Mô tả lỗi, cách tái hiện, file liên quan, cách sửa gợi ý."},
    "assignee": {"type": "string", "enum": ASSIGNEES},
    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
})

SUBMIT_TOOLS: dict[str, dict] = {
    "submit_plan": {
        "description": "Nộp spec và danh sách task cho đội. Gọi đúng 1 lần khi lập kế hoạch xong.",
        "input_schema": _obj({
            "project_title": {"type": "string", "description": "Tên ngắn của dự án (tối đa 60 ký tự)."},
            "summary": {"type": "string", "description": "Tóm tắt 2-3 câu bạn hiểu yêu cầu thế nào."},
            "spec_markdown": {"type": "string", "description": "Spec chi tiết: trang, chức năng, dữ liệu, ràng buộc."},
            "acceptance_criteria": _STR_LIST,
            "tasks": {"type": "array", "items": _obj({
                "title": _STR,
                "description": {"type": "string", "description": "Việc cần làm cụ thể, file/route dự kiến, tiêu chí xong."},
                "assignee": {"type": "string", "enum": ASSIGNEES},
            })},
        }),
    },
    "submit_design": {
        "description": "Nộp kết quả thiết kế sau khi đã ghi DESIGN.md.",
        "input_schema": _obj({
            "summary": _STR,
            "pages": _STR_LIST,
            "palette": {"type": "array", "items": _STR, "description": "Mã màu chính, ví dụ #F59E0B"},
            "fonts": _STR_LIST,
        }),
    },
    "submit_work": {
        "description": "Nộp kết quả sau khi làm xong task.",
        "input_schema": _obj({
            "summary": _STR,
            "files_changed": _STR_LIST,
            "notes_for_qa": {"type": "string", "description": "QA cần kiểm tra gì, route nào, dữ liệu mẫu."},
        }),
    },
    "submit_qa": {
        "description": "Nộp kết quả kiểm thử của task.",
        "input_schema": _obj({
            "passed": {"type": "boolean"},
            "summary": _STR,
            "tests_run": _STR_LIST,
            "issues": {"type": "array", "items": _ISSUE},
        }),
    },
    "submit_review": {
        "description": "Nộp kết luận kiểm duyệt toàn bộ dự án.",
        "input_schema": _obj({
            "verdict": {"type": "string", "enum": ["approve", "changes_requested"]},
            "score": {"type": "integer", "description": "Điểm chất lượng 1-10."},
            "summary": _STR,
            "strengths": _STR_LIST,
            "issues": {"type": "array", "items": _ISSUE},
        }),
    },
    "submit_report": {
        "description": "Nộp báo cáo cuối cho Sếp.",
        "input_schema": _obj({
            "headline": {"type": "string", "description": "Một câu kết luận."},
            "summary_markdown": {"type": "string", "description": "Báo cáo đầy đủ bằng Markdown."},
            "how_to_check": _STR_LIST,
            "known_issues": _STR_LIST,
            "next_steps": _STR_LIST,
        }),
    },
}


def submit_tool_def(name: str) -> dict:
    s = SUBMIT_TOOLS[name]
    return {"name": name, "description": s["description"], "input_schema": s["input_schema"], "strict": True}
