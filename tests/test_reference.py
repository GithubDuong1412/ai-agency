"""Thư viện agent mẫu (agency-agents): tải + index, danh mục, đọc file, PM dùng làm gốc cho rules / checklist."""
import io
import json
import os
import time

import pytest

from backend import reference, skill_fetch
from backend.agents import hired
from backend.agents import skills as skills_mod
from backend.agents.base import AgentResult
from backend.tools.registry import execute_tool
from tests.test_hiring import CAND, _wait_hiring
from tests.test_hiring_research import _zip
from tests.test_orchestrator import FakeAgent, make_agency

SEO = ("---\nname: SEO Specialist\ndescription: \"Expert search engine optimization strategist\"\n"
       "color: \"#4285F4\"\nvibe: Drives organic traffic.\n---\n# SEO Specialist\n## Critical Rules\n"
       "- LCP < 2.5s\n" + "x" * 50)
FILES = {
    "marketing/marketing-seo-specialist.md": SEO,
    "engineering/engineering-frontend-developer.md": "# Frontend Developer\nNo frontmatter here.",
    "game-development/unity/unity-architect.md": "---\nname: Unity Architect\ndescription: d\n---\n",
    "README.md": "root readme", "CONTRIBUTING.md": "c",
    ".github/workflows/x.md": "ci", "scripts/convert.md": "s", "marketing/logo.png": "png",
    "marketing/README.md": "division readme",
}


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def fake_download(monkeypatch):
    calls = []

    def urlopen(req, timeout=0):
        calls.append(req.full_url)
        if getattr(urlopen, "fail", False):
            raise OSError("offline")
        return Resp(_zip(FILES, top="agency-agents-main"))

    monkeypatch.setattr(skill_fetch.urllib.request, "urlopen", urlopen)
    return urlopen, calls


CFG = {"reference_repo": "https://github.com/msitarzewski/agency-agents", "reference_ref": "main",
       "reference_refresh_days": 7}


def test_ensure_library_extracts_and_indexes(tmp_path, fake_download):
    _, calls = fake_download
    lib = reference.ensure_library(tmp_path, CFG)
    assert calls == ["https://codeload.github.com/msitarzewski/agency-agents/zip/main"]
    assert [e["path"] for e in lib.entries] == [
        "engineering/engineering-frontend-developer.md", "game-development/unity/unity-architect.md",
        "marketing/marketing-seo-specialist.md"]
    seo = lib.get("marketing/marketing-seo-specialist.md")
    assert seo["name"] == "SEO Specialist" and seo["description"] == "Expert search engine optimization strategist"
    assert seo["vibe"] == "Drives organic traffic." and seo["division"] == "marketing"
    assert lib.get("engineering/engineering-frontend-developer.md")["name"] == "Frontend Developer"
    assert not (lib.root / "README.md").exists() and not (lib.root / ".github").exists()
    assert not (lib.root / "scripts").exists() and not (lib.root / "marketing" / "logo.png").exists()
    assert reference.github_url(lib.repo, lib.ref, seo["path"]) == \
        "https://github.com/msitarzewski/agency-agents/blob/main/marketing/marketing-seo-specialist.md"


def test_cache_fresh_stale_and_offline(tmp_path, fake_download):
    urlopen, calls = fake_download
    reference.ensure_library(tmp_path, CFG)
    reference.ensure_library(tmp_path, CFG)
    assert len(calls) == 1                                  # còn mới: không tải lại
    idx = tmp_path / "agency-agents" / reference.INDEX
    old = time.time() - 10 * 86400
    os.utime(idx, (old, old))
    urlopen.fail = True
    lib = reference.ensure_library(tmp_path, CFG)          # cũ + tải lỗi → dùng bản cũ
    assert len(calls) == 2 and lib and len(lib.entries) == 3
    assert reference.ensure_library(tmp_path / "empty", CFG) is None   # không cache + tải lỗi
    assert reference.ensure_library(tmp_path, {**CFG, "reference_repo": "https://gitlab.com/a/b"}) is None


def test_extract_library_guards(tmp_path):
    with pytest.raises(skill_fetch.FetchError):
        reference.extract_library(_zip({"repo/../../evil.md": "e"}, top=""), tmp_path / "x")
    assert not (tmp_path / "evil.md").exists()
    with pytest.raises(skill_fetch.FetchError):
        reference.extract_library(_zip({"README.md": "r"}), tmp_path / "y")
    big = reference.extract_library(_zip({"a/big.md": "x" * (reference.MAX_FILE_BYTES + 1), "a/ok.md": "# Ok"}),
                                    tmp_path / "z")
    assert [e["path"] for e in big] == ["a/ok.md"]


def test_catalog_and_read(tmp_path, fake_download):
    lib = reference.ensure_library(tmp_path, CFG)
    cat = reference.catalog_text(lib)
    assert "### marketing" in cat and "- marketing/marketing-seo-specialist.md — SEO Specialist: Expert" in cat
    assert cat.index("### engineering") < cat.index("### marketing")
    text = reference.read(lib, "marketing/marketing-seo-specialist.md")
    assert "LCP < 2.5s" in text and "[Hết file]" in text
    monkey_chunk = reference.READ_CHUNK
    try:
        reference.READ_CHUNK = 40
        first = reference.read(lib, "marketing/marketing-seo-specialist.md")
        assert "offset=40" in first
        assert "ký tự 40-" in reference.read(lib, "marketing/marketing-seo-specialist.md", 40)
    finally:
        reference.READ_CHUNK = monkey_chunk
    for bad in ("README.md", "../config.yaml", "marketing/khong-co.md"):
        with pytest.raises(ValueError):
            reference.read(lib, bad)


# ---------- luồng tuyển dụng ----------
@pytest.fixture
def tmp_dirs(tmp_path, monkeypatch):
    base = tmp_path / "agents"
    base.mkdir(exist_ok=True)
    monkeypatch.setattr(hired, "HIRED_FILE", base / "hired.yaml")
    monkeypatch.setattr(hired, "BASE_DIR", base)
    monkeypatch.setattr(hired, "SKILLS_FILE", base / "skills.yaml")
    monkeypatch.setattr(skills_mod, "AGENCY_SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(skills_mod, "MACHINE_SKILLS_DIR", tmp_path / "machine-skills")
    monkeypatch.setattr(skills_mod, "ASSIGN_FILE", base / "skills.yaml")
    return tmp_path


def test_hiring_uses_reference_library(tmp_dirs, fake_download, monkeypatch):
    seen = {}

    class PM(FakeAgent):
        def run(self, instruction, submit, images=None, server_tools=None, extra_tools=None):
            seen.update(instruction=instruction, extra=extra_tools, server=server_tools)
            seen["read"] = execute_tool("read_reference", {"path": "marketing/marketing-seo-specialist.md"},
                                        self.ctx)
            seen["bad"] = execute_tool("read_reference", {"path": "../hired.yaml"}, self.ctx)
            return AgentResult({"summary": "s", "candidates": [{
                **CAND, "knowledge": [], "existing_skills": [], "skill_downloads": [],
                "skill": {"name": "", "description": "", "content_markdown": ""},
                "reference_agents": ["marketing/marketing-seo-specialist.md", "marketing/khong-co.md"],
                "sources": [{"title": "Google", "url": "https://developers.google.com/search", "note": "n"},
                            {"title": "trùng", "url": "https://github.com/msitarzewski/agency-agents/blob/main/"
                                                     "marketing/marketing-seo-specialist.md", "note": ""}],
            }]}, 1)

    agency, db = make_agency(tmp_dirs)
    monkeypatch.setattr("backend.hiring.hiring_cfg", lambda: CFG)
    agency._agent_factory = lambda role, ctx, hooks: PM(role, ctx, hooks, {"qa": 1, "review": 1})
    h = agency.hiring.request("Cần người viết SEO")
    _wait_hiring(agency, h["id"])
    h = db.get_hiring(h["id"])
    assert h["status"] == "pending", h
    assert seen["extra"] == ["read_reference"] and seen["server"]
    assert "marketing/marketing-seo-specialist.md — SEO Specialist" in seen["instruction"]
    assert "read_reference" in seen["instruction"]
    content, is_err, _ = seen["read"]
    assert not is_err and "LCP < 2.5s" in content
    assert seen["bad"][1] is True
    c = h["proposal"]["candidates"][0]
    url = "https://github.com/msitarzewski/agency-agents/blob/main/marketing/marketing-seo-specialist.md"
    assert c["reference_agents"] == ["marketing/marketing-seo-specialist.md"]
    assert c["reference_meta"] == [{"path": "marketing/marketing-seo-specialist.md", "name": "SEO Specialist",
                                    "url": url}]
    assert [s["url"] for s in c["sources"]] == [url, "https://developers.google.com/search"]

    agency.hiring.approve(h["id"], [c])
    src = (tmp_dirs / "agents" / CAND["key"] / "knowledge" / "nguon-tham-khao.md").read_text(encoding="utf-8")
    assert "marketing-seo-specialist.md" in src


def test_normalize_without_library_accepts_well_formed_paths():
    from backend.hiring import _reference_meta
    out = _reference_meta(["marketing/marketing-seo-specialist.md", "../x.md", "README.md", "a/b/../c.md", 5], None)
    assert [r["path"] for r in out] == ["marketing/marketing-seo-specialist.md"]
    assert out[0]["url"].endswith("/blob/main/marketing/marketing-seo-specialist.md")


def test_agent_tools_include_extra():
    from types import SimpleNamespace

    from backend.agents.base import Agent
    hooks = SimpleNamespace(emit=lambda *a, **k: None)
    agent = Agent("pm", None, SimpleNamespace(), hooks)
    names = [t["name"] for t in agent._tools("submit_hiring", extra_tools=["read_reference"])]
    assert "read_reference" in names
    assert "read_reference" not in [t["name"] for t in agent._tools("submit_hiring")]


def test_index_json_roundtrip(tmp_path, fake_download):
    reference.ensure_library(tmp_path, CFG)
    data = json.loads((tmp_path / "agency-agents" / reference.INDEX).read_text(encoding="utf-8"))
    assert data["repo"] == "https://github.com/msitarzewski/agency-agents" and data["ref"] == "main"
