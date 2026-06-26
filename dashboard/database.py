import sqlite3
import os
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", "calls.db")


def init_db() -> None:
    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS calls (
                id              TEXT PRIMARY KEY,
                agent           TEXT NOT NULL,
                caller_number   TEXT DEFAULT '',
                started_at      TEXT NOT NULL,
                ended_at        TEXT,
                duration_sec    INTEGER,
                status          TEXT NOT NULL DEFAULT 'active'
            );

            CREATE TABLE IF NOT EXISTS leads (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                call_id             TEXT NOT NULL,
                agent               TEXT NOT NULL,
                caller_name         TEXT DEFAULT '',
                caller_phone        TEXT DEFAULT '',
                legal_matter        TEXT DEFAULT '',
                preferred_datetime  TEXT DEFAULT '',
                is_urgent           INTEGER DEFAULT 0,
                problem_details     TEXT DEFAULT '',
                webhook_fired       INTEGER DEFAULT 0,
                created_at          TEXT NOT NULL
            );
        """)


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def insert_call(call_id: str, agent: str, caller_number: str, started_at: str) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO calls (id, agent, caller_number, started_at, status) VALUES (?,?,?,?,?)",
            (call_id, agent, caller_number, started_at, "active"),
        )


def close_call(call_id: str, ended_at: str, duration_sec: int) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE calls SET ended_at=?, duration_sec=?, status='completed' WHERE id=?",
            (ended_at, duration_sec, call_id),
        )


def insert_lead(
    call_id: str,
    agent: str,
    caller_name: str,
    caller_phone: str,
    created_at: str,
    legal_matter: str = "",
    preferred_datetime: str = "",
    is_urgent: bool = False,
    problem_details: str = "",
    webhook_fired: bool = False,
) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO leads
               (call_id, agent, caller_name, caller_phone, legal_matter,
                preferred_datetime, is_urgent, problem_details, webhook_fired, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (call_id, agent, caller_name, caller_phone, legal_matter,
             preferred_datetime, int(is_urgent), problem_details, int(webhook_fired), created_at),
        )


def get_active_calls() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM calls WHERE status='active' ORDER BY started_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_recent_calls(limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM calls ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_recent_leads(limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM leads ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_stats_today(today_prefix: str) -> dict:
    with _conn() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM calls WHERE started_at LIKE ?", (f"{today_prefix}%",)
        ).fetchone()[0]

        avg_dur = conn.execute(
            "SELECT AVG(duration_sec) FROM calls WHERE started_at LIKE ? AND duration_sec IS NOT NULL",
            (f"{today_prefix}%",),
        ).fetchone()[0]

        booked = conn.execute(
            "SELECT COUNT(*) FROM leads WHERE created_at LIKE ?", (f"{today_prefix}%",)
        ).fetchone()[0]

        urgent = conn.execute(
            "SELECT COUNT(*) FROM leads WHERE created_at LIKE ? AND is_urgent=1",
            (f"{today_prefix}%",),
        ).fetchone()[0]

    return {
        "calls_today": total,
        "avg_duration_sec": round(avg_dur or 0),
        "consultations_booked": booked,
        "urgent_matters": urgent,
    }
