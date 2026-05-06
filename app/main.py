"""
FastAPI application — webhook endpoints and manual triggers
for the AI Lead-to-Contract Pipeline.
"""

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
import logging
import hmac
import hashlib

from app.config import get_settings
from app.models import (
    InquiryWebhook, PostCallInput, DealSignedInput,
    CallBookedInput, PipelineResponse,
)
from app.pipeline import Pipeline
from app.scheduler import start_scheduler, stop_scheduler

# ── Logging ────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-20s │ %(levelname)-7s │ %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan (startup / shutdown) ─────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting AI Lead Pipeline...")
    start_scheduler()
    yield
    logger.info("Shutting down...")
    stop_scheduler()


# ── App ────────────────────────────────────────────────────
app = FastAPI(
    title="AI Lead-to-Contract Pipeline",
    description="Automated client acquisition for freelancers",
    version="1.0.0",
    lifespan=lifespan,
)

# Create static directory if it doesn't exist
os.makedirs("static", exist_ok=True)

# Mount static files
app.mount("/assets", StaticFiles(directory="static"), name="assets")


# ── Auth helper ────────────────────────────────────────────
def verify_webhook_secret(secret: str = Header(None, alias="X-Webhook-Secret")):
    settings = get_settings()
    if settings.webhook_secret == "change-me":
        return  # Skip auth in dev if not configured
    if not secret or not hmac.compare_digest(secret, settings.webhook_secret):
        raise HTTPException(status_code=401, detail="Invalid webhook secret")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  WEBHOOK ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/webhook/inquiry", response_model=PipelineResponse,
          summary="New lead inquiry form submission")
async def webhook_inquiry(
    inquiry: InquiryWebhook,
    x_webhook_secret: str = Header(None),
):
    """
    Triggered when a prospect submits the contact form.
    Qualifies the lead, sends AI-written acknowledgment in <2 min.
    """
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    result = pipeline.handle_new_inquiry(inquiry)
    return PipelineResponse(**result)


@app.post("/webhook/call-booked", response_model=PipelineResponse,
          summary="Calendar booking webhook")
async def webhook_call_booked(
    data: CallBookedInput,
    x_webhook_secret: str = Header(None),
):
    """Triggered when a prospect books a call via Calendly etc."""
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    result = pipeline.handle_call_booked(data.lead_email, data.call_date)
    return PipelineResponse(**result)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  FREELANCER ACTION ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/action/post-call", response_model=PipelineResponse,
          summary="Submit post-call details → generates proposal")
async def action_post_call(
    data: PostCallInput,
    x_webhook_secret: str = Header(None),
):
    """
    Freelancer fills in 3 fields after the sales call.
    System generates and sends a professional proposal within minutes.
    """
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    result = pipeline.handle_post_call(data)
    return PipelineResponse(**result)


@app.post("/action/deal-signed", response_model=PipelineResponse,
          summary="Mark a deal as signed → triggers onboarding")
async def action_deal_signed(
    data: DealSignedInput,
    x_webhook_secret: str = Header(None),
):
    """
    Freelancer marks the deal as won.
    System sends welcome email, intake form, and first-week schedule.
    """
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    result = pipeline.handle_deal_signed(data.lead_email)
    return PipelineResponse(**result)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  MANUAL TRIGGERS (for testing / admin)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/admin/run-followups", summary="Manually trigger follow-up job")
async def admin_run_followups(x_webhook_secret: str = Header(None)):
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    results = pipeline.run_followups()
    return {"processed": len(results), "results": results}


@app.post("/admin/run-proposal-followups",
          summary="Manually trigger proposal follow-up job")
async def admin_run_proposal_followups(x_webhook_secret: str = Header(None)):
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    results = pipeline.run_proposal_followups()
    return {"processed": len(results), "results": results}


@app.post("/admin/flag-stale", summary="Manually flag stale leads")
async def admin_flag_stale(x_webhook_secret: str = Header(None)):
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    results = pipeline.flag_stale_leads()
    return {"flagged": len(results), "results": results}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  STATUS / HEALTH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.get("/", summary="Health check")
async def health():
    return {
        "status": "running",
        "service": "AI Lead-to-Contract Pipeline",
        "version": "1.0.0",
    }


@app.get("/dashboard", summary="UI Dashboard")
async def dashboard():
    return FileResponse("static/index.html")


@app.get("/leads", summary="View all leads in the pipeline")
async def get_leads(x_webhook_secret: str = Header(None)):
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    leads = pipeline.sheets.get_all_leads()
    return {
        "total": len(leads),
        "leads": [lead.model_dump(exclude={"row_number"}) for lead in leads],
    }


@app.get("/leads/{email}", summary="View a single lead")
async def get_lead(email: str, x_webhook_secret: str = Header(None)):
    verify_webhook_secret(x_webhook_secret)
    pipeline = Pipeline()
    lead = pipeline.sheets.find_lead_by_email(email)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead.model_dump(exclude={"row_number"})


# ── Exception handler ─────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": f"Internal error: {str(exc)}"},
    )


# ── Entrypoint ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
