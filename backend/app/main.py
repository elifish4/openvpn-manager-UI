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
    LoginRequest, CreateUserRequest, UpdateUserRequest, UserOut,
    authenticate_user, create_token, get_current_user, require_admin,
    init_admin_user, list_users, create_user, update_user, delete_user,
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
    init_admin_user()
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


class SetTunnelModeRequest(BaseModel):
    tunnel_mode: str


# --- Auth ---

@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = authenticate_user(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["username"], user["role"])
    audit.record(user["username"], "login")
    return {"token": token, "username": user["username"], "role": user["role"]}


@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return user


# --- Admin: User Management ---

@app.get("/api/admin/users")
def admin_list_users(user: dict = Depends(require_admin)):
    return list_users()


@app.post("/api/admin/users")
def admin_create_user(req: CreateUserRequest, user: dict = Depends(require_admin)):
    result = create_user(req.username, req.password, req.role)
    audit.record(user["username"], "create_admin_user", client_name=req.username, details=f"role={req.role}")
    return result


@app.patch("/api/admin/users/{username}")
def admin_update_user(username: str, req: UpdateUserRequest, user: dict = Depends(require_admin)):
    changes = []
    if req.password:
        changes.append("password changed")
    if req.role:
        changes.append(f"role={req.role}")
    result = update_user(username, req.password, req.role)
    audit.record(user["username"], "update_admin_user", client_name=username, details=", ".join(changes))
    return result


@app.delete("/api/admin/users/{username}")
def admin_delete_user(username: str, user: dict = Depends(require_admin)):
    delete_user(username, user["username"])
    audit.record(user["username"], "delete_admin_user", client_name=username)
    return {"message": f"User '{username}' deleted"}


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
    audit.record(user["username"], "create_client", _server_name(server_id), client_name,
                 details=f"{req.first_name} {req.last_name} <{req.email}>{pw_info}{slack_info}")
    result["client_name"] = client_name
    result["slack_sent"] = slack_result.get("sent", False)
    result["slack_error"] = slack_result.get("reason") if not slack_result.get("sent") else None
    return result


@app.post("/api/servers/{server_id}/clients/{client_name}/disconnect")
def disconnect_client(server_id: int, client_name: str, user: dict = Depends(require_admin)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    result = ssh_managers[server_id].disconnect_client(client_name)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    audit.record(user["username"], "disconnect_client", _server_name(server_id), client_name)
    return result


@app.delete("/api/servers/{server_id}/clients/{client_name}")
def revoke_client(server_id: int, client_name: str, user: dict = Depends(require_admin)):
    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    result = ssh_managers[server_id].revoke_client(client_name)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    audit.record(user["username"], "revoke_client", _server_name(server_id), client_name)
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
    audit.record(user["username"], "change_tunnel", _server_name(server_id), client_name,
                 details=f"Changed to {req.tunnel_mode} tunnel")
    return result


@app.get("/api/servers/{server_id}/clients/{client_name}/download")
def download_ovpn(server_id: int, client_name: str, token: str = ""):
    """Download .ovpn file. Accepts token as query param for browser downloads."""
    from jose import JWTError, jwt as jose_jwt
    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    try:
        payload = jose_jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if server_id not in ssh_managers:
        raise HTTPException(status_code=404, detail="Server not found")
    content = ssh_managers[server_id].download_ovpn(client_name)
    if content is None:
        raise HTTPException(status_code=404, detail="OVPN file not found")

    audit.record(username, "download_ovpn", _server_name(server_id), client_name)

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={client_name}.ovpn"},
    )
