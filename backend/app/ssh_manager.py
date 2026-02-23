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
                "systemctl is-active openvpn* 2>/dev/null || echo 'unknown'"
            )
            vpn_status = stdout.read().decode().strip()

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

    def _get_tunnel_map(self, client: paramiko.SSHClient) -> dict[str, str]:
        """Check CCD directory to determine tunnel mode per client.

        CCD files with `redirect-gateway` → full tunnel.
        Files renamed to .orig → split (disabled override).
        No CCD file → uses server default (split tunnel).
        """
        ccd_dirs = [
            "/etc/openvpn/ccd",
            "/etc/openvpn/server/ccd",
        ]
        tunnel_map: dict[str, str] = {}
        full_tunnel_ccd: set[str] = set()

        for ccd_dir in ccd_dirs:
            stdin, stdout, stderr = client.exec_command(f"sudo ls {ccd_dir}/ 2>/dev/null")
            files_raw = stdout.read().decode().strip()
            if not files_raw:
                continue

            for filename in files_raw.split("\n"):
                filename = filename.strip()
                if not filename:
                    continue

                is_disabled = filename.endswith(".orig")
                base_name = filename[:-5] if is_disabled else filename

                stdin, stdout, stderr = client.exec_command(
                    f"sudo cat {ccd_dir}/{filename} 2>/dev/null"
                )
                content = stdout.read().decode().strip()

                has_redirect = "redirect-gateway" in content

                if has_redirect and not is_disabled:
                    full_tunnel_ccd.add(base_name)
                    tunnel_map[base_name] = "full"
                elif has_redirect and is_disabled:
                    tunnel_map[base_name] = "split"

        return tunnel_map, full_tunnel_ccd

    def _get_connected_clients(self, client: paramiko.SSHClient) -> dict[str, dict]:
        """Parse the OpenVPN status file to find currently connected clients."""
        status_paths = [
            "/var/log/openvpn/status.log",
            "/etc/openvpn/server/openvpn-status.log",
            "/run/openvpn-server/status-server.log",
        ]
        connected: dict[str, dict] = {}
        for path in status_paths:
            stdin, stdout, stderr = client.exec_command(f"sudo cat {path} 2>/dev/null")
            content = stdout.read().decode().strip()
            if not content or "CLIENT LIST" not in content:
                continue
            in_client_list = False
            for line in content.split("\n"):
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
                        connected_since = parts[3].strip() if len(parts) > 3 else ""
                        connected[cn] = {
                            "real_address": real_addr,
                            "connected_since": connected_since,
                        }
            break
        return connected

    def _get_last_seen(self, client: paramiko.SSHClient) -> dict[str, str]:
        """Parse journalctl for the most recent connection event per client."""
        last_seen: dict[str, str] = {}
        stdin, stdout, stderr = client.exec_command(
            'sudo journalctl -u "openvpn*" -u "ovpn-*" --no-pager --since "30 days ago" 2>/dev/null '
            '| grep -E "Peer Connection Initiated|peer info|Data Channel" '
            '| tail -200'
        )
        log_output = stdout.read().decode().strip()
        if not log_output:
            return last_seen

        for line in log_output.split("\n"):
            # Format: "Feb 22 18:46:22 hostname ovpn-server[pid]: username/ip:port ..."
            match = re.match(r'^(\w+ \d+ [\d:]+) \S+ \S+\[\d+\]: ([^/]+)/', line)
            if match:
                timestamp_str = match.group(1)
                cn = match.group(2).strip()
                last_seen[cn] = timestamp_str
        return last_seen

    def list_clients(self) -> list[dict]:
        """List all VPN clients with certs, tunnel config, connection status, and last seen."""
        try:
            client = self._get_client()

            stdin, stdout, stderr = client.exec_command(
                "sudo cat /etc/openvpn/easy-rsa/pki/index.txt 2>/dev/null"
            )
            index_raw = stdout.read().decode().strip()

            stdin, stdout, stderr = client.exec_command(
                f"ls {self.server.ovpn_dir}/*.ovpn 2>/dev/null"
            )
            ovpn_files_raw = stdout.read().decode().strip()

            tunnel_map, full_tunnel_ccd = self._get_tunnel_map(client)
            connected = self._get_connected_clients(client)
            last_seen = self._get_last_seen(client)

            # Get server year for timestamp parsing
            stdin, stdout, stderr = client.exec_command("date +%Y")
            server_year = stdout.read().decode().strip()

            client.close()

            ovpn_files = set()
            if ovpn_files_raw:
                for f in ovpn_files_raw.split("\n"):
                    name = f.split("/")[-1].replace(".ovpn", "")
                    ovpn_files.add(name)

            valid_certs = set()
            revoked_certs = set()
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
                entry = {
                    "name": name,
                    "status": "active",
                    "has_ovpn": name in ovpn_files,
                    "tunnel_mode": tunnel_map.get(name, "split"),
                    "connected": conn_info is not None,
                    "connected_since": conn_info["connected_since"] if conn_info else None,
                    "real_address": conn_info["real_address"] if conn_info else None,
                    "last_seen": f"{last_seen[name]} {server_year}" if name in last_seen else None,
                }
                clients.append(entry)

            for name in sorted(revoked_certs):
                clients.append({
                    "name": name,
                    "status": "revoked",
                    "has_ovpn": name in ovpn_files,
                    "tunnel_mode": tunnel_map.get(name, "split"),
                    "connected": False,
                    "connected_since": None,
                    "real_address": None,
                    "last_seen": None,
                })

            return clients
        except Exception as e:
            logger.error(f"Failed to list clients on {self.server.host}: {e}")
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
            password_choice = "2" if use_password else "1"
            if use_password and password:
                # Pipe: 1 = add user, client_name, 2 = with password, password, password (confirm)
                cmd = f'echo -e "1\\n{client_name}\\n{password_choice}\\n{password}\\n{password}" | sudo {self.server.script_path}'
            else:
                # Pipe: 1 = add user, client_name, 1 = passwordless
                cmd = f'echo -e "1\\n{client_name}\\n{password_choice}" | sudo {self.server.script_path}'
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

            channel.send(f"sudo {self.server.script_path}\n")
            output = self._read_until(channel, ["Select an option"])

            channel.send("2\n")
            output = self._read_until(channel, ["number of the existing client", "Select one"])

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

        Full tunnel: CCD file named <client> with `push "redirect-gateway def1"`
        Split tunnel: CCD file renamed to <client>.orig (or removed if no file existed)
        """
        try:
            client = self._get_client()
            ccd_dir = self._find_ccd_dir(client)
            active_path = f"{ccd_dir}/{client_name}"
            disabled_path = f"{ccd_dir}/{client_name}.orig"

            if mode == "full":
                stdin, stdout, stderr = client.exec_command(
                    f"sudo test -f {disabled_path} && echo exists"
                )
                if "exists" in stdout.read().decode():
                    stdin, stdout, stderr = client.exec_command(
                        f"sudo mv {disabled_path} {active_path}"
                    )
                    stderr_out = stderr.read().decode().strip()
                    if stderr_out:
                        client.close()
                        return {"success": False, "error": stderr_out}
                else:
                    cmd = f'echo \'push "redirect-gateway def1"\' | sudo tee {active_path} > /dev/null'
                    stdin, stdout, stderr = client.exec_command(cmd)
                    stderr_out = stderr.read().decode().strip()
                    if stderr_out:
                        client.close()
                        return {"success": False, "error": stderr_out}

            elif mode == "split":
                stdin, stdout, stderr = client.exec_command(
                    f"sudo test -f {active_path} && echo exists"
                )
                if "exists" in stdout.read().decode():
                    stdin, stdout, stderr = client.exec_command(
                        f"sudo mv {active_path} {disabled_path}"
                    )
                    stderr_out = stderr.read().decode().strip()
                    if stderr_out:
                        client.close()
                        return {"success": False, "error": stderr_out}
            else:
                client.close()
                return {"success": False, "error": f"Invalid mode: {mode}"}

            client.close()
            return {"success": True, "message": f"Client '{client_name}' set to {mode} tunnel"}

        except Exception as e:
            logger.error(f"Failed to set tunnel mode for {client_name}: {e}")
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
