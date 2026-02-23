import logging
from io import BytesIO

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from .config import settings

logger = logging.getLogger(__name__)


def send_ovpn_to_user(
    email: str,
    client_name: str,
    ovpn_bytes: bytes,
    server_name: str,
    password: str | None = None,
) -> dict:
    """Look up a Slack user by email and DM them the .ovpn file.

    Returns {"sent": True} on success, or {"sent": False, "reason": "..."} on
    any failure. Never raises — Slack errors must not block client creation.
    """
    if not settings.slack_bot_token:
        return {"sent": False, "reason": "Slack not configured"}

    try:
        client = WebClient(token=settings.slack_bot_token)

        resp = client.users_lookupByEmail(email=email)
        user_id = resp["user"]["id"]

        dm = client.conversations_open(users=[user_id])
        dm_channel_id = dm["channel"]["id"]

        client.files_upload_v2(
            channel=dm_channel_id,
            file=BytesIO(ovpn_bytes),
            filename=f"{client_name}.ovpn",
            title=f"{client_name}.ovpn",
            initial_comment=(
                f"Your VPN configuration for *{server_name}* is ready.\n"
                f"Import the attached `{client_name}.ovpn` file into your OpenVPN client (preferred Tunnelblink).\n"
                + (f"Your VPN password is: `{password}`\n" if password else "")
                + f"Please follow this guide step by step:\n"
                f"https://www.notion.so/How-to-use-Tunnelblink-14f062605d1a800797d2f1f2ed846b9f"
            ),
        )

        logger.info(f"[slack] Sent .ovpn to {email} (Slack user {user_id})")
        return {"sent": True}

    except SlackApiError as e:
        reason = e.response.get("error", str(e)) if e.response else str(e)
        needed = e.response.get("needed", "") if e.response else ""
        provided = e.response.get("provided", "") if e.response else ""
        if "users_not_found" in reason:
            reason = f"No Slack user found for {email}"
        detail = f"{reason}"
        if needed:
            detail += f" (need: {needed}, have: {provided})"
        logger.warning(f"[slack] Failed to send .ovpn to {email}: {detail}")
        return {"sent": False, "reason": detail}
    except Exception as e:
        logger.warning(f"[slack] Unexpected error sending to {email}: {e}")
        return {"sent": False, "reason": str(e)}
