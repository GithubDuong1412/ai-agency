"""Tuyển dụng có nghiên cứu: server tool web, phí web search, tải skill GitHub vào khu chờ, duyệt cài skill + kiến thức."""
import io
import zipfile
from types import SimpleNamespace

import pytest

from backend import skill_fetch
from backend.agents import hired
from backend.agents import skills as skills_mod
from backend.agents.base import AgentResult
from backend.tools.web import web_tools
from tests.test_hiring import CAND, _wait_hiring
from tests.test_orchestrator import FakeAgent, make_agency


@pytest.fixture(autouse=True)
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


def _zip(files: dict[str, str], top="repo-main") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, body in files.items():
            z.writestr(f"{top}/{name}" if top else name, body)
    return buf.getvalue()


SKILL_MD = "---\nname: seo-audit\ndescription: Kiểm tra SEO một trang\n---\n# SEO audit\n"


# ---------- web tools / chi phí ----------
def test_web_tools_versions():
    new = web_tools("claude-sonnet-5-5", {"web_search_uses": 4, "web_fetch_uses": 6})
    assert [t["type"] for t in new] == ["web_search_20260209", "web_fetch_20260209"]
    assert new[0]["max_uses"] == 4 and new[1]["max_uses"] == 6
    assert web_tools("claude-opus-5-5")[0]["type"] == "web_search_20260209"
    old = web_tools("claude-haiku-5-5")
    assert [t["type"] for t in old] == ["web_search_20250305", "web_fetch_20250910"]


def test_usage_cost_counts_web_search():
    from backend.orchestrator import usage_cost
    u = SimpleNamespace(input_tokens=0, output_tokens=0, cache_creation_input_tokens=0, cache_read_input_tokens=0,
                        server_tool_use=SimpleNamespace(web_search_requests=5))
    _, _, cost = usage_cost("claude-sonnet-5-5", u)
    assert cost == pytest.approx(0.05)


def test_agent_loop_reports_server_tools(monkeypatch):
    """Agent thật với client giả: server tool được gửi kèm, block server_tool_use thành event 'tool'."""
    from backend.agents.base import Agent

    sent = {}

    def block(**kw):
        return SimpleNamespace(**kw)

    resp1 = SimpleNamespace(
        model="m", stop_reason="end_turn", usage=None,
        content=[block(type="server_tool_use", name="web_search", input={"query": "seo guide"}, id="s1"),
                 block(type="web_search_tool_result", tool_use_id="s1", content=[]),
                 block(type="tool_use", name="submit_hiring", id="t1",
                       input={"summary": "x", "candidates": []})])

    class Stream:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get_final_message(self):
            return resp1

    class Client:
        class beta:
            class messages:
                @staticmethod
                def stream(**params):
                    sent.update(params)
                    return Stream()

    events = []
    hooks = SimpleNamespace(emit=lambda t, a, **d: events.append((t, d)), add_usage=lambda m, u: None,
                            should_stop=lambda: False, over_budget=lambda: False)
    ctx = SimpleNamespace()
    agent = Agent("pm", Client(), ctx, hooks)
    out = agent.run("soạn", "submit_hiring", server_tools=web_tools("claude-opus-5-5"))
    assert out.data["summary"] == "x"
    names = [t.get("name") for t in sent["tools"]]
    assert "web_search" in names and "web_fetch" in names
    ws = next(t for t in sent["tools"] if t.get("name") == "web_search")
    assert "eager_input_streaming" not in ws
    assert ("tool", {"tool": "web_search", "summary": "seo guide", "is_error": False}) in events


# ---------- tải skill GitHub ----------
def test_parse_github_url():
    assert skill_fetch.parse_github_url("https://github.com/anthropics/skills/tree/main/skills/pdf") == \
        ("anthropics", "skills", "main", "skills/pdf")
    assert skill_fetch.parse_github_url("https://github.com/a/b") == ("a", "b", None, "")
    assert skill_fetch.parse_github_url("https://github.com/a/b/blob/main/x/SKILL.md")[3] == "x"
    for bad in ("http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com/a",
                "https://github.com/a/b/issues/1", "https://github.com/a/b/tree/main/../etc"):
        with pytest.raises(skill_fetch.FetchError):
            skill_fetch.parse_github_url(bad)


def test_extract_skill_subdir_and_guards(tmp_path):
    data = _zip({"skills/seo/SKILL.md": SKILL_MD, "skills/seo/scripts/run.py": "print(1)",
                 "skills/other/SKILL.md": "x", "README.md": "r"})
    dest = tmp_path / "st" / "seo"
    skill_fetch.extract_skill(data, "skills/seo", dest)
    assert (dest / "SKILL.md").is_file() and (dest / "scripts" / "run.py").is_file()
    assert not (dest / "README.md").exists()
    m = skill_fetch.manifest(dest, "u")
    assert m["description"] == "Kiểm tra SEO một trang" and m["scripts"] == ["scripts/run.py"]

    with pytest.raises(skill_fetch.FetchError):  # thiếu SKILL.md
        skill_fetch.extract_skill(_zip({"x/a.md": "a"}), "x", tmp_path / "a")
    with pytest.raises(skill_fetch.FetchError):  # zip-slip
        skill_fetch.extract_skill(_zip({"repo/../../evil.md": "e", "repo/SKILL.md": "s"}, top=""), "", tmp_path / "b")
    assert not (tmp_path / "evil.md").exists()
    with pytest.raises(skill_fetch.FetchError):  # quá nhiều file
        many = {f"s/f{i}.md": "x" for i in range(skill_fetch.MAX_FILES + 2)}
        skill_fetch.extract_skill(_zip({**many, "s/SKILL.md": "s"}), "s", tmp_path / "c")


def test_fetch_github_uses_codeload(monkeypatch, tmp_path):
    urls = []

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=0):
        urls.append(req.full_url)
        return Resp(_zip({"skills/seo/SKILL.md": SKILL_MD}))

    monkeypatch.setattr(skill_fetch.urllib.request, "urlopen", fake_urlopen)
    m = skill_fetch.fetch_github("https://github.com/acme/skills/tree/main/skills/seo", tmp_path / "seo")
    assert urls == ["https://codeload.github.com/acme/skills/zip/main"]
    assert m["ok"] and m["name"] == "seo"


# ---------- luồng đầy đủ ----------
class ResearchPM(FakeAgent):
    def run(self, instruction, submit, images=None):
        assert submit == "submit_hiring"
        assert "web_search" in instruction and "shared-skill" in instruction
        return AgentResult({"summary": "Tuyển 1 người", "candidates": [{
            **CAND,
            "sources": [{"title": "Google SEO", "url": "https://developers.google.com/search", "note": "nền tảng"},
                        {"title": "rác", "url": "javascript:alert(1)", "note": ""}],
            "knowledge": [{"slug": "SEO On Page", "title": "SEO on-page", "content_markdown": "Ngưỡng title 60"}],
            "skill": {"name": "seo-workflow", "description": "Quy trình SEO", "content_markdown": "# Các bước\n1. a"},
            "existing_skills": ["shared-skill", "khong-co"],
            "skill_downloads": [{"url": "https://github.com/acme/skills/tree/main/skills/seo-audit", "reason": "r"},
                                {"url": "https://github.com/acme/missing", "reason": "r"}],
        }]}, 1)


def test_research_hiring_flow(tmp_dirs, monkeypatch):
    tmp_path = tmp_dirs
    shared = tmp_path / "skills" / "shared-skill"
    shared.mkdir(parents=True)
    (shared / "SKILL.md").write_text("---\nname: shared-skill\ndescription: dùng chung\n---\n", encoding="utf-8")

    def fake_fetch(url, dest):
        if "missing" in url:
            raise skill_fetch.FetchError("GitHub trả lỗi 404")
        skill_fetch.extract_skill(_zip({"skills/seo-audit/SKILL.md": SKILL_MD,
                                        "skills/seo-audit/scripts/a.py": "print(1)"}), "skills/seo-audit", dest)
        return skill_fetch.manifest(dest, url)

    monkeypatch.setattr(skill_fetch, "fetch_github", fake_fetch)
    agency, db = make_agency(tmp_path)
    agency._agent_factory = lambda role, ctx, hooks: ResearchPM(role, ctx, hooks, {"qa": 1, "review": 1})
    h = agency.hiring.request("Cần người viết SEO")
    _wait_hiring(agency, h["id"])
    h = db.get_hiring(h["id"])
    assert h["status"] == "pending", h
    c = h["proposal"]["candidates"][0]
    assert [s["url"] for s in c["sources"]] == ["https://developers.google.com/search"]
    assert c["knowledge"][0]["slug"] == "seo-on-page"
    assert c["existing_skills"] == ["shared-skill"]
    staged = {s["name"]: s for s in c["staged_skills"]}
    assert staged["seo-workflow"]["kind"] == "authored" and staged["seo-workflow"]["ok"]
    assert staged["seo-audit"]["scripts"] == ["scripts/a.py"]
    assert not staged["missing"]["ok"] and "404" in staged["missing"]["error"]
    stage = agency.hiring.staging_root / h["id"]
    assert (stage / "skills" / "seo-audit" / "SKILL.md").is_file()
    assert "SEO audit" in agency.hiring.staged_file(h["id"], "seo-audit")
    with pytest.raises(ValueError):
        agency.hiring.staged_file(h["id"], "seo-audit", "../../x")

    # chọn skill không có trong khu chờ → lỗi, không ai được tạo
    with pytest.raises(ValueError):
        agency.hiring.approve(h["id"], [{**c, "install_skills": ["khong-co"]}])
    assert not hired.load()

    edited = {**c, "install_skills": ["seo-workflow"], "existing_skills": ["shared-skill"],
              "skill": {**c["skill"], "content_markdown": "# Bản Sếp sửa"}}
    agency.hiring.approve(h["id"], [edited])
    assert hired.get("seo_writer")
    kd = tmp_path / "agents" / "seo_writer" / "knowledge"
    assert "Ngưỡng title 60" in (kd / "seo-on-page.md").read_text(encoding="utf-8")
    assert "developers.google.com" in (kd / "nguon-tham-khao.md").read_text(encoding="utf-8")
    assert "Bản Sếp sửa" in (tmp_path / "skills" / "seo-workflow" / "SKILL.md").read_text(encoding="utf-8")
    assert not (tmp_path / "skills" / "seo-audit").exists()      # không chọn → không cài
    assert skills_mod.load_assignments()["seo_writer"] == ["seo-workflow", "shared-skill"]
    assert not stage.exists()                                       # khu chờ đã dọn


def test_reject_clears_staging(tmp_dirs):
    agency, db = make_agency(tmp_dirs)

    class PM(FakeAgent):
        def run(self, instruction, submit, images=None):
            return AgentResult({"summary": "s", "candidates": [{
                **CAND, "sources": [], "knowledge": [], "existing_skills": [], "skill_downloads": [],
                "skill": {"name": "my-skill", "description": "d", "content_markdown": "# x"}}]}, 1)

    agency._agent_factory = lambda role, ctx, hooks: PM(role, ctx, hooks, {"qa": 1, "review": 1})
    h = agency.hiring.request("Cần người")
    _wait_hiring(agency, h["id"])
    assert (agency.hiring.staging_root / h["id"]).is_dir()
    agency.hiring.reject(h["id"])
    assert not (agency.hiring.staging_root / h["id"]).exists()
