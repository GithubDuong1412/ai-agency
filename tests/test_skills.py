"""Skill (SKILL.md) gán cho agent: thư viện, gán, đọc, chạy script, cài/gỡ."""
from pathlib import Path

import pytest

from backend.agents import skills
from backend.agents.roles import ROLES

ROLE_KEYS = list(ROLES)


def make_skill(base: Path, name: str, desc: str = "Mô tả", script: str | None = None, body: str = "# Hướng dẫn\n") -> Path:
    d = base / name
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: \"{desc}\"\n---\n{body}", encoding="utf-8")
    (d / "references").mkdir()
    (d / "references" / "a.md").write_text("# Tài liệu A", encoding="utf-8")
    if script:
        (d / "scripts" / "run.py").write_text(script, encoding="utf-8")
    return d


@pytest.fixture
def env(tmp_path: Path):
    agency, machine = tmp_path / "agency", tmp_path / "machine"
    agency.mkdir(); machine.mkdir()
    make_skill(machine, "ui-kit", "Bản trên máy",
               script="import sys, pathlib\nprint('args=' + '|'.join(sys.argv[1:]))\nprint('cwd=' + pathlib.Path.cwd().name)\n")
    make_skill(machine, "chung", "Bản máy (bị agency che)")
    make_skill(agency, "chung", "Bản agency")
    (machine / "synced").mkdir()          # thư mục không có SKILL.md: bỏ qua
    assign = tmp_path / "skills.yaml"
    kw = {"agency_dir": agency, "machine_dir": machine}
    return {"agency": agency, "machine": machine, "assign": assign, "kw": kw, "tmp": tmp_path}


def test_list_prefers_agency_and_reads_frontmatter(env):
    found = {s.name: s for s in skills.list_skills(**env["kw"])}
    assert set(found) == {"ui-kit", "chung"}
    assert found["chung"].source == "agency" and found["chung"].description == "Bản agency"
    assert found["ui-kit"].source == "machine" and found["ui-kit"].to_dict()["scripts"] == ["scripts/run.py"]


def test_assignment_and_prompt(env):
    kw = env["kw"]
    assert skills.save_assignment("designer", ["ui-kit", "ui-kit", "chung"], ROLE_KEYS, env["assign"], **kw) == ["ui-kit", "chung"]
    assert skills.load_assignments(env["assign"]) == {"designer": ["ui-kit", "chung"]}
    with pytest.raises(skills.SkillError):
        skills.save_assignment("designer", ["khong-co"], ROLE_KEYS, env["assign"], **kw)
    with pytest.raises(skills.SkillError):
        skills.save_assignment("hacker", ["ui-kit"], ROLE_KEYS, env["assign"], **kw)
    sec = skills.prompt_section("designer", path=env["assign"], **kw)
    assert "`ui-kit`: Bản trên máy" in sec and "run_skill_script" in sec and "ưu tiên hơn skill" in sec
    assert skills.prompt_section("backend", path=env["assign"], **kw) == ""


def test_read_skill_permissions_paths_and_paging(env):
    kw = {"path": env["assign"], **env["kw"]}
    skills.save_assignment("designer", ["ui-kit"], ROLE_KEYS, env["assign"], **env["kw"])
    assert "# Hướng dẫn" in skills.read_skill("designer", "ui-kit", **kw)
    assert skills.read_skill("designer", "ui-kit", "references/a.md", **kw) == "# Tài liệu A"
    assert "references/a.md" in skills.read_skill("designer", "ui-kit", ".", **kw)
    with pytest.raises(skills.SkillError, match="không được giao"):
        skills.read_skill("backend", "ui-kit", **kw)
    for bad in ("../chung/SKILL.md", "/etc/passwd", "C:/Windows/win.ini", "references/../../x"):
        with pytest.raises(skills.SkillError):
            skills.read_skill("designer", "ui-kit", bad, **kw)
    # file dài: chia trang bằng offset
    (env["machine"] / "ui-kit" / "long.md").write_text("x" * (skills.MAX_READ + 50), encoding="utf-8")
    first = skills.read_skill("designer", "ui-kit", "long.md", **kw)
    assert f"offset={skills.MAX_READ}" in first
    assert skills.read_skill("designer", "ui-kit", "long.md", skills.MAX_READ, **kw) == "x" * 50


def test_run_script_cwd_args_and_blocking(env):
    kw = {"path": env["assign"], **env["kw"]}
    skills.save_assignment("frontend", ["ui-kit"], ROLE_KEYS, env["assign"], **env["kw"])
    ws = env["tmp"] / "workspace-1"
    ws.mkdir()
    code, out = skills.run_script("frontend", "ui-kit", "scripts/run.py", ["a b", "--domain", "ux", "out/x.md"], ws, **kw)
    assert code == 0 and "args=a b|--domain|ux|out/x.md" in out and "cwd=workspace-1" in out
    for bad in (["/abs"], ["C:\\x"], ["--out=../x"], ["~/.ssh"], ["a/../../b"]):
        with pytest.raises(skills.SkillError):
            skills.run_script("frontend", "ui-kit", "scripts/run.py", bad, ws, **kw)
    with pytest.raises(skills.SkillError):
        skills.run_script("frontend", "ui-kit", "SKILL.md", [], ws, **kw)       # không phải script
    with pytest.raises(skills.SkillError):
        skills.run_script("qa", "ui-kit", "scripts/run.py", [], ws, **kw)       # không được giao


def test_install_overwrite_uninstall(env):
    agency = env["agency"]
    s = skills.install(env["machine"] / "ui-kit", agency_dir=agency)
    assert s.source == "agency" and (agency / "ui-kit" / "scripts" / "run.py").is_file()
    with pytest.raises(skills.SkillError, match="đã có"):
        skills.install(env["machine"] / "ui-kit", agency_dir=agency)
    skills.install(env["machine"] / "ui-kit", overwrite=True, agency_dir=agency)
    empty = env["tmp"] / "khong-phai-skill"
    empty.mkdir()
    with pytest.raises(skills.SkillError, match="SKILL.md"):
        skills.install(empty, agency_dir=agency)
    skills.uninstall("ui-kit", agency_dir=agency)
    assert not (agency / "ui-kit").exists()
    with pytest.raises(skills.SkillError):
        skills.uninstall("ui-kit", agency_dir=agency)      # không còn trong agency
    with pytest.raises(skills.SkillError):
        skills.uninstall("../machine", agency_dir=agency)


def test_agent_gets_skill_tools_only_when_assigned(monkeypatch):
    from backend.agents import base
    monkeypatch.setattr(base.skills_mod, "skills_for", lambda role, **kw: [object()] if role == "designer" else [])
    hooks = type("H", (), {})()
    names = lambda role: [t["name"] for t in base.Agent(role, None, None, hooks)._tools("submit_design")]
    assert {"use_skill", "run_skill_script"} <= set(names("designer"))
    assert "use_skill" not in names("backend")


def test_shipped_assignment_ui_ux_pro_max():
    """ui-ux-pro-max đã cài vào agency và gán cho Lan (designer) và Huy (frontend)."""
    a = skills.load_assignments()
    assert "ui-ux-pro-max" in a.get("designer", []) and "ui-ux-pro-max" in a.get("frontend", [])
    s = skills.get_skill("ui-ux-pro-max")
    assert s.source == "agency" and "scripts/search.py" in s.to_dict()["scripts"]
