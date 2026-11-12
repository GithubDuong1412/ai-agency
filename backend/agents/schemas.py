"""Tool "nộp kết quả" (strict JSON schema) cho từng loại công việc.

Mỗi agent kết thúc công việc bằng cách gọi đúng một tool submit_* này;
nhờ strict: true, orchestrator luôn nhận được dữ liệu đúng cấu trúc.
"""
from __future__ import annotations

from . import hired as hired_mod

# Danh sách gốc (giữ để tương thích); danh sách thật lấy từ assignees() / lesson_scopes() vì có nhân sự tuyển thêm
ASSIGNEES = ["frontend", "backend"]
LESSON_SCOPES = ["team", "pm", "designer", "frontend", "backend", "qa", "reviewer"]


def assignees() -> list[str]:
    from .roles import assignable
    return assignable()


def lesson_scopes() -> list[str]:
    return LESSON_SCOPES + list(hired_mod.load())


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props,
            "required": required if required is not None else list(props), "additionalProperties": False}


_STR = {"type": "string"}
_STR_LIST = {"type": "array", "items": {"type": "string"}}


def _issue(assignee_enum: list[str]) -> dict:
    return _obj({
        "title": _STR,
        "detail": {"type": "string", "description": "Mô tả lỗi, cách tái hiện, file liên quan, cách sửa gợi ý."},
        "assignee": {"type": "string", "enum": assignee_enum},
        "severity": {"type": "string", "enum": ["low", "medium", "high"]},
    })


def _candidate(models: list[str]) -> dict:
    return _obj({
        "key": {"type": "string", "description": "Mã vai trò: chữ thường không dấu, số, gạch dưới, 3-25 ký tự "
                                                 "(vd. seo_writer). Không trùng mã đã có."},
        "name": {"type": "string", "description": "Tên gọi ngắn kiểu tên người Việt (vd. Linh)."},
        "title": {"type": "string", "description": "Chức vụ (vd. Content SEO Writer)."},
        "department": {"type": "string", "description": "Phòng ban. Dùng phòng có sẵn nếu hợp, hoặc đặt phòng mới."},
        "color": {"type": "string", "description": "Màu đại diện dạng #RRGGBB, khác màu các thành viên hiện có."},
        "model": {"type": "string", "enum": models},
        "effort": {"type": "string", "enum": list(hired_mod.EFFORTS)},
        "permissions": {"type": "array", "items": {"type": "string", "enum": list(hired_mod.PERMISSION_TOOLS)},
                        "description": "Nhóm quyền tối thiểu cần cho công việc."},
        "working_style": {"type": "string", "description": "Cách làm việc (đoạn prompt vai trò, viết ở ngôi 'Bạn là…'): "
                                                           "nhiệm vụ chính, quy trình, phối hợp với ai, sản phẩm nộp."},
        "rules_markdown": {"type": "string", "description": "Rules nghiệp vụ chắt lọc từ nguồn đã đọc: 10-25 quy tắc "
                                                           "chia nhóm bằng tiêu đề ##, mỗi quy tắc cụ thể, kiểm tra được, "
                                                           "kèm lý do ngắn."},
        "checklist_markdown": {"type": "string", "description": "Checklist tự kiểm trước khi nộp: 12-30 mục '- [ ] …' "
                                                               "chia nhóm bằng tiêu đề ##."},
        "reason": {"type": "string", "description": "Vì sao cần tuyển người này (1-2 câu)."},
        "reference_agents": {"type": "array", "items": _STR,
                             "description": "Đường dẫn các file agent mẫu (thư viện agency-agents) đã dùng làm gốc cho "
                                            "rules/checklist, vd. 'marketing/marketing-seo-specialist.md'. Rỗng nếu "
                                            "không dùng."},
        "sources": {"type": "array", "description": "Các nguồn đã đọc để soạn hồ sơ.", "items": _obj({
            "title": _STR, "url": _STR,
            "note": {"type": "string", "description": "Nguồn này dùng cho phần nào (1 câu)."},
        })},
        "knowledge": {"type": "array", "description": "1-4 tài liệu chuyên môn chắt lọc (chi tiết, có ví dụ, ngưỡng, "
                                                       "mẫu); cuối mỗi tài liệu ghi nguồn.", "items": _obj({
            "slug": {"type": "string", "description": "Tên file: chữ thường không dấu, số, gạch ngang (vd. seo-on-page)."},
            "title": _STR,
            "content_markdown": {"type": "string", "description": "Nội dung Markdown, bắt đầu bằng '# Tiêu đề'."},
        })},
        "skill": _obj({
            "name": {"type": "string", "description": "Tên skill tự soạn: chữ thường, số, gạch ngang (vd. seo-content-"
                                                       "workflow). Để rỗng nếu không soạn."},
            "description": {"type": "string", "description": "Khi nào dùng skill này (1-2 câu)."},
            "content_markdown": {"type": "string", "description": "Thân SKILL.md (không cần frontmatter): quy trình "
                                                                 "làm việc từng bước, mẫu, ví dụ."},
        }),
        "existing_skills": {"type": "array", "items": _STR,
                            "description": "Tên skill đã có trên máy nên gắn cho người này (để trống nếu không)."},
        "skill_downloads": {"type": "array", "description": "Skill có sẵn trên GitHub (thư mục chứa SKILL.md) nên tải "
                                                             "về. Chỉ cài khi Sếp duyệt.", "items": _obj({
            "url": {"type": "string", "description": "https://github.com/<owner>/<repo>/tree/<nhánh>/<thư mục skill>"},
            "reason": _STR,
        })},
    })


def _defs() -> dict[str, dict]:
    asg = assignees()
    from ..settings import allowed_models
    return {
    "submit_hiring": {
        "description": "Nộp đề xuất tuyển nhân sự cho Sếp duyệt.",
        "input_schema": _obj({
            "summary": {"type": "string", "description": "Tóm tắt đề xuất cho Sếp (1-3 câu)."},
            "candidates": {"type": "array", "items": _candidate(allowed_models())},
        }),
    },
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
                "assignee": {"type": "string", "enum": asg},
            })},
            "hiring_suggestions": {"type": "array", "description": "Nhân sự nên tuyển thêm nếu đội thiếu chuyên môn "
                                                                   "(thường để rỗng).", "items": _obj({
                "need": {"type": "string", "description": "Cần người làm gì (vd. viết content chuẩn SEO cho blog)."},
                "reason": _STR,
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
            "issues": {"type": "array", "items": _issue(asg)},
        }),
    },
    "submit_review": {
        "description": "Nộp kết luận kiểm duyệt toàn bộ dự án.",
        "input_schema": _obj({
            "verdict": {"type": "string", "enum": ["approve", "changes_requested"]},
            "score": {"type": "integer", "description": "Điểm chất lượng 1-10."},
            "summary": _STR,
            "strengths": _STR_LIST,
            "issues": {"type": "array", "items": _issue(asg)},
        }),
    },
    "submit_lessons": {
        "description": "Nộp 0–3 bài học rút ra sau vòng làm việc (để trống nếu không có gì đáng nhớ).",
        "input_schema": _obj({
            "lessons": {"type": "array", "items": _obj({
                "role": {"type": "string", "enum": lesson_scopes(),
                         "description": "Vai cần nhớ bài học này; 'team' nếu cả đội."},
                "text": {"type": "string", "description": "Một câu mệnh lệnh ngắn, áp dụng được cho dự án khác."},
            })},
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


SUBMIT_NAMES = ("submit_hiring", "submit_plan", "submit_design", "submit_work", "submit_qa", "submit_review",
                "submit_lessons", "submit_report")


def submit_tools() -> dict[str, dict]:
    """Tool nộp kết quả, dựng lại mỗi lần gọi: enum người nhận task / vai rút bài học có nhân sự tuyển thêm."""
    return _defs()


def submit_tool_def(name: str, defs: dict[str, dict] | None = None) -> dict:
    s = (defs or submit_tools())[name]
    return {"name": name, "description": s["description"], "input_schema": s["input_schema"], "strict": True}
