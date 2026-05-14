import paramiko
import time
import re
import io
import logging
from typing import Optional
from .config import VPNServerConfig

logger = logging.getLogger(__name__)

PROMPT_TIMEOUT = 30
READ_CHUNK_SIZE = 4096

ANSI_RE = re.compile(r'\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\[\?[0-9]*[a-z]')


def _strip_ansi(text: str) -> str:
    return ANSI_RE.sub('', text)


class SSHManager:
    def __init__(self, server: VPNServerConfig):
        self.server = server

    def _get_client(self) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=self.server.host,
            username=self.server.user,
            key_filename=self.server.key_path,
            timeout=15,
        )
        return client

    def _read_until(self, channel, patterns: list[str], timeout: int = PROMPT_TIMEOUT) -> str:
        """Read from channel until one of the patterns is found (ANSI-stripped matching)."""
        output = ""
        start = time.time()
        while time.time() - start < timeout:
            if channel.recv_ready():
                chunk = channel.recv(READ_CHUNK_SIZE).decode("utf-8", errors="replace")
                output += chunk
                clean = _strip_ansi(output)
                for pattern in patterns:
                    if pattern in clean:
                        return output
            time.sleep(0.2)
        return output

    def check_connection(self) -> dict:
        """Test SSH connectivity and return server info."""
        try:
            client = self._get_client()
            stdin, stdout, stderr = client.exec_command("uptime")
            uptime = stdout.read().decode().strip()

            stdin, stdout, stderr = client.exec_command(
                "systemctl is-active openvpn-server@server openvpn@server openvpn 2>/dev/null"
            )
            statuses = stdout.read().decode().strip().split("\n")
            vpn_status = "active" if "active" in statuses else statuses[0] if statuses else "unknown"

            stdin, stdout, stderr = client.exec_command(
                "hostname -I 2>/dev/null | awk '{print $1}'"
            )
            private_ip = stdout.read().decode().strip()

            client.close()
            return {
                "online": True,
                "uptime": uptime,
                "vpn_status": vpn_status,
                "private_ip": private_ip,
            }
        except Exception as e:
            logger.error(f"Connection check failed for {self.server.host}: {e}")
            return {"online": False, "error": str(e)}

    def _parse_connected_clients(self, status_output: str) -> dict[str, dict]:
        """Parse OpenVPN status output to find currently connected clients.

        Supports both formats:
          - Legacy (status-version 1): Common Name,Real Address,Bytes Received,Bytes Sent,Connected Since
          - Tagged (status-version 3): CLIENT_LIST,CN,Real Addr,VAddr,VAddr6,Bytes Recv,Bytes Sent,Connected Since,...
        """
        connected: dict[str, dict] = {}
        if not status_output:
            return connected

        for line in status_output.split("\n"):
            if line.startswith("CLIENT_LIST,"):
                parts = line.split(",")
                if len(parts) >= 8:
                    cn = parts[1].strip()
                    real_addr = parts[2].split(":")[0].strip()
                    bytes_recv = int(parts[5]) if parts[5].strip().isdigit() else 0
                    bytes_sent = int(parts[6]) if parts[6].strip().isdigit() else 0
                    connected_since = parts[7].strip()
                    connected[cn] = {
                        "real_address": real_addr,
                        "bytes_received": bytes_recv,
                        "bytes_sent": bytes_sent,
                        "connected_since": connected_since,
                    }

        if not connected and "Common Name," in status_output:
            in_client_list = False
            for line in status_output.split("\n"):
                if line.startswith("Common Name,"):
                    in_client_list = True
                    continue
                if line.startswith("ROUTING TABLE"):
                    break
                if in_client_list and "," in line:
                    parts = line.split(",")
                    if len(parts) >= 4:
                        cn = parts[0].strip()
                        real_addr = parts[1].split(":")[0].strip()
                        bytes_recv = int(parts[2]) if parts[2].strip().isdigit() else 0
                        bytes_sent = int(parts[3]) if parts[3].strip().isdigit() else 0
                        connected_since = parts[4].strip() if len(parts) > 4 else ""
                        connected[cn] = {
                            "real_address": real_addr,
                            "bytes_received": bytes_recv,
                            "bytes_sent": bytes_sent,
                            "connected_since": connected_since,
                        }

        return connected

    def _parse_tunnel_map(self, ccd_output: str) -> tuple[dict[str, str], bool]:
        """Parse CCD listing output to determine tunnel mode per client.

        Returns (tunnel_map, global_redirect).
        """
        tunnel_map: dict[str, str] = {}
        global_redirect = False

        for line in ccd_output.split("\n"):
            line = line.strip()
            if line.startswith("GLOBAL_REDIRECT:"):
                global_redirect = "yes" in line.lower()
            elif line.startswith("CCD:"):
                # Format: CCD:<filename>:<content>
                rest = line[4:]
                sep_idx = rest.find(":")
                if sep_idx > 0:
                    filename = rest[:sep_idx]
                    content = rest[sep_idx + 1:]
                    if "push-remove redirect-gateway" in content:
                        tunnel_map[filename] = "split"
                    elif "redirect-gateway" in content:
                        tunnel_map[filename] = "full"

        return tunnel_map, global_redirect

    def _parse_last_seen(self, journal_output: str) -> dict[str, str]:
        """Parse journalctl output for the most recent connection event per client."""
        last_seen: dict[str, str] = {}
        for line in journal_output.split("\n"):
            match = re.match(r'^(\w+ \d+ [\d:]+) \S+ \S+\[\d+\]: ([^/]+)/', line)
            if match:
                last_seen[match.group(2).strip()] = match.group(1)
        return last_seen

    def get_connected_with_traffic(self) -> dict[str, dict]:
        """Public wrapper for background traffic polling."""
        try:
            client = self._get_client()
            stdin, stdout, stderr = client.exec_command(
                "sudo cat /run/openvpn-server/status-server.log "
                "/var/log/openvpn/status.log "
                "/etc/openvpn/server/openvpn-status.log 2>/dev/null",
                timeout=10,
            )
            result = self._parse_connected_clients(stdout.read().decode())
            client.close()
            return result
        except Exception as e:
            logger.warning(f"[traffic] Failed to poll {self.server.host}: {e}")
            return {}

    _BATCH_SCRIPT = r"""
echo '===INDEX==='
sudo cat /etc/openvpn/server/easy-rsa/pki/index.txt /etc/openvpn/easy-rsa/pki/index.txt 2>/dev/null | head -200 || true
echo '===STATUS==='
sudo cat /run/openvpn-server/status-server.log /var/log/openvpn/status.log /etc/openvpn/server/openvpn-status.log 2>/dev/null || true
echo '===CCD==='
sudo grep -q 'redirect-gateway' /etc/openvpn/server/server.conf /etc/openvpn/server.conf 2>/dev/null && echo 'GLOBAL_REDIRECT:YES' || echo 'GLOBAL_REDIRECT:NO'
for d in /etc/openvpn/server/ccd /etc/openvpn/ccd; do
  if [ -d "$d" ]; then
    for f in "$d"/*; do
      if [ -f "$f" ]; then echo "CCD:$(basename "$f"):$(sudo cat "$f" 2>/dev/null)"; fi
    done
  fi
done
echo '===JOURNAL==='
timeout 8 sudo journalctl -u 'openvpn-server@server' -u 'openvpn@server' --no-pager -n 2000 2>/dev/null | grep -E 'Peer Connection Initiated|peer info|Data Channel' | tail -100 || true
echo '===YEAR==='
date +%Y
echo '===END==='
"""

    def list_clients(self) -> list[dict]:
        """List all VPN clients in a single SSH call for performance."""
        try:
            client = self._get_client()
            cmd = self._BATCH_SCRIPT
            stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
            raw = stdout.read().decode("utf-8", errors="replace")
            client.close()

            sections: dict[str, str] = {}
            current_key = None
            current_lines: list[str] = []
            for line in raw.split("\n"):
                if line.startswith("===") and line.endswith("==="):
                    if current_key:
                        sections[current_key] = "\n".join(current_lines)
                    current_key = line.strip("=")
                    current_lines = []
                else:
                    current_lines.append(line)
            if current_key:
                sections[current_key] = "\n".join(current_lines)

            index_raw = sections.get("INDEX", "").strip()
            status_raw = sections.get("STATUS", "").strip()
            ccd_raw = sections.get("CCD", "").strip()
            journal_raw = sections.get("JOURNAL", "").strip()
            server_year = sections.get("YEAR", "").strip() or "2026"

            connected = self._parse_connected_clients(status_raw)
            tunnel_map, global_redirect = self._parse_tunnel_map(ccd_raw)
            self._global_redirect = global_redirect
            default_tunnel = "full" if global_redirect else "split"
            last_seen = self._parse_last_seen(journal_raw)

            valid_certs: set[str] = set()
            revoked_certs: set[str] = set()
            if index_raw:
                for line in index_raw.split("\n"):
                    parts = line.split("\t")
                    if len(parts) >= 6:
                        cn_match = re.search(r"CN=([^\s/]+)", parts[-1])
                        if cn_match:
                            cn = cn_match.group(1)
                            if cn == "server":
                                continue
                            if parts[0] == "V":
                                valid_certs.add(cn)
                            elif parts[0] == "R":
                                revoked_certs.add(cn)

            clients = []
            for name in sorted(valid_certs):
                conn_info = connected.get(name)
                clients.append({
                    "name": name,
                    "status": "active",
                    "has_ovpn": True,
                    "tunnel_mode": tunnel_map.get(name, default_tunnel),
                    "connected": conn_info is not None,
                    "connected_since": conn_info["connected_since"] if conn_info else None,
                    "real_address": conn_info["real_address"] if conn_info else None,
                    "bytes_received": conn_info["bytes_received"] if conn_info else 0,
                    "bytes_sent": conn_info["bytes_sent"] if conn_info else 0,
                    "last_seen": f"{last_seen[name]} {server_year}" if name in last_seen else None,
                })

            for name in sorted(revoked_certs):
                clients.append({
                    "name": name,
                    "status": "revoked",
                    "has_ovpn": False,
                    "tunnel_mode": tunnel_map.get(name, default_tunnel),
                    "connected": False,
                    "connected_since": None,
                    "real_address": None,
                    "bytes_received": 0,
                    "bytes_sent": 0,
                    "last_seen": None,
                })

            return clients
        except Exception as e:
            logger.error(f"Failed to list clients on {self.server.host}: {type(e).__name__}: {e}", exc_info=True)
            raise

    def _drain_channel(self, channel, seconds: float = 3) -> str:
        """Read any remaining data from channel for a given duration."""
        output = ""
        deadline = time.time() + seconds
        while time.time() < deadline:
            if channel.recv_ready():
                output += channel.recv(READ_CHUNK_SIZE).decode("utf-8", errors="replace")
            time.sleep(0.3)
        return output

    def create_client(self, client_name: str, use_password: bool = False, password: Optional[str] = None) -> dict:
        """Create a new VPN client by piping answers to the interactive script."""
        try:
            client = self._get_client()
            add_opt = self.server.menu_add
            password_choice = "2" if use_password else "1"
            if use_password and password:
                cmd = f'echo -e "{add_opt}\\n{client_name}\\n{password_choice}\\n{password}\\n{password}" | {self.server.script_path}'
            else:
                cmd = f'echo -e "{add_opt}\\n{client_name}\\n{password_choice}" | {self.server.script_path}'
            logger.info(f"[create] running on {self.server.host}: {cmd}")

            stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
            output = stdout.read().decode("utf-8", errors="replace")
            err_output = stderr.read().decode("utf-8", errors="replace")
            client.close()

            clean = _strip_ansi(output + err_output)
            logger.info(f"[create] output: {clean[-800:]}")

            already_phrases = ["already exists", "already a client", "already found"]
            if any(p in clean.lower() for p in already_phrases):
                return {"success": False, "error": f"Client '{client_name}' already exists on the server"}

            if "invalid" in clean.lower() and "name" in clean.lower():
                return {"success": False, "error": f"Server rejected client name '{client_name}'. Use only alphanumeric characters, hyphens, and underscores."}

            success_kw = [".ovpn", "finished", "Added", "created", "Written"]
            if any(kw in clean for kw in success_kw):
                return {"success": True, "message": f"Client '{client_name}' created successfully"}
            else:
                return {"success": False, "error": "Client creation may have failed — check server", "output": clean[-800:]}

        except Exception as e:
            logger.error(f"Failed to create client on {self.server.host}: {e}")
            return {"success": False, "error": str(e)}

    def revoke_client(self, client_name: str) -> dict:
        """Revoke a VPN client by automating the interactive script."""
        try:
            client = self._get_client()
            channel = client.invoke_shell()
            time.sleep(1)
            self._read_until(channel, ["$", "#"])

            channel.send(f"{self.server.script_path}\n")
            output = self._read_until(channel, ["Select an option"])

            revoke_opt = self.server.menu_revoke
            logger.info(f"[revoke] using menu option {revoke_opt} for revoke")

            channel.send(f"{revoke_opt}\n")
            output = self._read_until(channel, ["number of the existing client", "Select one", "client to revoke"])

            lines = output.split("\n")
            client_number = None
            for line in lines:
                match = re.match(r"\s*(\d+)\)\s+(\S+)", line)
                if match and match.group(2) == client_name:
                    client_number = match.group(1)
                    break

            if not client_number:
                channel.close()
                client.close()
                return {"success": False, "error": f"Client '{client_name}' not found in revocation list"}

            channel.send(f"{client_number}\n")
            output = self._read_until(channel, ["Confirm", "y/n", "Y/N", "revoked", "$", "#"], timeout=30)

            if "y/n" in output.lower() or "confirm" in output.lower():
                channel.send("y\n")
                output = self._read_until(channel, ["revoked", "Revoking", "$", "#"], timeout=30)

            time.sleep(2)
            channel.close()
            client.close()

            return {"success": True, "message": f"Client '{client_name}' revoked successfully"}

        except Exception as e:
            logger.error(f"Failed to revoke client on {self.server.host}: {e}")
            return {"success": False, "error": str(e)}

    def _find_ccd_dir(self, client: paramiko.SSHClient) -> str:
        """Return the first existing CCD directory path on the server."""
        for ccd_dir in ["/etc/openvpn/ccd", "/etc/openvpn/server/ccd"]:
            stdin, stdout, stderr = client.exec_command(f"sudo test -d {ccd_dir} && echo exists")
            if "exists" in stdout.read().decode():
                return ccd_dir
        return "/etc/openvpn/ccd"

    def set_tunnel_mode(self, client_name: str, mode: str) -> dict:
        """Switch a client between full and split tunnel by managing their CCD file.

        Split tunnel is the server default (VPC routes pushed in server.conf).
        Full tunnel = CCD file with push redirect-gateway; split = remove CCD.
        """
        try:
            client = self._get_client()
            ccd_dir = self._find_ccd_dir(client)
            ccd_path = f"{ccd_dir}/{client_name}"

            if mode not in ("full", "split"):
                client.close()
                return {"success": False, "error": f"Invalid mode: {mode}"}

            if mode == "full":
                cmd = f'echo \'push "redirect-gateway def1"\' | sudo tee {ccd_path} > /dev/null'
                stdin, stdout, stderr = client.exec_command(cmd)
                stderr_out = stderr.read().decode().strip()
                if stderr_out:
                    client.close()
                    return {"success": False, "error": stderr_out}
            else:
                stdin, stdout, stderr = client.exec_command(f"sudo rm -f {ccd_path}")

            client.close()
            return {"success": True, "message": f"Client '{client_name}' set to {mode} tunnel"}

        except Exception as e:
            logger.error(f"Failed to set tunnel mode for {client_name}: {e}")
            return {"success": False, "error": str(e)}

    def disconnect_client(self, client_name: str) -> dict:
        """Disconnect a currently connected client via the OpenVPN management interface."""
        try:
            client = self._get_client()

            # Find the management directive from OpenVPN config
            find_cmd = (
                "sudo grep -h '^management' "
                "/etc/openvpn/server.conf "
                "/etc/openvpn/server/server.conf "
                "/etc/openvpn/*.conf "
                "2>/dev/null | head -1"
            )
            stdin, stdout, stderr = client.exec_command(find_cmd)
            mgmt_line = stdout.read().decode().strip()

            if not mgmt_line:
                client.close()
                return {"success": False, "error": "OpenVPN management interface not configured on this server"}

            parts = mgmt_line.split()
            if len(parts) >= 3:
                mgmt_host = parts[1]
                mgmt_port = parts[2]
            else:
                client.close()
                return {"success": False, "error": f"Could not parse management directive: {mgmt_line}"}

            kill_cmd = (
                f'echo "kill {client_name}" | sudo nc -w 2 {mgmt_host} {mgmt_port} 2>&1'
            )
            logger.info(f"[disconnect] running on {self.server.host}: {kill_cmd}")
            stdin, stdout, stderr = client.exec_command(kill_cmd)
            output = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            client.close()

            logger.info(f"[disconnect] output: {output} | err: {err}")

            if "SUCCESS" in output:
                return {"success": True, "message": f"Client '{client_name}' disconnected"}
            elif "ERROR" in output and "not found" in output.lower():
                return {"success": False, "error": f"Client '{client_name}' is not currently connected"}
            else:
                return {"success": True, "message": f"Disconnect command sent for '{client_name}'"}

        except Exception as e:
            logger.error(f"Failed to disconnect {client_name}: {e}")
            return {"success": False, "error": str(e)}

    def download_ovpn(self, client_name: str) -> Optional[bytes]:
        """Download the .ovpn file for a client via SFTP."""
        try:
            client = self._get_client()
            sftp = client.open_sftp()

            remote_path = f"{self.server.ovpn_dir}/{client_name}.ovpn"
            with sftp.open(remote_path, "rb") as f:
                content = f.read()

            sftp.close()
            client.close()
            return content
        except FileNotFoundError:
            logger.error(f"OVPN file not found: {client_name}")
            return None
        except Exception as e:
            logger.error(f"Failed to download OVPN for {client_name}: {e}")
            return None
