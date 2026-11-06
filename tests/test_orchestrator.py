"""Chạy toàn bộ pipeline với agent giả (không gọi API, không tốn tiền)."""
import time

from backend.agents.base import AgentResult
from backend.db import DB
from backend.events import EventBus
from backend.orchestrator import Agency


class FakePreview:
    def start(self, pid, ws, port=None):
        return "http://127.0.0.1:9999"

    def url(self, pid):
        return "http://127.0.0.1:9999"

    def stop_all(self):
        pass


class FakeAgent:
    """QA đánh trượt lần đầu, Kiểm duyệt trả về sửa lần đầu → kiểm tra các vòng lặp."""
    calls: list = []

    def __init__(self, role, ctx, hooks, state):
        self.role, self.ctx, self.hooks, self.state = role, ctx, hooks, state

    def run(self, instruction, submit):
        FakeAgent.calls.append((self.role, submit))
        self.hooks.emit("message", self.role, text=f"{self.role} đang làm {submit}", to="all", kind="note")
        if submit == "submit_plan":
            return AgentResult({"project_title": "Tiệm bánh", "summary": "s", "spec_markdown": "spec",
                                "acceptance_criteria": ["c1"],
                                "tasks": [{"title": "Backend form", "description": "d", "assignee": "backend"},
                                          {"title": "Giao diện", "description": "d", "assignee": "frontend"}]}, 1)
        if submit == "submit_design":
            self.ctx.sandbox.write_file("DESIGN.md", "# design")
            return AgentResult({"summary": "ok", "pages": ["/"], "palette": ["#fff"], "fonts": ["Inter"]}, 1)
        if submit == "submit_work":
            return AgentResult({"summary": "done", "files_changed": ["routes/web.php"], "notes_for_qa": "xem /"}, 1)
        if submit == "submit_qa":
            self.state["qa"] += 1
            passed = self.state["qa"] != 1
            issues = [] if passed else [{"title": "lỗi", "detail": "x", "assignee": "backend", "severity": "high"}]
            return AgentResult({"passed": passed, "summary": "qa", "tests_run": ["php artisan test"],
                                "issues": issues}, 1)
        if submit == "submit_review":
            self.state["review"] += 1
            if self.state["review"] == 1:
                return AgentResult({"verdict": "changes_requested", "score": 6, "summary": "cần sửa",
                                    "strengths": [], "issues": [{"title": "màu", "detail": "x",
                                                                 "assignee": "frontend", "severity": "low"}]}, 1)
            return AgentResult({"verdict": "approve", "score": 9, "summary": "tốt", "strengths": ["a"],
                                "issues": []}, 1)
        if submit == "submit_report":
            return AgentResult({"headline": "Xong", "summary_markdown": "# Báo cáo", "how_to_check": ["mở /"],
                                "known_issues": [], "next_steps": []}, 1)
        raise AssertionError(submit)


def _wait(agency, pid, timeout=20):
    end = time.time() + timeout
    while agency.is_running(pid) and time.time() < end:
        time.sleep(0.05)


def make_agency(tmp_path):
    skel = tmp_path / "skel"
    (skel / "routes").mkdir(parents=True)
    (skel / "routes" / "web.php").write_text("<?php", encoding="utf-8")
    db = DB(tmp_path / "t.db")
    state = {"qa": 0, "review": 0}
    agency = Agency(db, EventBus(db), preview=FakePreview(),
                    agent_factory=lambda role, ctx, hooks: FakeAgent(role, ctx, hooks, state),
                    workspaces_dir=tmp_path / "ws", skeleton_dir=skel)
    return agency, db


def test_full_pipeline(tmp_path):
    FakeAgent.calls = []
    agency, db = make_agency(tmp_path)
    p = agency.start_project("Làm web tiệm bánh mì")
    _wait(agency, p["id"])
    proj = db.get_project(p["id"])
    assert proj["status"] == "awaiting_approval", proj
    assert proj["title"] == "Tiệm bánh"
    assert (tmp_path / "ws" / p["id"] / "SPEC.md").exists()

    tasks = db.list_tasks(p["id"])
    assert len(tasks) == 3  # 2 task kế hoạch + 1 task sửa theo kiểm duyệt
    assert all(t["status"] == "done" for t in tasks)
    assert tasks[0]["attempts"] == 2  # QA đánh trượt lần đầu

    roles = [c[0] for c in FakeAgent.calls]
    assert roles[0] == "pm" and roles[-1] == "pm"
    assert roles.count("reviewer") == 2

    reports = db.list_reports(p["id"])
    assert len(reports) == 1 and reports[0]["content"]["verdict"] == "approve"
    types = {e["type"] for e in db.list_events(p["id"])}
    assert {"handoff", "task_update", "review", "report", "plan"} <= types

    # Sếp yêu cầu sửa → chạy lại lần 2
    agency.revise(p["id"], "Đổi màu chủ đạo sang xanh")
    _wait(agency, p["id"])
    assert db.get_project(p["id"])["run_count"] == 2
    statuses = sorted(r["status"] for r in db.list_reports(p["id"]))
    assert statuses == ["pending", "revision_requested"]

    agency.approve(p["id"])
    assert db.get_project(p["id"])["status"] == "approved"


def test_stop(tmp_path):
    agency, db = make_agency(tmp_path)

    class SlowAgent(FakeAgent):
        def run(self, instruction, submit):
            for _ in range(100):
                if self.hooks.should_stop():
                    from backend.agents.base import AgentCancelled
                    raise AgentCancelled()
                time.sleep(0.02)
            return super().run(instruction, submit)

    agency._agent_factory = lambda role, ctx, hooks: SlowAgent(role, ctx, hooks, {"qa": 0, "review": 0})
    p = agency.start_project("x")
    time.sleep(0.1)
    agency.stop(p["id"])
    _wait(agency, p["id"])
    assert db.get_project(p["id"])["status"] == "stopped"


def test_missing_api_key_fails_cleanly(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    agency, db = make_agency(tmp_path)
    agency._agent_factory = None
    p = agency.start_project("x")
    _wait(agency, p["id"])
    proj = db.get_project(p["id"])
    assert proj["status"] == "failed" and "API_KEY" in proj["error"]
