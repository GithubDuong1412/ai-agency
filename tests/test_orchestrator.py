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
        if submit == "submit_lessons":
            return AgentResult({"lessons": [
                {"role": "backend", "text": "Viết test bằng PHPUnit dạng class, không dùng Pest."},
                {"role": "team", "text": "Không chạy migrate:fresh trên database thật."}]}, 1)
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
                    workspaces_dir=tmp_path / "ws", skeleton_dir=skel, agents_dir=tmp_path / "agents")
    for scope in ("_team", "pm", "designer", "frontend", "backend", "qa", "reviewer"):
        (tmp_path / "agents" / scope).mkdir(parents=True)
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
    assert FakeAgent.calls[-1] == ("pm", "submit_lessons")  # QA trượt + Kiểm duyệt trả sửa → rút bài học
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


def test_run_screenshots_only_current_round_latest_per_page(tmp_path):
    from backend.orchestrator import run_screenshots
    for name in ["1000_home_desktop.png", "2000_home_desktop.png", "3000_home_desktop.png",
                 "2500_menu_mobile.png", "1500_admin_mobile.png", "x_notes.png"]:
        (tmp_path / name).write_bytes(b"")
    # vòng bắt đầu lúc 2000: bỏ ảnh vòng cũ, mỗi trang+khung giữ ảnh mới nhất
    assert run_screenshots(tmp_path, 2000) == ["2500_menu_mobile.png", "3000_home_desktop.png"]
    assert run_screenshots(tmp_path, 9000) == []


def test_attached_images_reach_pm_and_designer(tmp_path):
    seen = {}

    class ImgAgent(FakeAgent):
        def run(self, instruction, submit, images=None):
            seen.setdefault(self.role, []).append((images, instruction))
            return super().run(instruction, submit)

    agency, db = make_agency(tmp_path)
    state = {"qa": 1, "review": 1}
    agency._agent_factory = lambda role, ctx, hooks: ImgAgent(role, ctx, hooks, state)
    p = agency.start_project("Làm web theo mẫu", images=[(b"\x89PNG", "png")])
    _wait(agency, p["id"])
    pm_imgs = seen["pm"][0][0]
    assert len(pm_imgs) == 1 and pm_imgs[0].read_bytes() == b"\x89PNG"
    assert seen["designer"][0][0] == pm_imgs
    # Dev/Kiểm duyệt không nhận ảnh trực tiếp, chỉ được báo đường dẫn để tự xem
    images, instr = seen["backend"][0]
    assert images is None and ".agency/attachments/" in instr
    assert ".agency/attachments/" in seen["reviewer"][0][1]
    cmd = [e for e in db.list_events(p["id"]) if e["type"] == "message" and e["data"].get("kind") == "command"]
    assert cmd[0]["data"]["images"] == [pm_imgs[0].name]


def test_lessons_written_deduped_and_skipped_when_smooth(tmp_path):
    from backend.agents import profiles
    agency, db = make_agency(tmp_path)
    p = agency.start_project("Làm web")
    _wait(agency, p["id"])
    backend = profiles.lessons_of("backend", tmp_path / "agents")
    team = profiles.lessons_of("_team", tmp_path / "agents")
    assert len(backend) == 1 and "PHPUnit" in backend[0] and "(Tiệm bánh," in backend[0]
    assert len(team) == 1 and "migrate:fresh" in team[0]
    msgs = [e for e in db.list_events(p["id"]) if e["type"] == "message" and e["data"].get("kind") == "lessons"]
    assert len(msgs) == 1 and "[backend]" in msgs[0]["data"]["text"]
    # agent của vai đó thấy bài học trong prompt
    prof = profiles.load_profile("backend", tmp_path / "agents")
    assert "PHPUnit" in prof.prompt_section() and "migrate:fresh" in prof.prompt_section()

    # vòng sửa: cùng bài học → không ghi trùng
    agency.revise(p["id"], "Đổi màu")
    _wait(agency, p["id"])
    assert len(profiles.lessons_of("backend", tmp_path / "agents")) == 1

    # dự án trơn tru (QA đạt ngay, Kiểm duyệt duyệt ngay, không góp ý) → không tốn lượt rút bài học
    FakeAgent.calls = []
    agency._agent_factory = lambda role, ctx, hooks: FakeAgent(role, ctx, hooks, {"qa": 1, "review": 1})
    p2 = agency.start_project("Trơn tru")
    _wait(agency, p2["id"])
    assert ("pm", "submit_lessons") not in FakeAgent.calls


def test_append_lessons_cap_and_keeps_owner_text(tmp_path):
    from backend.agents import profiles
    (tmp_path / "qa").mkdir()
    f = tmp_path / "qa" / "lessons.md"
    f.write_text("# Bài học\nGhi chú của Sếp\n- Bài học Sếp tự viết đầu tiên\n", encoding="utf-8")
    for i in range(profiles.MAX_LESSONS + 5):
        profiles.append_lessons("qa", [f"Bài học số {i} cần nhớ kỹ"], "Dự án", tmp_path)
    text = f.read_text(encoding="utf-8")
    lines = profiles.lessons_of("qa", tmp_path)
    assert len(lines) == profiles.MAX_LESSONS
    assert "Ghi chú của Sếp" in text and "Bài học Sếp tự viết đầu tiên" not in text  # dòng cũ nhất bị bỏ
    assert profiles.append_lessons("qa", ["BÀI HỌC SỐ 24 cần nhớ kỹ!"], "Khác", tmp_path) == []  # trùng
    assert profiles.append_lessons("qa", ["ngắn"], "x", tmp_path) == []


def test_interject_reaches_later_agents_and_reports_missed(tmp_path):
    import threading
    agency, db = make_agency(tmp_path)
    seen = []
    gate = threading.Event()

    class NoteAgent(FakeAgent):
        def run(self, instruction, submit):
            if submit == "submit_plan":
                gate.wait(5)  # giữ PM ở bước lập kế hoạch tới khi Sếp nhắn xong
            seen.append((self.role, [n["text"] for n in self.hooks.owner_notes()]))
            for n in self.hooks.owner_notes():
                n["delivered"] = True
            return super().run(instruction, submit)

    agency._agent_factory = lambda role, ctx, hooks: NoteAgent(role, ctx, hooks, {"qa": 1, "review": 1})
    p = agency.start_project("Làm web")
    time.sleep(0.1)
    agency.interject(p["id"], "Thêm Google Map ở trang chủ")
    gate.set()
    _wait(agency, p["id"])
    assert ("designer", ["Thêm Google Map ở trang chủ"]) in seen
    msgs = [e for e in db.list_events(p["id"]) if e["type"] == "message" and e["data"].get("kind") == "interject"]
    assert msgs[0]["data"]["text"] == "Thêm Google Map ở trang chủ"
    # hết vòng thì không nhắn chen ngang được nữa
    import pytest
    with pytest.raises(RuntimeError):
        agency.interject(p["id"], "muộn")
    # vòng mới: hộp thư trống
    agency.revise(p["id"], "Sửa thêm")
    _wait(agency, p["id"])
    assert seen[-1][1] == []
