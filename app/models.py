"""
Pydantic models for webhook payloads, internal state, and API responses.
"""

from pydantic import BaseModel, Field, EmailStr
from typing import Optional
from enum import Enum
from datetime import datetime


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Enums
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class LeadStatus(str, Enum):
    NEW = "new"
    QUALIFIED_HOT = "qualified_hot"
    QUALIFIED_WARM = "qualified_warm"
    QUALIFIED_COLD = "qualified_cold"
    FOLLOWUP_1_SENT = "followup_1_sent"
    FOLLOWUP_2_SENT = "followup_2_sent"
    CALL_BOOKED = "call_booked"
    CALL_COMPLETED = "call_completed"
    PROPOSAL_SENT = "proposal_sent"
    PROPOSAL_FOLLOWUP_1 = "proposal_followup_1"
    PROPOSAL_FOLLOWUP_2 = "proposal_followup_2"
    SIGNED = "signed"
    ONBOARDED = "onboarded"
    ARCHIVED = "archived"
    HUMAN_REVIEW = "human_review"


class LeadTemperature(str, Enum):
    HOT = "hot"
    WARM = "warm"
    COLD = "cold"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Webhook Payloads (inbound)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class InquiryWebhook(BaseModel):
    """Payload from the contact / inquiry form."""
    name: str = Field(..., min_length=1, description="Prospect's full name")
    email: str = Field(..., description="Prospect's email address")
    project_description: str = Field(..., min_length=10, description="What they need help with")
    budget: Optional[str] = Field(None, description="Budget range if provided")
    timeline: Optional[str] = Field(None, description="Desired timeline")
    website: Optional[str] = Field(None, description="Their current website")
    source: Optional[str] = Field(None, description="How they found you")


class PostCallInput(BaseModel):
    """Freelancer fills this in after the sales call."""
    lead_email: str = Field(..., description="Which lead this is for")
    project_type: str = Field(..., description="e.g. Full brand identity")
    budget: str = Field(..., description="e.g. $3,500")
    timeline: str = Field(..., description="e.g. 4 weeks")
    notes: Optional[str] = Field(None, description="Any extra context")


class DealSignedInput(BaseModel):
    """Freelancer marks a deal as signed."""
    lead_email: str = Field(..., description="Which lead signed")


class CallBookedInput(BaseModel):
    """Webhook or manual trigger when a call is booked."""
    lead_email: str = Field(..., description="Which lead booked")
    call_date: Optional[str] = Field(None, description="When the call is scheduled")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Internal Lead Record  (mirrors one row in Google Sheets)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class LeadRecord(BaseModel):
    """Represents one row in the Leads sheet."""
    name: str
    email: str
    project_description: str
    budget: Optional[str] = None
    timeline: Optional[str] = None
    website: Optional[str] = None
    source: Optional[str] = None
    status: str = LeadStatus.NEW.value
    temperature: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    last_contact_at: Optional[str] = None
    followup_count: int = 0
    proposal_followup_count: int = 0
    call_date: Optional[str] = None
    project_type: Optional[str] = None
    proposal_budget: Optional[str] = None
    proposal_timeline: Optional[str] = None
    notes: Optional[str] = None
    row_number: Optional[int] = None  # For sheet updates (not stored in sheet)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  API Responses
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class PipelineResponse(BaseModel):
    success: bool
    message: str
    lead_email: Optional[str] = None
    status: Optional[str] = None
