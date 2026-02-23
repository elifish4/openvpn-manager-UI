from pydantic_settings import BaseSettings
from pydantic import BaseModel
from typing import Optional
import os


class VPNServerConfig(BaseModel):
    name: str
    host: str
    user: str = "ubuntu"
    key_path: str
    script_path: str = "/vpn/setup_open_vpn.sh"
    ovpn_dir: str = "/home/ubuntu"
    env_label: str = "env"


class Settings(BaseSettings):
    vpn_server_1_name: str = "VPN Server 1"
    vpn_server_1_host: str = ""
    vpn_server_1_user: str = "ubuntu"
    vpn_server_1_key_path: str = ""
    vpn_server_1_script_path: str = "/vpn/setup_open_vpn.sh"
    vpn_server_1_ovpn_dir: str = "/home/ubuntu"
    vpn_server_1_env_label: str = "prod"

    vpn_server_2_name: str = "VPN Server 2"
    vpn_server_2_host: str = ""
    vpn_server_2_user: str = "ubuntu"
    vpn_server_2_key_path: str = ""
    vpn_server_2_script_path: str = "/vpn/setup_open_vpn.sh"
    vpn_server_2_ovpn_dir: str = "/home/ubuntu"
    vpn_server_2_env_label: str = "dev"

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    admin_username: str = "admin"
    admin_password: str = "changeme"
    jwt_secret: str = "super-secret-change-me-in-production"
    data_dir: str = "/app/data"
    slack_bot_token: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    def get_servers(self) -> list[VPNServerConfig]:
        servers = []
        if self.vpn_server_1_host:
            servers.append(VPNServerConfig(
                name=self.vpn_server_1_name,
                host=self.vpn_server_1_host,
                user=self.vpn_server_1_user,
                key_path=self.vpn_server_1_key_path,
                script_path=self.vpn_server_1_script_path,
                ovpn_dir=self.vpn_server_1_ovpn_dir,
                env_label=self.vpn_server_1_env_label,
            ))
        if self.vpn_server_2_host:
            servers.append(VPNServerConfig(
                name=self.vpn_server_2_name,
                host=self.vpn_server_2_host,
                user=self.vpn_server_2_user,
                key_path=self.vpn_server_2_key_path,
                script_path=self.vpn_server_2_script_path,
                ovpn_dir=self.vpn_server_2_ovpn_dir,
                env_label=self.vpn_server_2_env_label,
            ))
        return servers


settings = Settings()
