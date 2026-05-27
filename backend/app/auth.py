import sqlite3
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from .config import settings

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

security = HTTPBearer()

DB_PATH = os.path.join(settings.data_dir, "users.db")

VALID_ROLES = {"admin", "viewer"}


class UserOut(BaseModel):
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    role: str
    created_at: str
    last_login: Optional[str] = None


class GoogleLoginRequest(BaseModel):
    credential: str  # ID token JWT from Google Sign-In


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None


def _get_db() -> sqlite3.Connection:
    os.makedirs(settings.data_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # If a legacy `users` table exists (password-based schema), drop it so we can
    # rebuild with the SSO schema. The previous admin user will be re-created
    # automatically as the first SSO user (and inherits the admin role).
    legacy = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).fetchone()
    if legacy:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)")]
        if "email" not in cols:
            logger.warning("Detected legacy users table; dropping in favor of SSO schema")
            conn.execute("DROP TABLE users")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            name TEXT,
            picture TEXT,
            google_sub TEXT UNIQUE,
            role TEXT NOT NULL DEFAULT 'viewer',
            created_at TEXT NOT NULL,
            last_login TEXT
        )
    """)
    conn.commit()
    return conn


def _row_to_user(row: sqlite3.Row) -> dict:
    return {
        "email": row["email"],
        "name": row["name"],
        "picture": row["picture"],
        "role": row["role"],
        "created_at": row["created_at"],
        "last_login": row["last_login"],
    }


def verify_google_token(credential: str) -> dict:
    """Verify a Google ID token and return the decoded payload."""
    if not settings.google_client_id:
        raise HTTPException(
            status_code=500,
            detail="Google SSO not configured (GOOGLE_CLIENT_ID is empty)",
        )
    try:
        payload = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError as e:
        logger.warning(f"Google ID token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    if payload.get("aud") != settings.google_client_id:
        raise HTTPException(status_code=401, detail="Token audience mismatch")
    if not payload.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google email is not verified")

    email = (payload.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="Google account has no email")

    allowed = settings.get_allowed_domains()
    if allowed:
        domain = email.split("@", 1)[-1]
        if domain not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Email domain '{domain}' is not allowed to sign in",
            )

    return {
        "email": email,
        "name": payload.get("name"),
        "picture": payload.get("picture"),
        "sub": payload.get("sub"),
    }


def google_login(credential: str) -> dict:
    """Verify a Google credential, upsert the user, and return their record."""
    info = verify_google_token(credential)
    now = datetime.now(timezone.utc).isoformat()

    db = _get_db()
    try:
        existing = db.execute(
            "SELECT * FROM users WHERE email = ?", (info["email"],)
        ).fetchone()

        if existing:
            db.execute(
                "UPDATE users SET name = ?, picture = ?, google_sub = ?, last_login = ? WHERE email = ?",
                (info["name"], info["picture"], info["sub"], now, info["email"]),
            )
            db.commit()
            row = db.execute(
                "SELECT * FROM users WHERE email = ?", (info["email"],)
            ).fetchone()
            return _row_to_user(row)

        # First user to ever sign in becomes admin; everyone else starts as viewer.
        total = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        role = "admin" if total == 0 else "viewer"
        db.execute(
            "INSERT INTO users (email, name, picture, google_sub, role, created_at, last_login) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (info["email"], info["name"], info["picture"], info["sub"], role, now, now),
        )
        db.commit()
        if role == "admin":
            logger.info(f"First user '{info['email']}' auto-promoted to admin")
        row = db.execute(
            "SELECT * FROM users WHERE email = ?", (info["email"],)
        ).fetchone()
        return _row_to_user(row)
    finally:
        db.close()


def create_token(user: dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS)
    return jwt.encode(
        {
            "sub": user["email"],
            "role": user["role"],
            "name": user.get("name"),
            "picture": user.get("picture"),
            "exp": expire,
        },
        settings.jwt_secret,
        algorithm=JWT_ALGORITHM,
    )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Re-fetch to pick up live role changes (an admin demotion takes effect immediately).
    db = _get_db()
    try:
        row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    finally:
        db.close()
    if not row:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return _row_to_user(row)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# --- User management (admin only) ---

def list_users() -> list[dict]:
    db = _get_db()
    try:
        rows = db.execute(
            "SELECT * FROM users ORDER BY created_at"
        ).fetchall()
    finally:
        db.close()
    return [_row_to_user(r) for r in rows]


def update_user_role(email: str, role: str) -> dict:
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role '{role}'")
    db = _get_db()
    try:
        row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"User '{email}' not found")
        db.execute("UPDATE users SET role = ? WHERE email = ?", (role, email))
        db.commit()
        updated = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    finally:
        db.close()
    return _row_to_user(updated)


def delete_user(email: str, current_email: str):
    if email == current_email:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    db = _get_db()
    try:
        row = db.execute("SELECT email FROM users WHERE email = ?", (email,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"User '{email}' not found")
        db.execute("DELETE FROM users WHERE email = ?", (email,))
        db.commit()
    finally:
        db.close()
