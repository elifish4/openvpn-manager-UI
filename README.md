# OpenVPN Manager

A full-stack web application for managing OpenVPN clients across multiple EC2 servers. Automates user creation, revocation, `.ovpn` file downloads, and tunnel mode switching — all from a modern UI with role-based access control.

## Features

- **Multi-server management** — manage clients across multiple OpenVPN servers from a single dashboard
- **Client lifecycle** — create, revoke, and disconnect VPN users via the web UI (no more SSH-ing into servers)
- **Smart username generation** — enter a first name, last name, and email; the VPN username is auto-generated as `<firstname>_<lastname>_<env>` (e.g. `john_doe_prod`)
- **Slack integration** — after creating a client, the `.ovpn` file is automatically sent to the user via Slack DM (looked up by email), including the password if one was set and a link to the setup guide
- **Tunnel mode control** — switch clients between full tunnel and split tunnel on the fly
- **`.ovpn` downloads** — download client config files directly from the browser
- **Client disconnect** — disconnect connected clients on demand by clicking the "Connected" badge (uses OpenVPN management interface)
- **Traffic monitoring** — per-client and server-wide in/out traffic stats with selectable period (7/15/30/60 days), combining historical data with live session traffic, auto-refreshing every 5 seconds
- **Connection monitoring** — real-time connected/disconnected status and last-seen timestamps for each client
- **Search & sort** — filter and sort the client table by name, email, connection status, last seen, tunnel mode, or traffic
- **System audit log** — tracks all actions (client creation, revocation, downloads, tunnel changes, logins, admin user management) with filterable, paginated log view
- **Authentication** — Google SSO sign-in with admin and viewer roles (no passwords stored)
- **User management** — admin panel to promote/demote users between admin and viewer, or remove them entirely
- **Persistent storage** — SQLite databases (users, audit log, client metadata, traffic history) stored on a PVC, survives pod restarts and rescheduling
- **Kubernetes-native** — ships with a Helm chart for production deployment on EKS

## Architecture

```
┌─────────────┐       ┌──────────────┐       ┌──────────────────┐
│   Browser    │──────▶│   Frontend   │──────▶│     Backend      │
│              │       │  (React/TS)  │       │   (FastAPI)      │
│              │       │  Nginx :80   │       │   Uvicorn :8000  │
└─────────────┘       └──────────────┘       └────────┬─────────┘
                                                      │ SSH (Paramiko)
                                         ┌────────────┼────────────┐
                                         │            │            │
                                    ┌────▼─────┐ ┌───▼──────┐ ┌───▼──────┐
                                    │ VPN EC2  │ │ VPN EC2  │ │ VPN EC2  │
                                    │ (Prod)   │ │ (Dev)    │ │ (Stage)  │
                                    └──────────┘ └──────────┘ └──────────┘
```

| Layer    | Stack                                    |
|----------|------------------------------------------|
| Frontend | React 19, TypeScript, Tailwind CSS, Vite |
| Backend  | Python 3.13, FastAPI, Paramiko, SQLite, Slack SDK |
| Auth     | Google SSO (google-auth) + JWT sessions (python-jose) |
| Infra    | Docker, Helm, Kubernetes, Nginx           |

## Project Structure

```
openvpn_manager/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI routes (VPN + auth + admin)
│   │   ├── auth.py          # JWT auth, user CRUD, SQLite storage
│   │   ├── audit.py         # Audit logging + client metadata (SQLite)
│   │   ├── config.py        # Pydantic settings from env vars (dynamic server discovery)
│   │   ├── slack_notify.py  # Slack DM with .ovpn file delivery
│   │   ├── traffic.py       # Traffic data persistence and aggregation (SQLite)
│   │   └── ssh_manager.py   # SSH automation (create/revoke/disconnect/tunnel/download)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── run.py
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── auth.tsx          # Auth context & token management
│   │   ├── api.ts            # API client with auth headers
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── LoginPage.tsx
│   │       ├── Dashboard.tsx
│   │       ├── ServerDetail.tsx
│   │       ├── ClientTable.tsx
│   │       ├── CreateClientModal.tsx
│   │       ├── AdminPanel.tsx
│   │       ├── AuditLog.tsx
│   │       └── ...
│   ├── Dockerfile
│   └── nginx.conf.template
├── helm/
│   └── openvpn-manager/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│           ├── deployment-backend.yaml
│           ├── deployment-frontend.yaml
│           ├── service-backend.yaml
│           ├── service-frontend.yaml
│           ├── ingress.yaml
│           ├── configmap.yaml
│           ├── secret-admin.yaml
│           ├── secret-ssh-keys.yaml
│           └── pvc.yaml
└── docker-compose.yml
```

## How It Works

This system replaces the manual workflow of SSH-ing into each OpenVPN EC2 server, running an interactive shell script, and copying `.ovpn` files back to your laptop. The backend automates every step over SSH using [Paramiko](https://www.paramiko.org/).

### The Problem

Each OpenVPN server runs an interactive management script (e.g. [hwdsl2/openvpn-install](https://github.com/hwdsl2/openvpn-install) or [angristan/openvpn-install](https://github.com/angristan/openvpn-install)). Managing clients requires an operator to:

1. SSH into the EC2 instance
2. Run the interactive setup script (e.g. `sudo bash openvpn.sh`)
3. Navigate a text menu (add user, revoke user, etc.)
4. Type the client name, choose password or passwordless
5. Wait for certificate generation
6. Copy the resulting `.ovpn` file from the server to their machine
7. Send it to the end user

With multiple servers and dozens of users, this becomes tedious and error-prone.

### SSH Automation (Backend)

The backend (`ssh_manager.py`) connects to each VPN server over SSH using a private key and automates the interactive script programmatically:

```
Backend (FastAPI)                          VPN Server (EC2)
      │                                         │
      │─── SSH connect (Paramiko + key) ────────▶│
      │                                         │
      │─── echo -e "{add}\n{name}\n1" |         │
      │    sudo bash openvpn.sh ────────────────▶│  ← pipe answers to interactive prompts
      │                                         │
      │◀── stdout: certificate output ──────────│
      │                                         │
      │─── SFTP: download {name}.ovpn ──────────▶│
      │◀── file bytes ──────────────────────────│
      │                                         │
      │─── SSH close ───────────────────────────▶│
```

**Client creation** pipes all expected answers (menu choice, client name, password option) to the script's stdin in a single `echo -e ... | script` command. The menu option number for "Add" is configurable per server via `menuAdd` in `values.yaml`.

**Client revocation** uses an interactive shell (`invoke_shell`) because the script dynamically lists existing clients with numbered indices. The backend sends the configured revoke option (via `menuRevoke`), reads the client list, finds the target client's number, and sends it back — then confirms the revocation.

**Client disconnect** sends a `kill <client_name>` command to the OpenVPN management interface (TCP port 7505) to immediately drop a connected client's session. This requires the `management 127.0.0.1 7505` directive in the server's OpenVPN config.

### Data Sources Read via SSH

| Data | Source on Server | Method |
|------|-----------------|--------|
| Client list (active/revoked) | `/etc/openvpn/server/easy-rsa/pki/index.txt` or `/etc/openvpn/easy-rsa/pki/index.txt` | Parse PKI index: `V` = valid, `R` = revoked (both paths checked) |
| `.ovpn` file availability | `ls ~/*.ovpn` | Check if config file exists |
| Tunnel mode (full/split) | `/etc/openvpn/ccd/<client>` or `/etc/openvpn/server/ccd/<client>` | CCD file with `redirect-gateway` = full tunnel; `.orig` suffix = split |
| Currently connected clients | `/run/openvpn-server/status-server.log`, `/var/log/openvpn/status.log`, or `/etc/openvpn/server/openvpn-status.log` | Parse the `CLIENT LIST` CSV section for common name, IP, bytes in/out, connected since |
| Traffic (historical) | SQLite `traffic_deltas` table | Background poller snapshots connected client bytes every 5 minutes; deltas stored per session |
| Last seen timestamp | `journalctl -u openvpn*` | Grep for `Peer Connection Initiated` events per client |
| Server health | `uptime`, `systemctl is-active openvpn*` | Standard system commands |

### Tunnel Mode Switching

OpenVPN's Client Config Directory (CCD) allows per-client overrides. The backend manages tunnel mode by:

- **Full tunnel**: writes `push "redirect-gateway def1"` to `/etc/openvpn/ccd/<client>`
- **Split tunnel**: renames the CCD file to `<client>.orig`, disabling the override

The client must reconnect for the change to take effect.

### Client Creation & Username Generation

Instead of manually choosing a VPN username, the admin enters the user's **first name**, **last name**, and **email address**. The system automatically generates a VPN username in the format:

```
<firstname>_<lastname>_<env>
```

For example, entering "John", "Doe" on the Production server produces `john_doe_prod`. Names are sanitized (non-alphanumeric characters removed, lowercased) before generation. The email and real name are stored in a `client_metadata` SQLite table and displayed alongside the VPN username in the client table, making it easy to search for users by real name or email.

### Slack Integration

When creating a VPN client, the admin can toggle **"Send .ovpn via Slack"** (enabled by default). When enabled, the backend:

1. Downloads the generated `.ovpn` file from the VPN server via SFTP
2. Looks up the user's Slack account by email using `users.lookupByEmail`
3. Opens a DM channel with `conversations.open`
4. Uploads the `.ovpn` file to the DM using `files_upload_v2` with a message containing:
   - The server name
   - The attached `.ovpn` file
   - The VPN password (if one was set)
   - A link to the Tunnelblink setup guide

Slack integration is **fire-and-forget**: if the lookup fails (user not in workspace, email mismatch, token issue), the VPN client is still created successfully. The UI shows the Slack delivery result after creation. If `SLACK_BOT_TOKEN` is empty or unset, the feature is silently disabled.

**Required Slack bot scopes:** `users:read`, `users:read.email`, `chat:write`, `files:write`, `im:write`

### Audit Log

All significant actions are recorded in an `audit_log` SQLite table with timestamp, username, action type, server, client, and details. Tracked actions include:

- Client creation, revocation, and disconnect
- `.ovpn` file downloads
- Tunnel mode changes
- User logins
- Admin user management (create/update/delete)

Admins can view the full audit log from a dedicated **System Log** tab in the UI, with filtering by action type, text search, and pagination.

### Configurable Script Menu Options

Different OpenVPN management scripts have different menu layouts. For example, the [angristan](https://github.com/angristan/openvpn-install) script has "Revoke" as option 2, while the [hwdsl2](https://github.com/hwdsl2/openvpn-install) script has it as option 4.

To avoid hardcoding menu positions, each server in `values.yaml` has two configurable fields:

- **`menuAdd`** — the menu option number for "Add a new client" (default: `"1"`)
- **`menuRevoke`** — the menu option number for "Revoke an existing client" (default: `"2"`)

If the script changes or you use a different script on a particular server, just update these values and redeploy — no code changes or image rebuilds required.

### OpenVPN Management Interface

The disconnect feature requires the OpenVPN management interface to be enabled on each server. Add this line to the server's OpenVPN config (e.g. `/etc/openvpn/server/server.conf`):

```
management 127.0.0.1 7505
```

Then restart OpenVPN: `sudo systemctl restart openvpn-server@server`

The backend connects to this interface via `nc` to send `kill <client_name>` commands for on-demand client disconnection.

### Authentication & Authorization

The management UI is protected by **Google SSO**. Sign-in flow:

1. The SPA fetches `/api/auth/config` to discover the configured Google OAuth Client ID at runtime (no rebuild required to change it).
2. The user clicks "Sign in with Google" and Google returns a signed ID token.
3. The backend verifies the ID token against Google's public keys (`google-auth`), checks that the email belongs to one of the `ALLOWED_EMAIL_DOMAINS` (if any), then upserts the user in the local SQLite DB.
4. On success the backend mints a short-lived JWT used for subsequent API calls.

**Bootstrap**: the very first user to ever sign in is automatically promoted to `admin`. Every other new user lands as `viewer` (read-only) until an admin promotes them on the **Admin** page.

#### Setting up the Google OAuth Client ID

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Authorized JavaScript origins:
   - `https://vpn-manager.agorareal.com` (production URL)
   - `http://localhost:5173` (local dev) — optional
4. Save and copy the **Client ID** (looks like `1234...apps.googleusercontent.com`)
5. Set it via Helm: `--set googleSso.clientId=...` or in `values.yaml`

## Getting Started

### Prerequisites

- Python 3.13+
- Node.js 20+
- SSH key access to your OpenVPN EC2 servers

### Local Development

1. **Configure the backend:**

```bash
cd backend
cp .env.example .env
# Edit .env with your VPN server IPs, SSH key paths,
# GOOGLE_CLIENT_ID, and (optionally) ALLOWED_EMAIL_DOMAINS
```

2. **Start the backend:**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

3. **Start the frontend:**

```bash
cd frontend
npm install
npm run dev
```

4. Open http://localhost:5173 and click **Sign in with Google**. The first user to sign in automatically becomes admin.

### Docker Compose

```bash
docker-compose up --build
```

Access at http://localhost:3000.

## Kubernetes Deployment

### Build & Push Images

```bash
# Backend
docker buildx build --platform linux/amd64 --push \
  -t docker.io/kokofish/openvpn-manager-backend:2.0.0 \
  ./backend

# Frontend
docker buildx build --platform linux/amd64 --push \
  -t docker.io/kokofish/openvpn-manager-frontend:2.0.1 \
  ./frontend
```

### Deploy with Helm

1. **Create the namespace:**

```bash
kubectl create namespace vpn-manager
```

2. **Create the SSH keys secret** (if not using `sshKeys` in values):

```bash
kubectl create secret generic vpn-manager-openvpn-manager-ssh-keys \
  -n vpn-manager \
  --from-file=devops-open-vpn-prod.pem=/path/to/prod-key.pem \
  --from-file=devops-open-vpn-stage.pem=/path/to/stage-key.pem
```

3. **Install/upgrade the chart:**

```bash
helm upgrade --install vpn-manager ./helm/openvpn-manager \
  -n vpn-manager \
  --set googleSso.clientId=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com \
  --set googleSso.allowedEmailDomains=agorareal.com \
  --set auth.jwtSecret="$(openssl rand -hex 32)" \
  --set existingSshKeysSecret=vpn-manager-openvpn-manager-ssh-keys
```

### Helm Values Reference

| Key | Description | Default |
|-----|-------------|---------|
| `backend.image.tag` | Backend image tag | `latest` |
| `frontend.image.tag` | Frontend image tag | `latest` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class | `internal-nginx` |
| `ingress.host` | Ingress hostname | `vpn-manager.agorareal.com` |
| `googleSso.clientId` | Google OAuth Web Client ID (required for sign-in to work) | `""` |
| `googleSso.allowedEmailDomains` | Comma-separated email domains allowed to sign in (empty = any) | `"agorareal.com"` |
| `auth.jwtSecret` | Session JWT signing secret | `change-this-to-a-random-string` |
| `auth.slackBotToken` | Slack bot token for .ovpn DM delivery (empty = disabled) | `""` |
| `persistence.size` | PVC size for databases | `1Gi` |
| `persistence.storageClass` | Storage class | `gp2` |
| `existingSshKeysSecret` | Name of a pre-existing secret with SSH keys | `""` |
| `vpnServers.<name>.name` | Display name for the server | — |
| `vpnServers.<name>.host` | Server hostname or IP | — |
| `vpnServers.<name>.user` | SSH username | `ubuntu` |
| `vpnServers.<name>.keyPath` | Path to the SSH key inside the pod | — |
| `vpnServers.<name>.scriptPath` | Full command to invoke the OpenVPN management script | — |
| `vpnServers.<name>.ovpnDir` | Directory where `.ovpn` files are stored on the server | `/home/ubuntu` |
| `vpnServers.<name>.envLabel` | Environment label appended to generated usernames | — |
| `vpnServers.<name>.menuAdd` | Script menu option number for "Add a new client" | `"1"` |
| `vpnServers.<name>.menuRevoke` | Script menu option number for "Revoke an existing client" | `"2"` |

> **Note:** The `vpnServers` map is dynamic — add as many servers as you need (e.g. `server1`, `server2`, `server3`, etc.). Each server is auto-discovered by the backend at startup.

## Security Groups

The OpenVPN EC2 servers need the following inbound rule to allow SSH from the Kubernetes cluster:

| Protocol | Port | Source | Description |
|----------|------|--------|-------------|
| TCP | 22 | EKS node subnet CIDR | SSH from VPN Manager backend pods |

## Roles & Permissions

| Action | Admin | Viewer |
|--------|:-----:|:------:|
| View servers & clients | Yes | Yes |
| Download `.ovpn` files | Yes | Yes |
| Create clients | Yes | No |
| Revoke clients | Yes | No |
| Disconnect clients | Yes | No |
| Change tunnel mode | Yes | No |
| Manage users | Yes | No |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth/config` | — | Public Google OAuth config (Client ID, allowed domains) |
| `POST` | `/api/auth/google` | — | Exchange a Google ID token for a session JWT |
| `GET` | `/api/auth/me` | Any | Current user info |
| `GET` | `/api/health` | — | Health check |
| `GET` | `/api/servers` | Any | List VPN servers |
| `GET` | `/api/servers/:id/status` | Any | Server status & uptime |
| `GET` | `/api/servers/:id/clients` | Any | List VPN clients |
| `POST` | `/api/servers/:id/clients` | Admin | Create client |
| `DELETE` | `/api/servers/:id/clients/:name` | Admin | Revoke client |
| `POST` | `/api/servers/:id/clients/:name/disconnect` | Admin | Disconnect connected client |
| `PATCH` | `/api/servers/:id/clients/:name/tunnel` | Admin | Change tunnel mode |
| `GET` | `/api/servers/:id/clients/:name/download` | Any | Download `.ovpn` file |
| `GET` | `/api/servers/:id/traffic?days=30` | Any | Per-client and total traffic stats |
| `GET` | `/api/admin/users` | Admin | List manager users |
| `PATCH` | `/api/admin/users/:email` | Admin | Update user role (admin/viewer) |
| `DELETE` | `/api/admin/users/:email` | Admin | Remove user |
| `GET` | `/api/admin/audit-log` | Admin | View system audit log |
