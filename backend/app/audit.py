import sqlite3
import os
from datetime import datetime, timezone

from .config import settings

DB_PATH = os.path.join(settings.data_dir, "users.db")


def _get_db() -> sqlite3.Connection:
    os.makedirs(settings.data_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            username TEXT NOT NULL,
            action TEXT NOT NULL,
            server_name TEXT,
            client_name TEXT,
            details TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS client_metadata (
            client_name TEXT NOT NULL,
            server_id INTEGER NOT NULL,
            email TEXT,
            first_name TEXT,
            last_name TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (client_name, server_id)
        )
    """)
    conn.commit()
    return conn


def record(username: str, action: str, server_name: str | None = None,
           client_name: str | None = None, details: str | None = None):
    db = _get_db()
    db.execute(
        "INSERT INTO audit_log (timestamp, username, action, server_name, client_name, details) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), username, action, server_name, client_name, details),
    )
    db.commit()
    db.close()


def get_logs(limit: int = 200, offset: int = 0, action: str | None = None) -> list[dict]:
    db = _get_db()
    query = "SELECT * FROM audit_log"
    params: list = []
    if action:
        query += " WHERE action = ?"
        params.append(action)
    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = db.execute(query, params).fetchall()
    db.close()
    return [dict(r) for r in rows]


def count_logs(action: str | None = None) -> int:
    db = _get_db()
    query = "SELECT COUNT(*) as cnt FROM audit_log"
    params: list = []
    if action:
        query += " WHERE action = ?"
        params.append(action)
    row = db.execute(query, params).fetchone()
    db.close()
    return row["cnt"]


# --- Client metadata ---

def save_client_metadata(client_name: str, server_id: int, email: str,
                         first_name: str, last_name: str):
    db = _get_db()
    db.execute(
        "INSERT OR REPLACE INTO client_metadata "
        "(client_name, server_id, email, first_name, last_name, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (client_name, server_id, email, first_name, last_name,
         datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    db.close()


def get_client_metadata_map(server_id: int) -> dict[str, dict]:
    db = _get_db()
    rows = db.execute(
        "SELECT client_name, email, first_name, last_name FROM client_metadata WHERE server_id = ?",
        (server_id,),
    ).fetchall()
    db.close()
    return {r["client_name"]: dict(r) for r in rows}
