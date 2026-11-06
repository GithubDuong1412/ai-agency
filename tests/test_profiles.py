"""Hồ sơ chuyên môn: nạp luật vào prompt, tra kiến thức, chặn đường dẫn lạ khi sửa từ dashboard."""
from pathlib import Path

import pytest

from backend.agents import profiles
from backend.agents.base import build_system
from backend.agents.roles import ROLES
from backend.settings import AGENTS_DIR
from backend.tools.registry import ToolContext, execute_tool

ROLE_KEYS = list(ROLES)


@pytest.fixture
def base(tmp_path: Path) -> Path:
    (tmp_path / "_team" / "knowledge").mkdir(parents=True)
    (tmp_path / "_team" / "rules.md").write_text("<!-- nguồn: x -->\n# Luật chung\n- Dùng Laravel", encoding="utf-8")
    (tmp_path / "_team" / "knowledge" / "chung.md").write_text("# Kiến thức chung\nA", encoding="utf-8")
    (tmp_path / "_team" / "knowledge" / "trung.md").write_text("# Bản của đội\nTEAM", encoding="utf-8")
    (tmp_path / "backend" / "knowledge").mkdir(parents=True)
    (tmp_path / "backend" / "rules.md").write_text("# Luật backend\n- Dùng Form Request", encoding="utf-8")
    (tmp_path / "backend" / "checklist.md").write_text("# Checklist\n- [ ] test pass", encoding="utf-8")
    (tmp_path / "backend" / "knowledge" / "laravel.md").write_text("<!-- c -->\n# Quy ước Laravel\nB", encoding="utf-8")
    (tmp_path / "backend" / "knowledge" / "trung.md").write_text("# Bản của backend\nROLE", encoding="utf-8")
    (tmp_path / "backend" / "knowledge" / "Bad Name.md").write_text("x", encoding="utf-8")
    return tmp_path


def test_prompt_section_includes_rules_and_topics(base):
    p = profiles.load_profile("backend", base)
    s = p.prompt_section()
    assert "Luật chung" in s and "Luật backend" in s and "Checklist" in s
    assert "nguồn" not in s                      # chú thích HTML bị bỏ
    slugs = [t.slug for t in p.topics]
    assert slugs == ["laravel", "trung", "chung"]  # bản vai trò trước, không trùng, bỏ tên không hợp lệ
    assert "`laravel`: Quy ước Laravel" in s


def test_read_knowledge_role_overrides_team(base):
    assert "Quy ước" in profiles.read_knowledge("backend", "Laravel", base)  # không phân biệt hoa thường
    assert "ROLE" in profiles.read_knowledge("backend", "trung", base)
    assert "TEAM" in profiles.read_knowledge("qa", "trung", base)
    assert profiles.read_knowledge("backend", "chung.md", base).startswith("# Kiến thức chung")
    with pytest.raises(profiles.ProfileError, match="Các chủ đề có"):
        profiles.read_knowledge("backend", "khong-co", base)


@pytest.mark.parametrize("topic", ["../_team/rules", "a/b", "", "..", "x" * 80, "lara vel"])
def test_read_knowledge_rejects_bad_slugs(base, topic):
    with pytest.raises(profiles.ProfileError):
        profiles.read_knowledge("backend", topic, base)


@pytest.mark.parametrize("rel", ["../config.yaml", "knowledge/../../x.md", "notes.txt", "knowledge/A.md",
                                 "knowledge/sub/x.md", "/etc/passwd", "C:/x.md"])
def test_write_rejects_paths(base, rel):
    with pytest.raises(profiles.ProfileError):
        profiles.write_file("backend", rel, "x", ROLE_KEYS, base)


def test_write_read_delete_cycle(base):
    profiles.write_file("backend", "knowledge/moi.md", "# Mới\r\nnội dung", ROLE_KEYS, base)
    assert profiles.read_file("backend", "knowledge/moi.md", ROLE_KEYS, base) == "# Mới\nnội dung"
    assert any(f["path"] == "knowledge/moi.md" for f in profiles.list_files("backend", ROLE_KEYS, base))
    profiles.delete_file("backend", "knowledge/moi.md", ROLE_KEYS, base)
    assert not (base / "backend" / "knowledge" / "moi.md").exists()
    with pytest.raises(profiles.ProfileError):
        profiles.delete_file("backend", "rules.md", ROLE_KEYS, base)
    with pytest.raises(profiles.ProfileError):
        profiles.write_file("hacker", "rules.md", "x", ROLE_KEYS, base)


def test_read_knowledge_tool(tmp_path, base):
    ctx = ToolContext(sandbox=None, runner=None, screenshot_dir=tmp_path, get_preview_url=lambda: "",
                      post_message=lambda *a: None,
                      read_knowledge=lambda t: profiles.read_knowledge("backend", t, base))
    content, is_err, _ = execute_tool("read_knowledge", {"topic": "laravel"}, ctx)
    assert not is_err and "Quy ước Laravel" in content
    content, is_err, _ = execute_tool("read_knowledge", {"topic": "../rules"}, ctx)
    assert is_err


def test_shipped_profiles_are_complete():
    """Bộ hồ sơ soạn sẵn: mỗi vai trò có luật + checklist + ít nhất 2 chủ đề, prompt không quá dài,
    và mọi chủ đề được nhắc tới trong luật đều tồn tại."""
    import re
    assert (AGENTS_DIR / "_team" / "rules.md").is_file()
    for role in ROLE_KEYS:
        p = profiles.load_profile(role)
        assert p.rules and p.checklist, role
        assert len([t for t in p.topics if t.scope == role]) >= 2, role
        slugs = {t.slug for t in p.topics}
        text = p.team_rules + p.rules + p.checklist
        for m in re.finditer(r"knowledge (`[a-z0-9-]+`(?:,\s*`[a-z0-9-]+`)*)", text):
            for ref in re.findall(r"`([a-z0-9-]+)`", m.group(1)):
                assert ref in slugs, f"{role}: luật nhắc tới '{ref}' nhưng không có file"
        system = build_system(role)
        assert "read_knowledge" in system and p.rules.splitlines()[0] in system
        assert len(system) < 16_000, f"{role}: prompt quá dài ({len(system)})"
        assert "read_knowledge" in ROLES[role].tools
