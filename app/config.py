"""
Centralised configuration loaded from environment variables / .env file.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


class Settings(BaseSettings):
    # ── Claude AI ───────────────────────────────────────────
    anthropic_api_key: str = Field(..., description="Anthropic API key")
    claude_model: str = Field("claude-sonnet-4-20250514", description="Claude model to use")

    # ── Resend Email ────────────────────────────────────────
    resend_api_key: str = Field(..., description="Resend API key")
    from_email: str = Field("hello@yourdomain.com", description="Sender email")
    from_name: str = Field("Your Business", description="Sender display name")

    # ── Google Sheets ───────────────────────────────────────
    google_service_account_file: str = Field("service_account.json", description="Path to Google SA key")
    google_sheet_id: str = Field(..., description="Google Sheet ID or URL")

    # ── Freelancer Profile ──────────────────────────────────
    freelancer_name: str = Field("Alex", description="Freelancer first name")
    freelancer_business: str = Field("Alex Design Studio", description="Business name")
    freelancer_services: str = Field("web design, brand identity, UI/UX", description="Comma-separated services")
    calendar_link: str = Field("https://calendly.com/your-link", description="Booking link")
    portfolio_url: str = Field("https://yourportfolio.com", description="Portfolio URL")

    # ── Webhook Security ────────────────────────────────────
    webhook_secret: str = Field("change-me", description="Shared secret for webhook auth")

    # ── Server ──────────────────────────────────────────────
    host: str = Field("0.0.0.0")
    port: int = Field(8000)

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }


@lru_cache()
def get_settings() -> Settings:
    """Return a cached Settings instance (read once at startup)."""
    return Settings()
