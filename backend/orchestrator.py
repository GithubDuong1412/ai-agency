"""Điều phối: Trưởng dự án → Designer → (Dev ⇄ QA) → Kiểm duyệt → Báo cáo cho Sếp."""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from . import attachments, versions
from .agents import profiles
from .agents import skills as skills_mod
from .agents.base import Agent, AgentCancelled, AgentError, AgentResult
from .agents.schemas import lesson_scopes
from .db import DB
from .events import EventBus
from .preview import PreviewManager
from .settings import AGENTS_DIR, SKELETON_DIR, WORKSPACES_DIR, get_config, has_api_key, role_config
from .tools.fs_tools import Sandbox
from .tools.registry import ToolContext
from .tools.shell_tools import CommandRunner

AgentFactory = Callable[[str, ToolContext, Any], Any]


def usage_cost(model: str, usage: Any) -> tuple[int, int, float]:
    """(token vào gồm cache, token ra, chi phí USD) của một lượt gọi model."""
    pricing = get_config().get("pricing", {})
    price = pricing.get(model) or pricing.get(get_config().get("default_model")) or {"input": 4, "output": 20}
    inp = int(getattr(usage, "input_tokens", 0) or 0)
    cw = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    cr = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    out = int(getattr(usage, "output_tokens", 0) or 0)
    cost = ((inp + cw * 1.25 + cr * 0.1) * price["input"] + out * price["output"]) / 1_000_000
    # web search (server tool) tính theo lượt: mặc định $10 / 1.000 lượt
    stu = getattr(usage, "server_tool_use", None)
    searches = int(getattr(stu, "web_search_requests", 0) or 0) if stu is not None else 0
    if searches:
        cost += searches * float(pricing.get("web_search_per_1k", 10)) / 1000
    return inp + cw + cr, out, cost


class _ProjectHooks:
    """Kết nối agent với event bus, DB (usage) và cờ dừng của một lần chạy."""

    def __init__(self, agency: "Agency", pid: str, stop: threading.Event):
        self.agency, self.pid, self.stop = agency, pid, stop
        self.run_tokens = 0
        self.budget = int(get_config()["limits"].get("token_budget", 4_000_000))

    def emit(self, type_: str, agent: str, **data: Any) -> None:
        self.agency.bus.publish(self.pid, type_, agent, **data)

    def add_usage(self, model: str, usage: Any) -> None:
        total_in, out, cost = usage_cost(model, usage)
        self.run_tokens += total_in + out
        self.agency.db.add_usage(self.pid, total_in, out, cost)
        p = self.agency.db.get_project(self.pid)
        self.agency.bus.publish(self.pid, "usage", None, input_tokens=p["input_tokens"],
                                output_tokens=p["output_tokens"], cost_usd=round(p["cost_usd"], 4))

    def should_stop(self) -> bool:
        return self.stop.is_set()

    def owner_notes(self) -> list[dict]:
        """Lời nhắn Sếp gửi chen ngang trong vòng này: [{text, images: [Path], delivered}] (thứ tự gửi)."""
        return list(self.agency._notes.get(self.pid, []))

    def over_budget(self) -> bool:
        return self.run_tokens > self.budget


class Agency:
    def __init__(self, db: DB, bus: EventBus, preview: PreviewManager | None = None,
                 agent_factory: AgentFactory | None = None, workspaces_dir: Path = WORKSPACES_DIR,
                 skeleton_dir: Path = SKELETON_DIR, agents_dir: Path = AGENTS_DIR):
        self.db, self.bus = db, bus
        self.agents_dir = agents_dir  # nơi ghi bài học (agents/<vai>/lessons.md)
        cfg = get_config()
        self.preview = preview or PreviewManager(cfg["php_bin"], int(cfg.get("preview_port_start", 8100)))
        self.workspaces_dir = workspaces_dir
        self.skeleton_dir = skeleton_dir
        self._agent_factory = agent_factory
        self._client = None
        self._threads: dict[str, threading.Thread] = {}
        self._notes: dict[str, list[dict]] = {}  # lời nhắn chen ngang của Sếp trong vòng đang chạy
        self._stops: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        from .hiring import HiringManager
        self.hiring = HiringManager(self)

    # ---------- public API ----------
    def is_running(self, pid: str) -> bool:
        t = self._threads.get(pid)
        return bool(t and t.is_alive())

    def start_project(self, prompt: str, images: list[tuple[bytes, str]] | None = None) -> dict:
        p = self.db.create_project(prompt)
        self.bus.publish(p["id"], "project_created", None, title=p["title"], prompt=prompt)
        names = self._attach(p["id"], images)
        self._spawn(p["id"], feedback=None, images=names)
        return self.db.get_project(p["id"])  # type: ignore[return-value]

    def revise(self, pid: str, feedback: str, images: list[tuple[bytes, str]] | None = None) -> None:
        if self.is_running(pid):
            raise RuntimeError("Dự án đang chạy.")
        for r in self.db.list_reports(pid):
            if r["status"] == "pending":
                self.db.update_report(r["id"], status="revision_requested", feedback=feedback)
        names = self._attach(pid, images)
        self.bus.publish(pid, "message", "owner", to="pm", text=feedback, kind="feedback", images=names)
        self._spawn(pid, feedback=feedback, images=names)

    def interject(self, pid: str, text: str, images: list[tuple[bytes, str]] | None = None) -> None:
        """Sếp nhắn chen ngang khi đội đang làm: agent đang chạy đọc ở bước kế tiếp, agent sau đọc khi bắt đầu."""
        if not self.is_running(pid):
            raise RuntimeError("Đội không còn làm việc. Hãy dùng Yêu cầu sửa để mở vòng mới.")
        names = self._attach(pid, images)
        ws = self.workspace(pid)
        self._notes.setdefault(pid, []).append({
            "text": text, "images": [ws / r for r in attachments.rel_paths(names)], "delivered": False})
        self.bus.publish(pid, "message", "owner", to="all", text=text, kind="interject", images=names)

    def approve(self, pid: str, note: str = "", images: list[tuple[bytes, str]] | None = None) -> None:
        for r in self.db.list_reports(pid):
            if r["status"] == "pending":
                self.db.update_report(r["id"], status="approved", feedback=note or None)
        self.db.update_project(pid, status="approved")
        self.bus.publish(pid, "project_status", None, status="approved")
        names = self._attach(pid, images)
        if note or names:
            self.bus.publish(pid, "message", "owner", to="all", text=note, kind="feedback", images=names)

    def stop(self, pid: str) -> None:
        ev = self._stops.get(pid)
        if ev:
            ev.set()

    def workspace(self, pid: str) -> Path:
        return self.workspaces_dir / pid

    def ensure_preview(self, pid: str) -> str:
        p = self.db.get_project(pid)
        url = self.preview.start(pid, self.workspace(pid), p.get("preview_port") if p else None)
        port = int(url.rsplit(":", 1)[1])
        if p and p.get("preview_port") != port:
            self.db.update_project(pid, preview_port=port)
        return url

    # ---------- internals ----------
    def _attach(self, pid: str, images: list[tuple[bytes, str]] | None) -> list[str]:
        """Lưu ảnh Sếp đính kèm vào workspace. Dự án mới chưa có workspace (chép khung Laravel mất vài giây):
        để tạm ở chỗ chờ, _run chuyển vào sau khi tạo workspace — để nút gửi không bị treo."""
        if not images:
            return []
        ws = self.workspace(pid)
        return attachments.save_attachments(ws if ws.exists() else self.incoming_dir(pid), images)

    def incoming_dir(self, pid: str) -> Path:
        return self.workspaces_dir / ".incoming" / pid

    def attachment_path(self, pid: str, name: str) -> Path:
        f = self.workspace(pid) / attachments.SUBDIR / name
        return f if f.is_file() else self.incoming_dir(pid) / attachments.SUBDIR / name

    def _spawn(self, pid: str, feedback: str | None, images: list[str] | None = None) -> None:
        with self._lock:
            if self.is_running(pid):
                raise RuntimeError("Dự án đang chạy.")
            stop = threading.Event()
            self._stops[pid] = stop
            self._notes[pid] = []
            t = threading.Thread(target=self._run_safe, args=(pid, feedback, stop, images or []), daemon=True,
                                 name=f"project-{pid}")
            self._threads[pid] = t
            self.db.update_project(pid, status="queued")
            t.start()

    def _get_client(self):
        if self._client is None:
            if not has_api_key():
                raise AgentError("Chưa có ANTHROPIC_API_KEY. Tạo key tại console.anthropic.com và ghi vào file .env.")
            import anthropic
            self._client = anthropic.Anthropic(max_retries=4)
        return self._client

    def _make_agent(self, role: str, ctx: ToolContext, hooks: _ProjectHooks):
        if self._agent_factory:
            return self._agent_factory(role, ctx, hooks)
        return Agent(role, self._get_client(), ctx, hooks)

    def _prepare_workspace(self, pid: str) -> Path:
        ws = self.workspace(pid)
        if not ws.exists():
            if not self.skeleton_dir.exists():
                raise AgentError("Chưa có Laravel skeleton ở backend/templates/laravel-skeleton "
                                 "(chạy: composer create-project laravel/laravel laravel-skeleton).")
            shutil.copytree(self.skeleton_dir, ws, ignore=shutil.ignore_patterns(".git", "node_modules"))
        (ws / ".agency" / "screenshots").mkdir(parents=True, exist_ok=True)
        return ws

    def _ctx(self, pid: str, role: str, ws: Path) -> ToolContext:
        cfg = get_config()
        return ToolContext(
            sandbox=Sandbox(ws),
            runner=CommandRunner(ws, cfg["php_bin"], cfg["composer_phar"], cfg.get("npm_bin", "npm"),
                                 int(cfg.get("command_timeout", 240))),
            screenshot_dir=ws / ".agency" / "screenshots",
            get_preview_url=lambda: self.ensure_preview(pid),
            post_message=lambda to, text: self.bus.publish(pid, "message", role, to=to, text=text, kind="chat"),
            on_file_changed=lambda path, action: self.bus.publish(pid, "file_changed", role, path=path,
                                                                  action=action),
            read_knowledge=lambda topic: profiles.read_knowledge(role, topic),
            use_skill=lambda name, file, offset: skills_mod.read_skill(role, name, file, offset),
            run_skill_script=lambda name, script, args: skills_mod.run_script(role, name, script, args, ws),
        )

    def _run_safe(self, pid: str, feedback: str | None, stop: threading.Event,
                  images: list[str] | None = None) -> None:
        try:
            self._run_and_report(pid, feedback, stop, images or [])
        except AgentCancelled:
            self._snapshot(pid, "dừng giữa chừng")
            self.db.update_project(pid, status="stopped")
            self.bus.publish(pid, "project_status", None, status="stopped")
        except Exception as e:  # noqa: BLE001
            msg = str(e) or type(e).__name__
            self._snapshot(pid, "lỗi giữa chừng")
            self.db.update_project(pid, status="failed", error=msg)
            self.bus.publish(pid, "project_status", None, status="failed", error=msg,
                             trace=traceback.format_exc()[-2000:])

    def _run_and_report(self, pid: str, feedback: str | None, stop: threading.Event, images: list[str]) -> None:
        try:
            self._run(pid, feedback, stop, images)
        finally:
            missed = [n for n in self._notes.get(pid, []) if not n["delivered"]]
            if missed:
                owner = get_config().get("owner_name", "Sếp")
                self.bus.publish(pid, "message", None, to="all", kind="note",
                                 text=f"{len(missed)} lời nhắn của {owner} đến lúc đội đã làm xong nên chưa ai đọc. "
                                      "Hãy gửi lại bằng Yêu cầu sửa nếu vẫn cần.")

    def _snapshot(self, pid: str, note: str) -> None:
        """Lưu phần việc dở dang của vòng hiện tại để không mất khi vòng sau ghi đè."""
        p = self.db.get_project(pid)
        ws = self.workspace(pid)
        if p and (ws / ".git").exists():
            versions.safe_commit(ws, f"Vòng {p['run_count']} ({note})", run_no=p["run_count"])

    # ---------- the pipeline ----------
    def _run(self, pid: str, feedback: str | None, stop: threading.Event,
             images: list[str] | None = None) -> None:
        cfg = get_config()
        limits = cfg["limits"]
        project = self.db.get_project(pid)
        run_no = project["run_count"] + 1
        self.db.update_project(pid, status="running", run_count=run_no, error=None)
        self.bus.publish(pid, "project_status", None, status="running", run_no=run_no)

        hooks = _ProjectHooks(self, pid, stop)
        ws = self._prepare_workspace(pid)
        incoming = self.incoming_dir(pid)
        if incoming.exists():  # ảnh đính kèm của dự án mới đang chờ workspace
            shutil.copytree(incoming, ws, dirs_exist_ok=True)
            shutil.rmtree(incoming, ignore_errors=True)
        run_started_ms = int(time.time() * 1000)  # ảnh chụp trước mốc này thuộc vòng cũ
        # Lịch sử phiên bản: lưu hiện trạng (kể cả chỉnh tay của Sếp) trước khi đội bắt đầu vòng mới
        try:
            if versions.ensure_repo(ws):
                versions.commit(ws, f"Chỉnh sửa ngoài trước vòng {run_no}")
        except versions.VersionError:
            pass
        agent = lambda role: self._make_agent(role, self._ctx(pid, role, ws), hooks)  # noqa: E731
        handoff = lambda f, t, note: self.bus.publish(pid, "handoff", f, to=t, note=note)  # noqa: E731
        owner = cfg.get("owner_name", "Sếp")
        # Ảnh Sếp đính kèm: PM và Designer nhận thẳng; người khác được báo đường dẫn để tự xem bằng view_image
        images = images or []
        img_kw = {"images": [ws / p for p in attachments.rel_paths(images)]} if images else {}
        img_note = (f"\n\n{owner} đính kèm {len(images)} ảnh (xem bằng tool view_image nếu liên quan tới "
                    "việc của bạn): " + ", ".join(attachments.rel_paths(images))) if images else ""

        # 1) Trưởng dự án lập kế hoạch
        prev = self.db.list_reports(pid)
        plan_instr = [f"Yêu cầu của {owner}:\n\"\"\"\n{project['prompt']}\n\"\"\""]
        if feedback:
            plan_instr.append(f"Đây là lần làm lại thứ {run_no}. Góp ý mới của {owner}:\n\"\"\"\n{feedback}\n\"\"\"")
            if prev:
                plan_instr.append("Báo cáo lần trước:\n" + prev[0]["content"].get("summary_markdown", "")[:6000])
            plan_instr.append("Spec cũ nằm ở SPEC.md. Hãy cập nhật spec và chỉ tạo task cho phần cần sửa/bổ sung.")
        plan_instr.append("Hãy xem nhanh cấu trúc dự án nếu cần, rồi gọi submit_plan.")
        if not feedback:  # góp ý đã được revise() đăng thành tin "Góp ý", không đăng lặp lần nữa
            self.bus.publish(pid, "message", "owner", to="pm", text=project["prompt"], kind="command",
                             **({"images": images} if images else {}))
        plan = agent("pm").run("\n\n".join(plan_instr), "submit_plan", **img_kw).data

        spec_md = (f"# {plan['project_title']}\n\n{plan['summary']}\n\n{plan['spec_markdown']}\n\n"
                   "## Tiêu chí chấp nhận\n" + "\n".join(f"- {c}" for c in plan["acceptance_criteria"]))
        (ws / "SPEC.md").write_text(spec_md, encoding="utf-8")
        self.db.update_project(pid, title=plan["project_title"][:80], spec=spec_md)
        self.bus.publish(pid, "plan", "pm", title=plan["project_title"], summary=plan["summary"],
                         tasks=[t["title"] for t in plan["tasks"]])
        # PM thấy thiếu chuyên môn: gửi đề xuất tuyển sang mục Tuyển dụng (Sếp duyệt), dự án vẫn chạy tiếp
        for sug in (plan.get("hiring_suggestions") or [])[:2]:
            need = str(sug.get("need", "")).strip()
            if need:
                try:
                    self.hiring.request(f"{need}\nLý do (từ dự án “{plan['project_title']}”): {sug.get('reason', '')}",
                                        source_project=pid)
                except Exception:  # noqa: BLE001 — đề xuất tuyển không được làm hỏng dự án
                    pass

        # 2) Designer
        handoff("pm", "designer", "Spec đã có trong SPEC.md, nhờ {@designer} lên thiết kế.")
        design_instr = ("Đọc SPEC.md rồi viết (hoặc cập nhật) DESIGN.md cho dự án."
                        + (f"\nGóp ý mới của {owner}: {feedback}" if feedback else "")
                        + (f"\n{owner} có đính kèm ảnh (ở trên)." if images else "")
                        + "\nXong gọi submit_design.")
        design = agent("designer").run(design_instr, "submit_design", **img_kw).data
        self.bus.publish(pid, "design", "designer", **design)

        # 3) Dev ⇄ QA cho từng task
        tasks = [self.db.create_task(pid, t["title"], t["description"], t["assignee"], "plan", run_no)
                 for t in plan["tasks"]]
        for t in tasks:
            self.bus.publish(pid, "task_update", "pm", task=t)
        log: list[dict] = []
        for t in tasks:
            log.append(self._dev_qa(pid, t, agent, handoff, int(limits.get("qa_rounds", 3)), img_note))

        # 4) Kiểm duyệt
        review: dict = {}
        review_found: list[str] = []  # mọi lỗi Kiểm duyệt nêu trong vòng (cho bước rút bài học)
        review_rounds = int(limits.get("review_rounds", 2))
        for r in range(review_rounds + 1):
            handoff("qa", "reviewer", "Các task đã qua QA, nhờ {@reviewer} kiểm duyệt tổng thể.")
            review = agent("reviewer").run(
                "Kiểm duyệt toàn bộ dự án theo SPEC.md (tiêu chí chấp nhận) và DESIGN.md. "
                f"Lượt kiểm duyệt {r + 1}/{review_rounds + 1}.\n"
                "Tóm tắt các task đã làm:\n" + json.dumps(log, ensure_ascii=False)[:8000]
                + img_note + "\n" + (SHOT_RULE_REVISE if run_no > 1 else SHOT_RULE_FIRST)
                + "\nXong gọi submit_review.", "submit_review").data
            self.bus.publish(pid, "review", "reviewer", **review, round=r + 1)
            review_found += [f"[{i['assignee']}] {i['title']}: {i['detail'][:200]}" for i in review["issues"]]
            if review["verdict"] == "approve" or not review["issues"] or r == review_rounds:
                break
            by_assignee: dict[str, list[dict]] = {}
            for iss in review["issues"]:
                by_assignee.setdefault(iss["assignee"], []).append(iss)
            for assignee, issues in by_assignee.items():
                desc = "Sửa các vấn đề Kiểm duyệt viên nêu:\n" + "\n".join(
                    f"- [{i['severity']}] {i['title']}: {i['detail']}" for i in issues)
                t = self.db.create_task(pid, f"Sửa theo kiểm duyệt (lượt {r + 1})", desc, assignee, "review", run_no)
                self.bus.publish(pid, "task_update", "reviewer", task=t)
                handoff("reviewer", assignee, f"Có {len(issues)} vấn đề cần sửa.")
                log.append(self._dev_qa(pid, t, agent, handoff, int(limits.get("qa_rounds", 3)), img_note))

        # 5) Báo cáo
        handoff("reviewer", "pm", "Kiểm duyệt xong, nhờ anh {@pm} tổng hợp báo cáo.")
        p = self.db.get_project(pid)
        preview_url = self.preview.url(pid)
        shots = run_screenshots(ws / ".agency" / "screenshots", run_started_ms)
        report_instr = (
            f"Viết báo cáo cuối cho {owner} bằng tiếng Việt, trung thực và dễ kiểm tra.\n"
            f"Dữ liệu:\n- Kế hoạch: {json.dumps(plan, ensure_ascii=False)[:5000]}\n"
            f"- Thiết kế: {json.dumps(design, ensure_ascii=False)[:2000]}\n"
            f"- Nhật ký task (Dev/QA): {json.dumps(log, ensure_ascii=False)[:8000]}\n"
            f"- Kết luận kiểm duyệt: {json.dumps(review, ensure_ascii=False)[:5000]}\n"
            f"- Link xem trước: {preview_url or 'chưa chạy'}\n"
            f"- Token đã dùng: {p['input_tokens']} vào / {p['output_tokens']} ra, ~${p['cost_usd']:.2f}\n"
            "Trong how_to_check, ghi các bước cụ thể để Sếp tự kiểm tra (trang nào, thao tác gì). "
            "Gọi submit_report."
        )
        report = agent("pm").run(report_instr, "submit_report").data
        report.update({
            "verdict": review.get("verdict"), "score": review.get("score"),
            "review_summary": review.get("summary"), "open_issues": review.get("issues", []),
            "tasks": log, "preview_url": preview_url, "screenshots": shots, "run_no": run_no,
            "cost_usd": round(self.db.get_project(pid)["cost_usd"], 4),
        })
        report["commit"] = versions.safe_commit(ws, f"Vòng {run_no}: {report.get('headline', '')}",
                                                run_no=run_no, allow_empty=True)
        rep = self.db.create_report(pid, run_no, report)
        self.bus.publish(pid, "report", "pm", report_id=rep["id"], headline=report["headline"])
        self._learn(pid, agent, p["title"], feedback, log, review_found)
        self.db.update_project(pid, status="awaiting_approval")
        self.bus.publish(pid, "project_status", None, status="awaiting_approval")

    def _learn(self, pid: str, agent, title: str, feedback: str | None, log: list[dict],
               review_found: list[str]) -> None:
        """Trưởng dự án rút 0–3 bài học chung từ lỗi QA/Kiểm duyệt bắt được và góp ý của Sếp, ghi vào
        agents/<vai>/lessons.md để các dự án sau không lặp lại. Không bao giờ làm hỏng vòng chạy."""
        if not get_config().get("learn_lessons", True):
            return
        qa_found = [x for e in log for x in e.get("qa_found", [])]
        if not (qa_found or review_found or feedback):
            return  # vòng trơn tru, không có gì để học
        owner = get_config().get("owner_name", "Sếp")
        existing = {sc: profiles.lessons_of(sc if sc != "team" else profiles.TEAM, self.agents_dir)
                    for sc in lesson_scopes()}
        known = "\n".join(f"[{sc}] {ln}" for sc, lines in existing.items() for ln in lines) or "(chưa có)"
        instr = (
            "Vòng làm việc vừa xong. Hãy rút ra tối đa 3 BÀI HỌC để đội không lặp lại lỗi ở các dự án SAU.\n"
            "Chỉ ghi bài học chung, áp dụng được cho dự án khác (vd. 'Viết test bằng PHPUnit dạng class, không dùng "
            "Pest'), KHÔNG ghi việc riêng của dự án này (vd. 'nút Đặt bàn phải màu đỏ'). Mỗi bài một câu mệnh lệnh "
            "ngắn, gắn đúng vai cần nhớ ('team' nếu cả đội). Bỏ qua lỗi vặt, lỗi đã có trong bài học cũ. "
            "Không có gì đáng học thì nộp danh sách rỗng.\n\n"
            f"Lỗi QA bắt được:\n" + ("\n".join(f"- {x}" for x in qa_found[:30]) or "(không)") + "\n\n"
            f"Lỗi Kiểm duyệt nêu:\n" + ("\n".join(f"- {x}" for x in review_found[:30]) or "(không)") + "\n\n"
            f"Góp ý/yêu cầu sửa của {owner} vòng này:\n" + (feedback or "(không)")[:3000] + "\n\n"
            f"Bài học đã có (đừng lặp lại):\n{known[:6000]}\n\nKhông cần đọc file. Gọi submit_lessons."
        )
        try:
            items = agent("pm").run(instr, "submit_lessons").data.get("lessons", [])[:3]
            added = []
            for it in items:
                scope = profiles.TEAM if it.get("role") == "team" else it.get("role")
                added += [(it.get("role"), ln) for ln in
                          profiles.append_lessons(scope, [it.get("text", "")], title, self.agents_dir)]
            if added:
                self.bus.publish(pid, "message", "pm", to="all", kind="lessons",
                                 text="\n".join(f"• [{r}] {re.sub(r' _[(].*[)]_$', '', ln.removeprefix('- '))}"
                                                for r, ln in added))
        except AgentCancelled:
            raise
        except Exception as e:  # noqa: BLE001
            self.bus.publish(pid, "message", None, to="all", kind="note", text=f"Không rút được bài học: {e}"[:300])

    def _dev_qa(self, pid: str, task: dict, agent, handoff, qa_rounds: int, img_note: str = "") -> dict:
        dev_role = task["assignee"]
        feedback: list[dict] | None = None
        entry = {"task": task["title"], "assignee": dev_role, "attempts": 0, "passed": False}
        for attempt in range(1, qa_rounds + 1):
            self.db.update_task(task["id"], status="in_progress", attempts=attempt)
            self.bus.publish(pid, "task_update", dev_role, task={**task, "status": "in_progress",
                                                                  "attempts": attempt})
            instr = (f"Task: {task['title']}\n\n{task['description']}\n\n"
                     "Đọc SPEC.md, DESIGN.md và code hiện có trước khi làm." + img_note)
            if feedback:
                instr += ("\n\nQA báo các lỗi sau ở lần trước, hãy sửa hết:\n"
                          + "\n".join(f"- [{i['severity']}] {i['title']}: {i['detail']}" for i in feedback))
            instr += "\nXong gọi submit_work."
            work = agent(dev_role).run(instr, "submit_work").data

            self.db.update_task(task["id"], status="testing")
            self.bus.publish(pid, "task_update", "qa", task={**task, "status": "testing", "attempts": attempt})
            handoff(dev_role, "qa", work.get("notes_for_qa") or "Đã xong, nhờ QA kiểm tra.")
            qa = agent("qa").run(
                f"Kiểm tra task: {task['title']}\n\n{task['description']}\n\n"
                f"Dev báo cáo: {work['summary']}\nFile thay đổi: {', '.join(work['files_changed'])}\n"
                f"Ghi chú cho QA: {work['notes_for_qa']}\n{SHOT_RULE_QA}\nXong gọi submit_qa.", "submit_qa").data
            entry.update(attempts=attempt, work=work["summary"], qa=qa["summary"], passed=qa["passed"],
                         issues=[i["title"] for i in qa["issues"]])
            if qa["passed"]:
                self.db.update_task(task["id"], status="done")
                self.bus.publish(pid, "task_update", "qa", task={**task, "status": "done", "attempts": attempt})
                return entry
            feedback = qa["issues"] or [{"title": "QA chưa đạt", "detail": qa["summary"], "severity": "medium",
                                         "assignee": dev_role}]
            entry.setdefault("qa_found", []).extend(
                f"[{i.get('assignee', dev_role)}] {i['title']}: {i['detail'][:200]}" for i in feedback)
            handoff("qa", dev_role, f"Chưa đạt: {len(feedback)} lỗi cần sửa.")
        self.db.update_task(task["id"], status="needs_attention")
        self.bus.publish(pid, "task_update", "qa", task={**task, "status": "needs_attention"})
        return entry


# Ảnh chụp hiện trong báo cáo cho Sếp: chỉ chụp cái thay đổi, không chụp lại trang cũ y hệt các vòng trước
_SHOT_LOGIN = ("Trang cần đăng nhập (vd. /admin): truyền login_path, login_email, login_password (tài khoản mẫu "
               "trong database/seeders) cho tool screenshot; ảnh vẫn là trang đăng nhập hoặc báo 'đăng nhập: thất bại' "
               "thì không chụp lại nhiều lần, ghi rõ 'chưa xem bằng mắt' và kiểm bằng feature test.")
SHOT_RULE_QA = ("Ảnh chụp: chỉ chụp trang có giao diện bị ảnh hưởng bởi các file thay đổi ở trên (view, layout, CSS), "
                "mỗi trang desktop + mobile, không chụp lại cùng một trang nhiều lần. Task không đổi giao diện "
                "(chỉ route/model/test) thì không chụp. " + _SHOT_LOGIN)
SHOT_RULE_FIRST = "Ảnh chụp: chụp các trang chính (desktop + mobile), mỗi trang một lần. " + _SHOT_LOGIN
SHOT_RULE_REVISE = ("Đây là vòng sửa theo góp ý: chỉ chụp các trang có giao diện thay đổi trong vòng này "
                    "(xem file thay đổi trong nhật ký task), mỗi trang desktop + mobile; trang không đổi thì không "
                    "chụp lại. Vòng này không đổi giao diện thì không chụp. " + _SHOT_LOGIN)


def run_screenshots(shot_dir: Path, since_ms: int, limit: int = 8) -> list[str]:
    """Ảnh chụp của vòng hiện tại: chỉ ảnh chụp sau since_ms; mỗi trang + khung (vd. home_mobile) giữ ảnh mới nhất.

    Tên file dạng '<ms>_<trang>_<desktop|mobile>.png' (browser_tools.take_screenshot).
    """
    latest: dict[str, tuple[int, str]] = {}
    for f in shot_dir.glob("*.png"):
        ts, _, key = f.stem.partition("_")
        if not ts.isdigit() or int(ts) < since_ms:
            continue
        if key not in latest or int(ts) > latest[key][0]:
            latest[key] = (int(ts), f.name)
    return [name for _, name in sorted(latest.values())][-limit:]


def roster() -> list[dict]:
    from .agents import hired as hired_mod
    from .agents.roles import all_roles
    hired = hired_mod.load()
    out = []
    for key in all_roles():
        r = role_config(key)
        item = {"key": key, "name": r["name"], "title": r["title"], "department": r["department"],
                "color": r["color"], "model": r["model"], "effort": r["effort"], "hired": key in hired}
        if key in hired:
            h = hired[key]
            item.update(permissions=h.get("permissions", []), working_style=h.get("working_style", ""),
                        hired_at=h.get("hired_at"), assignable=hired_mod.can_take_tasks(h))
        out.append(item)
    return out
