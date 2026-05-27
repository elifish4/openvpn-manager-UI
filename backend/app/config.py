from pydantic_settings import BaseSettings
from pydantic import BaseModel
import os


class VPNServerConfig(BaseModel):
    name: str
    host: str
    user: str = "ubuntu"
    key_path: str
    script_path: str = "/vpn/setup_open_vpn.sh"
    ovpn_dir: str = "/home/ubuntu"
    env_label: str = "env"
    menu_add: str = "1"
    menu_revoke: str = "2"


class Settings(BaseSettings):
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    jwt_secret: str = "super-secret-change-me-in-production"
    data_dir: str = "/app/data"
    slack_bot_token: str = ""

    # Google SSO
    google_client_id: str = ""
    # Comma-separated list of email domains allowed to sign in.
    # Empty string = allow any Google account.
    allowed_email_domains: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    def get_allowed_domains(self) -> list[str]:
        return [d.strip().lower() for d in self.allowed_email_domains.split(",") if d.strip()]

    def get_servers(self) -> list[VPNServerConfig]:
        servers = []
        idx = 1
        while True:
            host = os.environ.get(f"VPN_SERVER_{idx}_HOST", "")
            if not host:
                break
            servers.append(VPNServerConfig(
                name=os.environ.get(f"VPN_SERVER_{idx}_NAME", f"VPN Server {idx}"),
                host=host,
                user=os.environ.get(f"VPN_SERVER_{idx}_USER", "ubuntu"),
                key_path=os.environ.get(f"VPN_SERVER_{idx}_KEY_PATH", ""),
                script_path=os.environ.get(f"VPN_SERVER_{idx}_SCRIPT_PATH", "/vpn/setup_open_vpn.sh"),
                ovpn_dir=os.environ.get(f"VPN_SERVER_{idx}_OVPN_DIR", "/home/ubuntu"),
                env_label=os.environ.get(f"VPN_SERVER_{idx}_ENV_LABEL", "env"),
                menu_add=os.environ.get(f"VPN_SERVER_{idx}_MENU_ADD", "1"),
                menu_revoke=os.environ.get(f"VPN_SERVER_{idx}_MENU_REVOKE", "2"),
            ))
            idx += 1
        return servers


settings = Settings()
