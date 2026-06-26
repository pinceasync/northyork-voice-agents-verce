from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from dashboard.database import (
    init_db,
    get_active_calls,
    get_recent_calls,
    get_recent_leads,
    get_stats_today,
    insert_call,
    close_call,
    insert_lead,
)

app = FastAPI(title="North York Voice Agents — Dashboard")

FRONTEND = Path(__file__).parent / "frontend"


@app.on_event("startup")
async def startup():
    init_db()


# ── Internal API (called by agent.py) ────────────────────────────────────────

@app.post("/internal/call/start")
async def call_start(data: dict):
    insert_call(
        call_id=data["call_id"],
        agent=data.get("agent", "unknown"),
        caller_number=data.get("caller_number", ""),
        started_at=_now(),
    )
    return {"ok": True}


@app.post("/internal/call/end")
async def call_end(data: dict):
    close_call(
        call_id=data["call_id"],
        ended_at=_now(),
        duration_sec=data.get("duration_sec", 0),
    )
    return {"ok": True}


@app.post("/internal/lead")
async def lead_captured(data: dict):
    insert_lead(
        call_id=data["call_id"],
        agent=data.get("agent", "unknown"),
        caller_name=data.get("caller_name", ""),
        caller_phone=data.get("caller_phone", ""),
        legal_matter=data.get("legal_matter", ""),
        preferred_datetime=data.get("preferred_datetime", ""),
        is_urgent=data.get("is_urgent", False),
        problem_details=data.get("problem_details", ""),
        webhook_fired=data.get("webhook_fired", False),
        created_at=_now(),
    )
    return {"ok": True}


# ── Dashboard API ─────────────────────────────────────────────────────────────

@app.get("/api/active")
async def active_calls():
    return get_active_calls()


@app.get("/api/calls")
async def recent_calls(limit: int = 50):
    return get_recent_calls(limit)


@app.get("/api/leads")
async def recent_leads(limit: int = 50):
    return get_recent_leads(limit)


@app.get("/api/stats")
async def stats():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return get_stats_today(today)


# ── Serve frontend ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=FRONTEND / "static"), name="static")


@app.get("/")
async def root():
    return FileResponse(FRONTEND / "index.html")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
