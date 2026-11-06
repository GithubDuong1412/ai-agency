"""Câu chữ nhắc đồng đội dùng mã vai trò {@role}; tên thật do giao diện điền theo config hiện tại."""
from backend.db import DB
from tests.test_orchestrator import FakeAgent, _wait, make_agency


def test_handoff_notes_use_role_tokens(tmp_path):
    FakeAgent.calls = []
    agency, db = make_agency(tmp_path)
    p = agency.start_project("Làm web tiệm bánh mì")
    _wait(agency, p["id"])
    notes = [e["data"]["note"] for e in db.list_events(p["id"]) if e["type"] == "handoff"]
    assert "Spec đã có trong SPEC.md, nhờ {@designer} lên thiết kế." in notes
    assert "Kiểm duyệt xong, nhờ anh {@pm} tổng hợp báo cáo." in notes
    assert not any(n for n in notes if "Lan" in n or "Quang" in n or "Minh" in n)


def test_migrate_old_hardcoded_names(tmp_path):
    db = DB(tmp_path / "t.db")
    db.add_event("p1", "handoff", "pm", {"to": "designer", "note": "Spec đã có trong SPEC.md, nhờ Lan lên thiết kế."})
    db.add_event("p1", "message", "pm", {"text": "Kế hoạch: Nam làm route + form, Huy dựng giao diện. Thảo test, Quang duyệt."})
    db.migrate_name_tokens()
    db.migrate_name_tokens()  # chạy lại không đổi gì thêm
    ev = db.list_events("p1")
    assert ev[0]["data"]["note"] == "Spec đã có trong SPEC.md, nhờ {@designer} lên thiết kế."
    assert ev[1]["data"]["text"].startswith("Kế hoạch: {@backend} làm route")
