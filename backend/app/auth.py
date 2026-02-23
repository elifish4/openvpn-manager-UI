import sqlite3
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from .config import settings

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

DB_PATH = os.path.join(settings.data_dir, "users.db")


class UserOut(BaseModel):
    username: str
    role: str
    created_at: str


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class UpdateUserRequest(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None


def _get_db() -> sqlite3.Connection:
    os.makedirs(settings.data_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def init_admin_user():
    """Ensure the admin user from env/secret exists in the DB."""
    db = _get_db()
    row = db.execute("SELECT username FROM users WHERE username = ?", (settings.admin_username,)).fetchone()
    if not row:
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
            (settings.admin_username, pwd_context.hash(settings.admin_password), "admin", now),
        )
        db.commit()
        logger.info(f"Admin user '{settings.admin_username}' created from secret")
    else:
        db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ? AND role = 'admin'",
            (pwd_context.hash(settings.admin_password), settings.admin_username),
        )
        db.commit()
    db.close()


def authenticate_user(username: str, password: str) -> Optional[dict]:
    db = _get_db()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    db.close()
    if not row or not pwd_context.verify(password, row["password_hash"]):
        return None
    return {"username": row["username"], "role": row["role"]}


def create_token(username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS)
    return jwt.encode({"sub": username, "role": role, "exp": expire}, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
        username = payload.get("sub")
        role = payload.get("role")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        return {"username": username, "role": role}
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def list_users() -> list[dict]:
    db = _get_db()
    rows = db.execute("SELECT username, role, created_at FROM users ORDER BY created_at").fetchall()
    db.close()
    return [dict(r) for r in rows]


def create_user(username: str, password: str, role: str) -> dict:
    db = _get_db()
    existing = db.execute("SELECT username FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        db.close()
        raise HTTPException(status_code=409, detail=f"User '{username}' already exists")
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
        (username, pwd_context.hash(password), role, now),
    )
    db.commit()
    db.close()
    return {"username": username, "role": role, "created_at": now}


def update_user(username: str, password: Optional[str] = None, role: Optional[str] = None) -> dict:
    db = _get_db()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    if password:
        db.execute("UPDATE users SET password_hash = ? WHERE username = ?", (pwd_context.hash(password), username))
    if role:
        db.execute("UPDATE users SET role = ? WHERE username = ?", (role, username))
    db.commit()
    updated = db.execute("SELECT username, role, created_at FROM users WHERE username = ?", (username,)).fetchone()
    db.close()
    return dict(updated)


def delete_user(username: str, current_user: str):
    if username == current_user:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    db = _get_db()
    row = db.execute("SELECT username FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    db.execute("DELETE FROM users WHERE username = ?", (username,))
    db.commit()
    db.close()
