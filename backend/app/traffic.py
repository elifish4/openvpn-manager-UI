import sqlite3
import os
import logging
from datetime import datetime, timezone, timedelta

from .config import settings

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(settings.data_dir, "traffic.db")

_last_snapshot: dict[tuple[int, str], dict] = {}


def _get_db() -> sqlite3.Connection:
    os.makedirs(settings.data_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS traffic_deltas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            client_name TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            bytes_in INTEGER NOT NULL,
            bytes_out INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_traffic_ts
        ON traffic_deltas (server_id, client_name, timestamp)
    """)
    conn.commit()
    return conn


def record_snapshot(server_id: int, connected_clients: dict[str, dict]):
    """Compare current bytes with previous snapshot and store deltas.

    connected_clients is the dict returned by SSHManager.get_connected_with_traffic():
        { "client_name": {"bytes_received": int, "bytes_sent": int, ...} }
    """
    now = datetime.now(timezone.utc).isoformat()
    db = _get_db()

    for client_name, info in connected_clients.items():
        cur_in = info.get("bytes_received", 0)
        cur_out = info.get("bytes_sent", 0)
        key = (server_id, client_name)

        prev = _last_snapshot.get(key)
        if prev is not None:
            delta_in = cur_in - prev["bytes_in"]
            delta_out = cur_out - prev["bytes_out"]
            if delta_in < 0 or delta_out < 0:
                delta_in = cur_in
                delta_out = cur_out
        else:
            delta_in = cur_in
            delta_out = cur_out

        if delta_in > 0 or delta_out > 0:
            db.execute(
                "INSERT INTO traffic_deltas (server_id, client_name, timestamp, bytes_in, bytes_out) "
                "VALUES (?, ?, ?, ?, ?)",
                (server_id, client_name, now, delta_in, delta_out),
            )

        _last_snapshot[key] = {"bytes_in": cur_in, "bytes_out": cur_out}

    stale = [k for k in _last_snapshot if k[0] == server_id and k[1] not in connected_clients]
    for k in stale:
        del _last_snapshot[k]

    db.commit()
    db.close()


def get_traffic(server_id: int, days: int = 30) -> list[dict]:
    """Return aggregated traffic per client for the given period."""
    db = _get_db()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = db.execute(
        "SELECT client_name, SUM(bytes_in) as total_in, SUM(bytes_out) as total_out "
        "FROM traffic_deltas WHERE server_id = ? AND timestamp >= ? "
        "GROUP BY client_name ORDER BY total_in + total_out DESC",
        (server_id, since),
    ).fetchall()
    db.close()
    return [{"client_name": r["client_name"], "bytes_in": r["total_in"], "bytes_out": r["total_out"]} for r in rows]


def get_server_totals(server_id: int, days: int = 30) -> dict:
    """Return total traffic across all clients for the given period."""
    db = _get_db()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    row = db.execute(
        "SELECT COALESCE(SUM(bytes_in), 0) as total_in, COALESCE(SUM(bytes_out), 0) as total_out "
        "FROM traffic_deltas WHERE server_id = ? AND timestamp >= ?",
        (server_id, since),
    ).fetchone()
    db.close()
    return {"bytes_in": row["total_in"], "bytes_out": row["total_out"]}
