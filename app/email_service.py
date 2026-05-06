"""
Resend email service — sends all outbound emails.
"""

import resend
import logging
from app.config import get_settings

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self):
        settings = get_settings()
        resend.api_key = settings.resend_api_key
        self.from_email = settings.from_email
        self.from_name = settings.from_name

    def send(self, to: str, subject: str, body: str, reply_to: str = None) -> dict:
        """
        Send an email via Resend.
        Body is treated as plain text but can contain light HTML.
        """
        # Convert newlines to <br> for HTML rendering
        html_body = body.replace("\n", "<br>")

        params = {
            "from": f"{self.from_name} <{self.from_email}>",
            "to": [to],
            "subject": subject,
            "html": html_body,
        }
        if reply_to:
            params["reply_to"] = reply_to

        try:
            result = resend.Emails.send(params)
            logger.info(f"Email sent to {to}: {subject} (id: {result.get('id', 'unknown')})")
            return {"success": True, "id": result.get("id")}
        except Exception as e:
            logger.error(f"Email send failed to {to}: {e}")
            return {"success": False, "error": str(e)}
