"""Lịch sử phiên bản bằng git trong workspace."""
import pytest

from backend import versions
from tests.test_orchestrator import FakeAgent, _wait, make_agency

pytestmark = pytest.mark.skipif(not versions.available(), reason="máy không có git")


def test_commit_list_diff_restore(tmp_path):
    ws = tmp_path / "ws"
    (ws / "routes").mkdir(parents=True)
    (ws / "routes" / "web.php").write_text("<?php // v0\n", encoding="utf-8")
    (ws / ".agency").mkdir()
    (ws / ".agency" / "shot.png").write_bytes(b"x")

    assert versions.ensure_repo(ws)
    base = versions.list_versions(ws)
    assert len(base) == 1 and base[0]["run_no"] == 0 and base[0]["current"]

    (ws / "routes" / "web.php").write_text("<?php // v1\n", encoding="utf-8")
    (ws / "new.txt").write_text("thêm mới\n", encoding="utf-8")
    sha1 = versions.commit(ws, "Vòng 1: thêm trang", run_no=1)
    assert versions.commit(ws, "không đổi gì") is None

    vs = versions.list_versions(ws)
    assert [v["run_no"] for v in vs] == [1, 0]
    assert vs[0]["sha"] == sha1 and vs[0]["files"] == 2 and vs[0]["insertions"] == 2

    files = {f["path"]: f for f in versions.diff(ws, sha1)}
    assert set(files) == {"routes/web.php", "new.txt"}  # .agency/ không vào lịch sử
    assert files["new.txt"]["status"] == "added"
    assert "+<?php // v1" in files["routes/web.php"]["patch"]

    # Quay về vòng 0: file thêm sau bị xoá, nội dung cũ trở lại, lịch sử vẫn giữ
    versions.restore(ws, base[0]["sha"], "Quay về: Hiện trạng ban đầu")
    assert not (ws / "new.txt").exists()
    assert (ws / "routes" / "web.php").read_text(encoding="utf-8") == "<?php // v0\n"
    assert (ws / ".agency" / "shot.png").exists()
    titles = [v["title"] for v in versions.list_versions(ws)]
    assert titles[0] == "Quay về: Hiện trạng ban đầu" and len(titles) == 3

    with pytest.raises(versions.VersionError):
        versions.diff(ws, "not-a-sha; rm -rf")


def test_each_run_is_a_version(tmp_path):
    FakeAgent.calls = []
    agency, db = make_agency(tmp_path)
    p = agency.start_project("Làm web tiệm bánh mì")
    _wait(agency, p["id"])
    agency.revise(p["id"], "Đổi màu")
    _wait(agency, p["id"])

    ws = agency.workspace(p["id"])
    vs = versions.list_versions(ws)
    assert [v["run_no"] for v in vs][:2] == [2, 1]
    reports = db.list_reports(p["id"])
    assert {r["content"]["commit"] for r in reports} == {vs[0]["sha"], vs[1]["sha"]}
