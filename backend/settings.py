"""Đọc config.yaml và .env, cung cấp đường dẫn dùng chung."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
WORKSPACES_DIR = ROOT / "workspaces"
DATA_DIR = ROOT / "data"
SKELETON_DIR = BACKEND_DIR / "templates" / "laravel-skeleton"
FRONTEND_DIST = ROOT / "frontend" / "dist"
AGENTS_DIR = ROOT / "agents"   # hồ sơ chuyên môn: luật, checklist, kiến thức của từng agent

load_dotenv(ROOT / ".env")


@lru_cache
def get_config() -> dict:
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    cfg.setdefault("limits", {})
    cfg.setdefault("roles", {})
    cfg.setdefault("pricing", {})
    return cfg


def role_config(role: str) -> dict:
    cfg = get_config()
    r = dict(cfg["roles"].get(role, {}))
    r.setdefault("model", cfg.get("default_model", "claude-opus-5-5"))
    r.setdefault("effort", cfg.get("default_effort", "medium"))
    r.setdefault("name", role)
    r.setdefault("title", role)
    r.setdefault("department", "Khác")
    r.setdefault("color", "#64748b")
    return r


def has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
