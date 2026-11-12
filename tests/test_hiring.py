"""Tuyển dụng: sổ nhân sự tuyển thêm, vai trò động, luồng đề xuất → duyệt và PM tự đề xuất trong dự án."""
import time

import pytest

from backend.agents import hired
from backend.agents.base import AgentResult
from tests.test_orchestrator import FakeAgent, _wait, make_agency

CAND = {
    "key": "seo_writer", "name": "Linh", "title": "Content SEO Writer", "department": "Nội dung",
    "color": "#E879F9", "model": "claude-sonnet-5-5", "effort": "medium", "permissions": ["message", "write"],
    "working_style": "Bạn là Content SEO Writer. Bạn viết nội dung trang chuẩn SEO.",
    "rules_markdown": "- Mỗi trang 1 thẻ h1", "checklist_markdown": "- [ ] Có meta description",
    "reason": "Đội chưa có người viết nội dung",
}


@pytest.fixture(autouse=True)
def hired_tmp(tmp_path, monkeypatch):
    base = tmp_path / "agents"
    base.mkdir(exist_ok=True)
    monkeypatch.setattr(hired, "HIRED_FILE", base / "hired.yaml")
    monkeypatch.setattr(hired, "BASE_DIR", base)
    monkeypatch.setattr(hired, "SKILLS_FILE", base / "skills.yaml")
    return base


def test_add_update_remove(hired_tmp):
    e = hired.add(CAND, ["claude-sonnet-5-5"])
    assert e["color"] == "#e879f9" and e["permissions"] == ["write", "message"]
    assert "Mỗi trang 1 thẻ h1" in (hired_tmp / "seo_writer" / "rules.md").read_text(encoding="utf-8")
    assert (hired_tmp / "seo_writer" / "checklist.md").is_file()
    with pytest.raises(hired.HiredError):
        hired.add(CAND, ["claude-sonnet-5-5"])          # trùng mã
    with pytest.raises(hired.HiredError):
        hired.add({**CAND, "key": "backend"})           # trùng vai trò gốc
    with pytest.raises(hired.HiredError):
        hired.add({**CAND, "key": "Bad-Key"})
    with pytest.raises(hired.HiredError):
        hired.add({**CAND, "key": "other", "model": "gpt"}, ["claude-sonnet-5-5"])

    hired.update("seo_writer", {"title": "SEO Lead", "permissions": ["message"]})
    assert hired.get("seo_writer")["title"] == "SEO Lead"
    assert not hired.can_take_tasks(hired.get("seo_writer"))

    (hired_tmp / "skills.yaml").write_text("# header\nseo_writer:\n- x\nfrontend:\n- y\n", encoding="utf-8")
    (hired_tmp / "seo_writer" / "lessons.md").write_text("- bài học", encoding="utf-8")
    hired.remove("seo_writer")
    assert hired.get("seo_writer") is None
    assert not (hired_tmp / "seo_writer").exists()
    archived = list((hired_tmp / "_archive").iterdir())
    assert len(archived) == 1 and (archived[0] / "lessons.md").is_file()
    sk = (hired_tmp / "skills.yaml").read_text(encoding="utf-8")
    assert "seo_writer" not in sk and "frontend" in sk and sk.startswith("# header")


def test_dynamic_roles_and_schemas():
    from backend.agents.base import build_system
    from backend.agents.roles import all_roles
    from backend.agents.schemas import submit_tools
    from backend.orchestrator import roster
    from backend.settings import role_config

    hired.add(CAND, ["claude-sonnet-5-5"])
    roles = all_roles()
    assert "seo_writer" in roles and "write_file" in roles["seo_writer"].tools
    assert "run_command" not in roles["seo_writer"].tools
    assert "seo_writer" in roles["pm"].prompt  # PM biết được giao việc cho người mới
    defs = submit_tools()
    task_enum = defs["submit_plan"]["input_schema"]["properties"]["tasks"]["items"]["properties"]["assignee"]["enum"]
    assert task_enum == ["frontend", "backend", "seo_writer"]
    lesson_enum = defs["submit_lessons"]["input_schema"]["properties"]["lessons"]["items"]["properties"]["role"]["enum"]
    assert "seo_writer" in lesson_enum
    rc = role_config("seo_writer")
    assert rc["name"] == "Linh" and rc["department"] == "Nội dung"
    r = next(x for x in roster() if x["key"] == "seo_writer")
    assert r["hired"] and r["assignable"]
    sysmsg = build_system("seo_writer")
    assert "Content SEO Writer" in sysmsg and "seo_writer" in sysmsg


class HireAgent(FakeAgent):
    def run(self, instruction, submit, images=None):
        if submit == "submit_hiring":
            FakeAgent.calls.append((self.role, submit))
            return AgentResult({"summary": "Tuyển 1 người", "candidates": [
                {**CAND, "key": "Seo-Writer", "model": "khong-co", "color": "đỏ"}]}, 1)
        if submit == "submit_plan":
            r = super().run(instruction, submit)
            r.data["hiring_suggestions"] = [{"need": "Người viết content SEO", "reason": "Trang cần bài viết"}]
            return r
        return super().run(instruction, submit)


def _wait_hiring(agency, hid, timeout=10):
    end = time.time() + timeout
    while agency.hiring.is_drafting(hid) and time.time() < end:
        time.sleep(0.05)


def test_hiring_flow(tmp_path):
    agency, db = make_agency(tmp_path)
    agency._agent_factory = lambda role, ctx, hooks: HireAgent(role, ctx, hooks, {"qa": 1, "review": 1})
    h = agency.hiring.request("Cần 1 người viết content SEO")
    _wait_hiring(agency, h["id"])
    h = db.get_hiring(h["id"])
    assert h["status"] == "pending", h
    cand = h["proposal"]["candidates"][0]
    assert cand["key"] == "seo_writer" and cand["color"] == "#64748b"  # đã làm sạch
    assert cand["model"]  # thay bằng model hợp lệ

    with pytest.raises(ValueError):
        agency.hiring.approve(h["id"], [{**cand, "key": "qa"}])
    assert hired.get("qa") is None and not hired.load()  # lỗi thì không ai được tạo

    agency.hiring.approve(h["id"], [{**cand, "name": "Thảo Linh"}])
    assert db.get_hiring(h["id"])["status"] == "approved"
    assert hired.get("seo_writer")["name"] == "Thảo Linh"
    types = [e["type"] for e in db.list_events("_agency")]
    assert "roster_changed" in types and "hiring_update" in types

    # từ chối / soạn lại
    h2 = agency.hiring.request("Cần người dịch tiếng Anh")
    _wait_hiring(agency, h2["id"])
    agency.hiring.revise(h2["id"], "Chỉ cần quyền ghi file")
    _wait_hiring(agency, h2["id"])
    assert db.get_hiring(h2["id"])["status"] == "pending"
    agency.hiring.reject(h2["id"])
    assert db.get_hiring(h2["id"])["status"] == "rejected"


def test_pm_suggests_hiring_during_project(tmp_path):
    agency, db = make_agency(tmp_path)
    agency._agent_factory = lambda role, ctx, hooks: HireAgent(role, ctx, hooks, {"qa": 1, "review": 1})
    p = agency.start_project("Làm blog")
    _wait(agency, p["id"])
    reqs = db.list_hiring()
    assert len(reqs) == 1 and reqs[0]["source_project"] == p["id"]
    _wait_hiring(agency, reqs[0]["id"])
    assert db.get_project(p["id"])["status"] == "awaiting_approval"  # dự án vẫn chạy xong


def test_hired_role_gets_tasks_and_lessons(tmp_path):
    from backend.agents import profiles
    agency, db = make_agency(tmp_path)
    hired.add(CAND, ["claude-sonnet-5-5"])

    class Planner(FakeAgent):
        def run(self, instruction, submit, images=None):
            r = super().run(instruction, submit)
            if submit == "submit_plan":
                r.data["tasks"].append({"title": "Viết nội dung", "description": "d", "assignee": "seo_writer"})
            if submit == "submit_lessons":
                r.data["lessons"] = [{"role": "seo_writer", "text": "Luôn viết meta description cho mọi trang."}]
            return r

    state = {"qa": 0, "review": 1}  # dùng chung: QA trượt lần đầu (để có bài học), sau đó đạt
    agency._agent_factory = lambda role, ctx, hooks: Planner(role, ctx, hooks, state)
    p = agency.start_project("Làm web")
    _wait(agency, p["id"])
    proj = db.get_project(p["id"])
    assert proj["status"] == "awaiting_approval", proj["error"]
    tasks = db.list_tasks(p["id"])
    assert any(t["assignee"] == "seo_writer" and t["status"] == "done" for t in tasks), \
        [(t["assignee"], t["status"]) for t in tasks]
    assert ("seo_writer", "submit_work") in FakeAgent.calls
    assert any("meta description" in ln for ln in profiles.lessons_of("seo_writer", tmp_path / "agents"))
