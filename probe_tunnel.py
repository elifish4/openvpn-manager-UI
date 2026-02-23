#!/usr/bin/env python3
"""Probe OpenVPN server tunneling configuration via SSH."""

import subprocess
import sys

HOST = "3.68.110.36"
USER = "ubuntu"
KEY = "/Users/elifish/Desktop/workspace/key-pairs/devops-open-vpn-prod.pem"

SSH_BASE = [
    "ssh",
    "-i", KEY,
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=10",
    f"{USER}@{HOST}",
]


def run_ssh(cmd: str, label: str) -> str:
    """Run a command over SSH and return its stdout."""
    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"{'='*70}")
    result = subprocess.run(
        SSH_BASE + [cmd],
        capture_output=True, text=True, timeout=30
    )
    output = result.stdout.strip()
    if result.stderr.strip():
        output += f"\n[stderr]: {result.stderr.strip()}"
    print(output if output else "(no output)")
    return output


def main():
    # 1. Locate the main OpenVPN server config
    run_ssh(
        "sudo find /etc/openvpn -type f -name '*.conf' 2>/dev/null | head -20",
        "1a) Locate all .conf files under /etc/openvpn"
    )

    run_ssh(
        "sudo cat /etc/openvpn/server.conf 2>/dev/null || sudo cat /etc/openvpn/server/server.conf 2>/dev/null || echo 'server.conf not found at common paths'",
        "1b) Main server config contents"
    )

    # 2. Check CCD (Client Config Directory)
    run_ssh(
        "sudo find /etc/openvpn -type d -name 'ccd' -o -type d -name 'client-config-dir' 2>/dev/null",
        "2a) Locate CCD directories"
    )

    # Try common CCD paths
    run_ssh(
        "for d in /etc/openvpn/ccd /etc/openvpn/server/ccd /etc/openvpn/client-config-dir; do "
        "  if sudo test -d \"$d\"; then "
        "    echo \"--- CCD found at: $d ---\"; "
        "    sudo ls -la \"$d\"; "
        "    echo; "
        "  fi; "
        "done; "
        "echo 'Done scanning CCD paths.'",
        "2b) List CCD directory contents"
    )

    # Also check if server.conf references a client-config-dir
    run_ssh(
        "sudo grep -ri 'client-config-dir' /etc/openvpn/ 2>/dev/null || echo 'No client-config-dir directive found'",
        "2c) Grep for client-config-dir directive in configs"
    )

    # 3. Show CCD per-client files
    run_ssh(
        "for d in /etc/openvpn/ccd /etc/openvpn/server/ccd; do "
        "  if sudo test -d \"$d\"; then "
        "    for f in $(sudo ls \"$d\" 2>/dev/null); do "
        "      echo \"\\n--- $d/$f ---\"; "
        "      sudo cat \"$d/$f\"; "
        "      echo; "
        "    done; "
        "  fi; "
        "done",
        "3a) Contents of each CCD per-client file"
    )

    # 4. Check for .ovpn client profile files on the server
    run_ssh(
        "sudo find /etc/openvpn /home /root -name '*.ovpn' -type f 2>/dev/null | head -20",
        "4a) Locate .ovpn client profile files on server"
    )

    run_ssh(
        "for f in $(sudo find /etc/openvpn /home /root -name '*.ovpn' -type f 2>/dev/null | head -10); do "
        "  echo \"\\n--- $f ---\"; "
        "  sudo grep -E 'redirect-gateway|route |push |ifconfig-push|iroute' \"$f\" 2>/dev/null || echo '(no route/redirect directives)'; "
        "  echo; "
        "done",
        "4b) Route/redirect directives in .ovpn files"
    )

    # 5. Check push directives and route table on the server
    run_ssh(
        "sudo grep -E 'push|route|redirect|client-config|topology|server ' /etc/openvpn/server.conf 2>/dev/null || "
        "sudo grep -E 'push|route|redirect|client-config|topology|server ' /etc/openvpn/server/server.conf 2>/dev/null || "
        "echo 'Could not grep server config'",
        "5) Push/route/redirect directives in server config"
    )

    # 6. Current iptables NAT rules (relevant for split vs full tunnel)
    run_ssh(
        "sudo iptables -t nat -L -n -v 2>/dev/null | head -30",
        "6) iptables NAT rules"
    )

    # 7. IP forwarding status
    run_ssh(
        "sudo sysctl net.ipv4.ip_forward",
        "7) IP forwarding status"
    )

    # 8. OpenVPN status / connected clients
    run_ssh(
        "sudo cat /var/log/openvpn/openvpn-status.log 2>/dev/null || "
        "sudo cat /etc/openvpn/openvpn-status.log 2>/dev/null || "
        "sudo cat /run/openvpn/server.status 2>/dev/null || "
        "sudo cat /tmp/openvpn-status.log 2>/dev/null || "
        "echo 'Status log not found at common paths'",
        "8) OpenVPN status log (connected clients)"
    )

    print(f"\n{'='*70}")
    print("  PROBE COMPLETE")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
