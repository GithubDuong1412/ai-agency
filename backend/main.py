"""FastAPI: REST + SSE cho dashboard."""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import versions
from .agents import profiles
from .agents import skills as skills_mod
from .db import DB
from .events import EventBus
from .orchestrator import Agency, roster
from .settings import DATA_DIR, FRONTEND_DIST, get_config, has_api_key
from .tools.fs_tools import Sandbox, SandboxError

DEMO = os.environ.get("AGENCY_DEMO") == "1"

db = DB(DATA_DIR / "demo.db") if DEMO else DB()  # demo không lẫn vào dữ liệu thật
bus = EventBus(db)
agency = Agency(db, bus)
if DEMO:
    from .demo import demo_factory

    agency._agent_factory = lambda role, ctx, hooks: _demo_make(role, ctx, hooks)
    _demo_make = demo_factory()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.mark_interrupted()
    db.migrate_name_tokens()
    yield
    agency.preview.stop_all()


app = FastAPI(title="AI Web Agency", lifespan=lifespan)


class CommandIn(BaseModel):
    prompt: str


class FeedbackIn(BaseModel):
    feedback: str = ""


def _project_or_404(pid: str) -> dict:
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "Không tìm thấy dự án")
    return p


def _with_runtime(p: dict) -> dict:
    p = dict(p)
    p["running"] = agency.is_running(p["id"])
    p["preview_url"] = agency.preview.url(p["id"])
    return p


# ---------- info ----------
@app.get("/api/config")
def api_config():
    cfg = get_config()
    return {"agency_name": cfg.get("agency_name"), "owner_name": cfg.get("owner_name"),
            "agency_tagline": cfg.get("agency_tagline"), "owner_display": cfg.get("owner_display"),
            "roles": roster(), "has_api_key": has_api_key() or DEMO, "demo": DEMO, "limits": cfg["limits"]}


@app.get("/api/overview")
def api_overview():
    projects = [_with_runtime(p) for p in db.list_projects()]
    tasks = db.list_tasks()
    reports = db.list_reports()
    pending = [r for r in reports if r["status"] == "pending"]
    titles = {p["id"]: p["title"] for p in projects}
    for r in pending:
        r["project_title"] = titles.get(r["project_id"], "")
    return {
        "stats": {
            "staff": len(roster()),
            "running_projects": sum(1 for p in projects if p["running"]),
            "open_tasks": sum(1 for t in tasks if t["status"] not in ("done",)),
            "pending_reviews": len(pending),
            "cost_usd": round(sum(p["cost_usd"] for p in projects), 4),
        },
        "projects": projects,
        "tasks": tasks,
        "pending_reports": pending,
    }


# ---------- projects ----------
@app.post("/api/projects")
def create_project(body: CommandIn):
    if not body.prompt.strip():
        raise HTTPException(400, "Lệnh trống")
    return _with_runtime(agency.start_project(body.prompt.strip()))


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    p = _project_or_404(pid)
    return {"project": _with_runtime(p), "tasks": db.list_tasks(pid), "reports": db.list_reports(pid)}


@app.post("/api/projects/{pid}/stop")
def stop_project(pid: str):
    _project_or_404(pid)
    agency.stop(pid)
    return {"ok": True}


@app.post("/api/projects/{pid}/approve")
def approve_project(pid: str, body: FeedbackIn):
    _project_or_404(pid)
    agency.approve(pid, body.feedback)
    return {"ok": True}


@app.post("/api/projects/{pid}/revise")
def revise_project(pid: str, body: FeedbackIn):
    _project_or_404(pid)
    if not body.feedback.strip():
        raise HTTPException(400, "Hãy ghi góp ý cần sửa")
    try:
        agency.revise(pid, body.feedback.strip())
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.post("/api/projects/{pid}/resume")
def resume_project(pid: str, body: FeedbackIn):
    """Chạy lại dự án đã dừng/lỗi/gián đoạn."""
    p = _project_or_404(pid)
    try:
        agency.revise(pid, body.feedback.strip() or "Tiếp tục hoàn thành dự án theo spec hiện có.") \
            if p["run_count"] else agency._spawn(pid, None)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.post("/api/projects/{pid}/preview")
def start_preview(pid: str):
    _project_or_404(pid)
    if not agency.workspace(pid).exists():
        raise HTTPException(400, "Workspace chưa được tạo")
    return {"url": agency.ensure_preview(pid)}


# ---------- files ----------
@app.get("/api/projects/{pid}/files")
def list_files(pid: str):
    _project_or_404(pid)
    ws = agency.workspace(pid)
    if not ws.exists():
        return {"files": []}
    skip = ("vendor/", "node_modules/", "storage/", ".agency/", "bootstrap/cache/", ".git/")
    files = []
    for f in ws.rglob("*"):
        if f.is_file():
            rel = f.relative_to(ws).as_posix()
            if rel.startswith(skip):
                continue
            files.append({"path": rel, "size": f.stat().st_size, "mtime": f.stat().st_mtime})
    files.sort(key=lambda x: x["path"])
    return {"files": files}


@app.get("/api/projects/{pid}/file")
def read_file(pid: str, path: str):
    _project_or_404(pid)
    try:
        text = Sandbox(agency.workspace(pid)).read_file(path)
    except SandboxError as e:
        raise HTTPException(400, str(e))
    return {"path": path, "content": text}


@app.get("/api/projects/{pid}/screenshots/{name}")
def screenshot(pid: str, name: str):
    _project_or_404(pid)
    if "/" in name or "\\" in name or ".." in name or not name.endswith(".png"):
        raise HTTPException(400, "Tên file không hợp lệ")
    f = agency.workspace(pid) / ".agency" / "screenshots" / name
    if not f.is_file():
        raise HTTPException(404, "Không có ảnh")
    return FileResponse(f, media_type="image/png")


# ---------- lịch sử phiên bản (git trong workspace) ----------
def _version_call(fn, *args):
    try:
        return fn(*args)
    except versions.VersionError as e:
        raise HTTPException(400, str(e))


@app.get("/api/projects/{pid}/versions")
def list_versions(pid: str):
    _project_or_404(pid)
    ws = agency.workspace(pid)
    if not ws.exists():
        return {"available": versions.available(), "versions": []}
    if agency.is_running(pid):  # không init repo khi agent đang ghi file
        if not (ws / ".git").exists():
            return {"available": versions.available(), "versions": []}
    return {"available": versions.available(), "versions": _version_call(versions.list_versions, ws)}


@app.get("/api/projects/{pid}/versions/{sha}/diff")
def version_diff(pid: str, sha: str):
    _project_or_404(pid)
    return {"files": _version_call(versions.diff, agency.workspace(pid), sha)}


@app.post("/api/projects/{pid}/versions/{sha}/restore")
def version_restore(pid: str, sha: str):
    _project_or_404(pid)
    if agency.is_running(pid):
        raise HTTPException(409, "Dự án đang chạy, hãy dừng trước khi quay về phiên bản cũ.")
    ws = agency.workspace(pid)
    match = next((v for v in _version_call(versions.list_versions, ws, 500) if v["sha"].startswith(sha)), None)
    if not match:
        raise HTTPException(404, "Không tìm thấy phiên bản")
    agency.preview.stop(pid)  # Windows: server PHP giữ khoá file SQLite
    label = f"Quay về: {match['title']}"
    new = _version_call(versions.restore, ws, match["sha"], label)
    bus.publish(pid, "message", "owner", to="all", kind="note",
                text=f"Sếp đã quay code về phiên bản “{match['title']}”. Vòng sau làm tiếp từ đây.")
    return {"ok": True, "sha": new}


# ---------- hồ sơ chuyên môn của agent ----------
def _profile_scopes() -> list[str]:
    from .agents.roles import ROLES
    return list(ROLES)


def _profile_call(fn, *args):
    try:
        return fn(*args)
    except profiles.ProfileError as e:
        raise HTTPException(400, str(e))


class ProfileFileIn(BaseModel):
    path: str
    content: str


@app.get("/api/profiles")
def list_profiles():
    roles = {r["key"]: r for r in roster()}
    out = [{"key": profiles.TEAM, "name": "Luật chung", "title": "Áp dụng cho cả đội", "color": "#94a3b8",
            "files": profiles.list_files(profiles.TEAM, _profile_scopes())}]
    for key in _profile_scopes():
        r = roles[key]
        out.append({"key": key, "name": r["name"], "title": r["title"], "color": r["color"],
                    "files": profiles.list_files(key, _profile_scopes()),
                    "skills": skills_mod.load_assignments().get(key, [])})
    return out


@app.get("/api/profiles/{scope}/file")
def get_profile_file(scope: str, path: str):
    return {"path": path, "content": _profile_call(profiles.read_file, scope, path, _profile_scopes())}


@app.put("/api/profiles/{scope}/file")
def put_profile_file(scope: str, body: ProfileFileIn):
    _profile_call(profiles.write_file, scope, body.path, body.content, _profile_scopes())
    return {"ok": True}


@app.delete("/api/profiles/{scope}/file")
def delete_profile_file(scope: str, path: str):
    _profile_call(profiles.delete_file, scope, path, _profile_scopes())
    return {"ok": True}


# ---------- skill ----------
def _skill_call(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except skills_mod.SkillError as e:
        raise HTTPException(400, str(e))


class SkillAssignIn(BaseModel):
    skills: list[str]


class SkillInstallIn(BaseModel):
    name: str | None = None      # cài từ ~/.claude/skills/<name>
    path: str | None = None      # hoặc cài từ một thư mục bất kỳ có SKILL.md
    overwrite: bool = False


@app.get("/api/skills")
def list_skills():
    assigned = skills_mod.load_assignments()
    agency_names = {s.name for s in skills_mod.list_skills() if s.source == "agency"}
    out = []
    for s in skills_mod.list_skills():
        d = s.to_dict()
        d["assigned_to"] = [r for r, names in assigned.items() if s.name in names]
        d["installed"] = s.name in agency_names
        out.append(d)
    # skill trên máy trùng tên với bản đã cài vào agency (để gợi ý cập nhật)
    machine = {p.name for p in skills_mod.MACHINE_SKILLS_DIR.iterdir()
               if (p / "SKILL.md").is_file()} if skills_mod.MACHINE_SKILLS_DIR.is_dir() else set()
    for d in out:
        d["on_machine"] = d["name"] in machine
    return {"skills": out, "assignments": assigned, "agency_dir": str(skills_mod.AGENCY_SKILLS_DIR),
            "machine_dir": str(skills_mod.MACHINE_SKILLS_DIR)}


@app.get("/api/skills/{name}/doc")
def skill_doc(name: str):
    s = _skill_call(skills_mod.get_skill, name)
    return {"name": name, "content": (s.path / "SKILL.md").read_text(encoding="utf-8", errors="replace")}


@app.post("/api/skills/install")
def install_skill(body: SkillInstallIn):
    if body.path:
        src = Path(body.path)
    elif body.name:
        src = skills_mod.MACHINE_SKILLS_DIR / body.name
    else:
        raise HTTPException(400, "Cần name (skill trên máy) hoặc path (thư mục có SKILL.md).")
    s = _skill_call(skills_mod.install, src, None, body.overwrite)
    return s.to_dict()


@app.delete("/api/skills/{name}")
def uninstall_skill(name: str):
    _skill_call(skills_mod.uninstall, name)
    return {"ok": True}


@app.put("/api/profiles/{role}/skills")
def assign_skills(role: str, body: SkillAssignIn):
    return {"skills": _skill_call(skills_mod.save_assignment, role, body.skills, _profile_scopes())}


@app.get("/api/profiles/{role}/prompt")
def preview_prompt(role: str):
    """System prompt đầy đủ mà agent sẽ nhận (để Sếp kiểm tra luật đã vào đúng chưa)."""
    if role not in _profile_scopes():
        raise HTTPException(404, "Không có vai trò này")
    from .agents.base import build_system
    text = build_system(role)
    return {"role": role, "prompt": text, "chars": len(text)}


# ---------- events (SSE) ----------
@app.get("/api/events/history")
def events_history(project_id: str | None = None, after: int = 0, limit: int = Query(300, le=2000)):
    return db.list_events(project_id, after, limit)


@app.get("/api/events")
async def events(project_id: str | None = None, after: int = 0):
    async def gen():
        sub = bus.subscribe()
        try:
            last = after
            # gửi bù các sự kiện bị lỡ
            for ev in db.list_events(project_id, after, 2000) if after else []:
                last = ev["id"]
                yield f"id: {ev['id']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(sub[1].get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if ev["id"] <= last or (project_id and ev["project_id"] != project_id):
                    continue
                last = ev["id"]
                yield f"id: {ev['id']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
        finally:
            bus.unsubscribe(sub)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- frontend build ----------
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = FRONTEND_DIST / full_path
        if full_path and f.is_file() and FRONTEND_DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(Path(FRONTEND_DIST) / "index.html")
