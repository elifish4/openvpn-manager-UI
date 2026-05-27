import asyncio
import logging
import re
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional
from pydantic import BaseModel
import io

from .config import settings
from .ssh_manager import SSHManager
from .auth import (
    GoogleLoginRequest, UpdateUserRequest,
    google_login, create_token, get_current_user, require_admin,
    list_users, update_user_role, delete_user,
)
from . import audit
from . import slack_notify
from . import traffic

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OpenVPN Manager API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

servers = settings.get_servers()
ssh_managers: dict[int, SSHManager] = {}
for i, server_cfg in enumerate(servers):
    ssh_managers[i] = SSHManager(server_cfg)


def _server_name(server_id: int) -> str:
    if server_id < len(servers):
        return servers[server_id].name
    return f"Server {server_id}"


TRAFFIC_POLL_INTERVAL = 300  # 5 minutes


async def _poll_traffic():
    """Background task: poll each server's status file and record traffic deltas."""
    while True:
        await asyncio.sleep(TRAFFIC_POLL_INTERVAL)
        for server_id, mgr in ssh_managers.items():
            try:
                connected = mgr.get_connected_with_traffic()
                if connected:
                    traffic.record_snapshot(server_id, connected)
            except Exception as e:
                logger.warning(f"[traffic-poll] server {server_id}: {e}")


@app.on_event("startup")
def startup():
    asyncio.get_event_loop().create_task(_poll_traffic())


@app.get("/api/health")
def health():
    return {"status": "ok"}


class CreateClientRequest(BaseModel):
    first_name: str
    last_name: str
    email: str
    use_password: bool = False
    password: Optional[str] = None
    send_slack: bool = True


class BulkCreateClientRequest(BaseModel):
    server_ids: list[int]
    first_name: str
    last_name: str
    email: str
    use_password: bool = False
    password: Optional[str] = None
    send_slack: bool = True


class SetTunnelModeRequest(BaseModel):
    tunnel_mode: str


# --- Auth ---

@app.get("/api/auth/config")
def auth_config():
    """Public endpoint so the SPA can discover the Google OAuth Client ID at runtime."""
    return {
        "google_client_id": settings.google_client_id,
        "allowed_domains": settings.get_allowed_domains(),
    }


@app.post("/api/auth/google")
def login_google(req: GoogleLoginRequest):
    user = google_login(req.credential)
    token = create_token(user)
    audit.record(user["email"], "login", details="google_sso")
    return {"token": token, **user}


@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return user


# --- Admin: User Management ---

@app.get("/api/admin/users")
def admin_list_users(_: dict = Depends(require_admin)):
    return list_users()


@app.patch("/api/admin/users/{email}")
def admin_update_user(email: str, req: UpdateUserRequest, user: dict = Depends(require_admin)):
    if not req.role:
        raise HTTPException(status_code=400, detail="No fields to update")
    if email == user["email"] and req.role != "admin":
        raise HTTPException(status_code=400, detail="You cannot demote yourself")
    result = update_user_role(email, req.role)
    audit.record(user["email"], "update_admin_user", client_name=email, details=f"role={req.role}")
    return result


@app.delete("/api/admin/users/{email}")
def admin_delete_user(email: str, user: dict = Depends(require_admin)):
    delete_user(email, user["email"])
    audit.record(user["email"], "delete_admin_user", client_name=email)
    return {"message": f"User '{email}' deleted"}


# --- Admin: Audit Log ---

@app.get("/api/admin/audit-log")
def get_audit_log(
    user: dict = Depends(require_admin),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    action: Optional[str] = Query(default=None),
):
    logs = audit.get_logs(limit=limit, offset=offset, action=action)
    total = audit.count_logs(action=action)
    return {"logs": logs, "total": total}


# --- Traffic ---

@app.get("/api/servers/{server_id}/traffic")
def get_traffic(server_id: int, days: int = Query(default=30, ge=1, le=365), user: dict = Depends(get_current_user)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    per_client = traffic.get_traffic(server_id, days)
    totals = traffic.get_server_totals(server_id, days)
    return {"clients": per_client, "totals": totals, "days": days}


# --- VPN Servers (protected) ---

@app.get("/api/servers")
def get_servers(user: dict = Depends(get_current_user)):
    result = []
    for i, server_cfg in enumerate(servers):
        result.append({"id": i, "name": server_cfg.name, "host": server_cfg.host, "env_label": server_cfg.env_label})
    return result


@app.get("/api/servers/{server_id}/status")
def get_server_status(server_id: int, user: dict = Depends(get_current_user)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    return ssh_managers[server_id].check_connection()


@app.get("/api/servers/{server_id}/clients")
def get_clients(server_id: int, user: dict = Depends(get_current_user)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    try:
        clients = ssh_managers[server_id].list_clients()
        meta_map = audit.get_client_metadata_map(server_id)
        for c in clients:
            meta = meta_map.get(c["name"])
            if meta:
                c["email"] = meta["email"]
                c["first_name"] = meta["first_name"]
                c["last_name"] = meta["last_name"]
            else:
                c["email"] = None
                c["first_name"] = None
                c["last_name"] = None
        return clients
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/servers/{server_id}/clients")
def create_client(server_id: int, req: CreateClientRequest, user: dict = Depends(require_admin)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")

    env_label = servers[server_id].env_label if server_id < len(servers) else "env"
    first = re.sub(r'[^a-zA-Z0-9]', '', req.first_name).lower()
    last = re.sub(r'[^a-zA-Z0-9]', '', req.last_name).lower()
    if not first or not last:
        raise HTTPException(status_code=400, detail="First and last name must contain at least one alphanumeric character")
    client_name = f"{first}_{last}_{env_label}"

    result = ssh_managers[server_id].create_client(client_name, req.use_password, req.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))

    audit.save_client_metadata(client_name, server_id, req.email, req.first_name, req.last_name)

    slack_result = {"sent": False, "reason": "not requested"}
    if req.send_slack:
        ovpn_bytes = ssh_managers[server_id].download_ovpn(client_name)
        if ovpn_bytes:
            slack_result = slack_notify.send_ovpn_to_user(
                req.email, client_name, ovpn_bytes, _server_name(server_id),
                password=req.password if req.use_password else None)
        else:
            slack_result = {"sent": False, "reason": "Could not download .ovpn file"}

    pw_info = " (with password)" if req.use_password else ""
    slack_info = ", Slack sent" if slack_result.get("sent") else ""
    audit.record(user["email"], "create_client", _server_name(server_id), client_name,
                 details=f"{req.first_name} {req.last_name} <{req.email}>{pw_info}{slack_info}")
    result["client_name"] = client_name
    result["slack_sent"] = slack_result.get("sent", False)
    result["slack_error"] = slack_result.get("reason") if not slack_result.get("sent") else None
    return result


@app.post("/api/clients/bulk")
def bulk_create_clients(req: BulkCreateClientRequest, user: dict = Depends(require_admin)):
    if not req.server_ids:
        raise HTTPException(status_code=400, detail="At least one server must be selected")

    invalid = [sid for sid in req.server_ids if sid not in ssh_managers]
    if invalid:
        raise HTTPException(status_code=404, detail=f"Server(s) not found: {invalid}")

    first = re.sub(r'[^a-zA-Z0-9]', '', req.first_name).lower()
    last = re.sub(r'[^a-zA-Z0-9]', '', req.last_name).lower()
    if not first or not last:
        raise HTTPException(status_code=400, detail="First and last name must contain at least one alphanumeric character")

    results = []
    for server_id in req.server_ids:
        env_label = servers[server_id].env_label if server_id < len(servers) else "env"
        client_name = f"{first}_{last}_{env_label}"
        server_name = _server_name(server_id)

        entry: dict = {
            "server_id": server_id,
            "server_name": server_name,
            "client_name": client_name,
            "success": False,
            "error": None,
            "slack_sent": False,
            "slack_error": None,
        }

        try:
            result = ssh_managers[server_id].create_client(client_name, req.use_password, req.password)
            if not result["success"]:
                entry["error"] = result.get("error", "Unknown error")
                results.append(entry)
                continue

            entry["success"] = True
            audit.save_client_metadata(client_name, server_id, req.email, req.first_name, req.last_name)

            slack_result = {"sent": False, "reason": "not requested"}
            if req.send_slack:
                ovpn_bytes = ssh_managers[server_id].download_ovpn(client_name)
                if ovpn_bytes:
                    slack_result = slack_notify.send_ovpn_to_user(
                        req.email, client_name, ovpn_bytes, server_name,
                        password=req.password if req.use_password else None)
                else:
                    slack_result = {"sent": False, "reason": "Could not download .ovpn file"}

            entry["slack_sent"] = slack_result.get("sent", False)
            if not slack_result.get("sent"):
                entry["slack_error"] = slack_result.get("reason")

            pw_info = " (with password)" if req.use_password else ""
            slack_info = ", Slack sent" if slack_result.get("sent") else ""
            audit.record(user["email"], "create_client", server_name, client_name,
                         details=f"{req.first_name} {req.last_name} <{req.email}>{pw_info}{slack_info} (bulk)")

        except Exception as e:
            logger.error(f"Bulk create failed for server {server_id}: {e}")
            entry["error"] = str(e)

        results.append(entry)

    return {"results": results}


@app.post("/api/servers/{server_id}/clients/{client_name}/disconnect")
def disconnect_client(server_id: int, client_name: str, user: dict = Depends(require_admin)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    result = ssh_managers[server_id].disconnect_client(client_name)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    audit.record(user["email"], "disconnect_client", _server_name(server_id), client_name)
    return result


@app.delete("/api/servers/{server_id}/clients/{client_name}")
def revoke_client(server_id: int, client_name: str, user: dict = Depends(require_admin)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    result = ssh_managers[server_id].revoke_client(client_name)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    audit.record(user["email"], "revoke_client", _server_name(server_id), client_name)
    return result


@app.patch("/api/servers/{server_id}/clients/{client_name}/tunnel")
def set_tunnel_mode(server_id: int, client_name: str, req: SetTunnelModeRequest, user: dict = Depends(require_admin)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    if req.tunnel_mode not in ("full", "split"):
        raise HTTPException(status_code=400, detail="tunnel_mode must be 'full' or 'split'")
    result = ssh_managers[server_id].set_tunnel_mode(client_name, req.tunnel_mode)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    audit.record(user["email"], "change_tunnel", _server_name(server_id), client_name,
                 details=f"Changed to {req.tunnel_mode} tunnel")
    return result


@app.post("/api/servers/{server_id}/clients/{client_name}/resend-slack")
def resend_slack(server_id: int, client_name: str, user: dict = Depends(require_admin)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")

    meta_map = audit.get_client_metadata_map(server_id)
    meta = meta_map.get(client_name)
    if not meta or not meta.get("email"):
        raise HTTPException(status_code=400, detail="No email found for this client")

    ovpn_bytes = ssh_managers[server_id].download_ovpn(client_name)
    if not ovpn_bytes:
        raise HTTPException(status_code=404, detail="OVPN file not found")

    slack_result = slack_notify.send_ovpn_to_user(
        meta["email"], client_name, ovpn_bytes, _server_name(server_id))

    audit.record(user["email"], "resend_slack", _server_name(server_id), client_name,
                 details=f"Resent to {meta['email']}, sent={slack_result.get('sent')}")

    if not slack_result.get("sent"):
        raise HTTPException(status_code=502, detail=slack_result.get("reason", "Slack send failed"))

    return {"sent": True}


@app.get("/api/servers/{server_id}/clients/{client_name}/download")
def download_ovpn(server_id: int, client_name: str, token: str = ""):
    """Download .ovpn file. Accepts token as query param for browser downloads."""
    from jose import JWTError, jwt as jose_jwt
    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    try:
        payload = jose_jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        email = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    content = ssh_managers[server_id].download_ovpn(client_name)
    if content is None:
        raise HTTPException(status_code=404, detail="OVPN file not found")

    audit.record(email, "download_ovpn", _server_name(server_id), client_name)

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={client_name}.ovpn"},
    )
