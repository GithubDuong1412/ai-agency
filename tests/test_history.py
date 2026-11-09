"""Lịch sử sự kiện theo trang (tab Hội thoại của dự án) và lọc loại khi nạp đầu."""
from backend.db import DB


def _seed(db):
    p = db.create_project("Thử lịch sử")
    other = db.create_project("Dự án khác")
    ids = []
    for i in range(10):
        ids.append(db.add_event(p["id"], "message", "pm", {"text": f"tin {i}"})["id"])
        db.add_event(p["id"], "usage", "pm", {"n": i})
        db.add_event(other["id"], "message", "pm", {"text": "khác"})
    return p["id"], ids


def test_page_events_walks_backwards(tmp_path):
    db = DB(tmp_path / "t.db")
    pid, ids = _seed(db)
    page, more = db.page_events(pid, 0, 4, ["message"])
    assert [e["data"]["text"] for e in page] == ["tin 6", "tin 7", "tin 8", "tin 9"] and more
    page, more = db.page_events(pid, page[0]["id"], 4, ["message"])
    assert [e["data"]["text"] for e in page] == ["tin 2", "tin 3", "tin 4", "tin 5"] and more
    page, more = db.page_events(pid, page[0]["id"], 4, ["message"])
    assert [e["data"]["text"] for e in page] == ["tin 0", "tin 1"] and not more
    # không lọc loại: có cả usage; chỉ của dự án này
    page, _ = db.page_events(pid, 0, 100)
    assert len(page) == 20 and {e["project_id"] for e in page} == {pid}


def test_page_events_exact_fit_has_no_more(tmp_path):
    db = DB(tmp_path / "t.db")
    pid, _ = _seed(db)
    page, more = db.page_events(pid, 0, 10, ["message"])
    assert len(page) == 10 and not more


def test_list_events_exclude_and_old_behaviour(tmp_path):
    db = DB(tmp_path / "t.db")
    pid, ids = _seed(db)
    assert len(db.list_events(None, 0, 1000)) == 30
    assert all(e["type"] != "usage" for e in db.list_events(None, 0, 1000, exclude=["usage"]))
    after = db.list_events(pid, ids[4], 1000)
    assert after[0]["id"] > ids[4] and len(after) == 11
