"""
Core pipeline logic — orchestrates the lead lifecycle.
Each method handles one stage of the pipeline.
"""

from datetime import datetime
import logging

from app.sheets import SheetsService
from app.ai_service import AIService
from app.email_service import EmailService
from app.models import LeadRecord, LeadStatus, InquiryWebhook, PostCallInput

logger = logging.getLogger(__name__)


class Pipeline:
    def __init__(self):
        self.sheets = SheetsService()
        self.ai = AIService()
        self.email = EmailService()

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  STAGE 1 — New inquiry arrives
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def handle_new_inquiry(self, inquiry: InquiryWebhook) -> dict:
        """
        1. Check for duplicate
        2. Add lead to sheet
        3. Qualify with AI
        4. Send personalized acknowledgment
        5. Update sheet with status + temperature
        """
        # Duplicate check
        existing = self.sheets.find_lead_by_email(inquiry.email)
        if existing:
            logger.warning(f"Duplicate inquiry from {inquiry.email}")
            return {"success": False, "message": "Lead already exists",
                    "lead_email": inquiry.email, "status": existing.status}

        # Create lead record
        now = datetime.utcnow().isoformat()
        lead = LeadRecord(
            name=inquiry.name,
            email=inquiry.email,
            project_description=inquiry.project_description,
            budget=inquiry.budget,
            timeline=inquiry.timeline,
            website=inquiry.website,
            source=inquiry.source,
            status=LeadStatus.NEW.value,
            created_at=now,
            last_contact_at=now,
        )
        lead = self.sheets.add_lead(lead)

        # AI qualification
        qualification = self.ai.qualify_lead(lead)
        temperature = qualification.get("temperature", "warm")
        qualifying_question = qualification.get("qualifying_question")

        # Update temperature
        lead.temperature = temperature
        logger.info(f"Lead {lead.email} qualified as {temperature}: "
                    f"{qualification.get('reasoning', '')[:80]}")

        # Handle cold leads — archive immediately
        if temperature == "cold":
            lead.status = LeadStatus.ARCHIVED.value
            self.sheets.update_lead(lead)
            logger.info(f"Cold lead {lead.email} archived")
            return {"success": True, "message": "Lead archived (cold)",
                    "lead_email": lead.email, "status": lead.status}

        # Generate acknowledgment email
        email_content = self.ai.write_acknowledgment(
            lead, temperature, qualifying_question
        )

        # Send email
        result = self.email.send(
            to=lead.email,
            subject=email_content["subject"],
            body=email_content["body"],
        )

        # Update lead status
        if temperature == "hot":
            lead.status = LeadStatus.QUALIFIED_HOT.value
        else:
            lead.status = LeadStatus.QUALIFIED_WARM.value
        lead.last_contact_at = datetime.utcnow().isoformat()
        self.sheets.update_lead(lead)

        return {"success": True,
                "message": f"Lead qualified as {temperature}, acknowledgment sent",
                "lead_email": lead.email, "status": lead.status}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  STAGE 2 — Follow-up (called by scheduler)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def run_followups(self) -> list[dict]:
        """Process all leads needing a follow-up email."""
        results = []
        leads = self.sheets.get_leads_needing_followup()
        logger.info(f"Found {len(leads)} leads needing follow-up")

        for lead in leads:
            followup_num = lead.followup_count + 1
            try:
                email_content = self.ai.write_followup(lead, followup_num)
                self.email.send(to=lead.email,
                                subject=email_content["subject"],
                                body=email_content["body"])

                lead.followup_count = followup_num
                lead.last_contact_at = datetime.utcnow().isoformat()
                if followup_num == 1:
                    lead.status = LeadStatus.FOLLOWUP_1_SENT.value
                else:
                    lead.status = LeadStatus.FOLLOWUP_2_SENT.value
                self.sheets.update_lead(lead)

                results.append({"email": lead.email, "followup": followup_num,
                                "success": True})
            except Exception as e:
                logger.error(f"Follow-up failed for {lead.email}: {e}")
                results.append({"email": lead.email, "error": str(e),
                                "success": False})

        return results

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  STAGE 3 — Call booked
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def handle_call_booked(self, email: str, call_date: str = None) -> dict:
        lead = self.sheets.find_lead_by_email(email)
        if not lead:
            return {"success": False, "message": "Lead not found"}

        lead.status = LeadStatus.CALL_BOOKED.value
        lead.call_date = call_date or datetime.utcnow().isoformat()
        lead.last_contact_at = datetime.utcnow().isoformat()
        self.sheets.update_lead(lead)

        return {"success": True, "message": "Call booked",
                "lead_email": email, "status": lead.status}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  STAGE 4 — Post-call → Generate & send proposal
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def handle_post_call(self, data: PostCallInput) -> dict:
        lead = self.sheets.find_lead_by_email(data.lead_email)
        if not lead:
            return {"success": False, "message": "Lead not found"}

        # Store call details
        lead.status = LeadStatus.CALL_COMPLETED.value
        lead.project_type = data.project_type
        lead.proposal_budget = data.budget
        lead.proposal_timeline = data.timeline
        lead.notes = data.notes
        self.sheets.update_lead(lead)

        # Generate proposal with AI
        email_content = self.ai.write_proposal(lead)

        # Send proposal
        self.email.send(to=lead.email,
                        subject=email_content["subject"],
                        body=email_content["body"])

        # Update status
        lead.status = LeadStatus.PROPOSAL_SENT.value
        lead.last_contact_at = datetime.utcnow().isoformat()
        lead.proposal_followup_count = 0
        self.sheets.update_lead(lead)

        return {"success": True, "message": "Proposal generated and sent",
                "lead_email": lead.email, "status": lead.status}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  STAGE 5 — Proposal follow-ups (called by scheduler)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def run_proposal_followups(self) -> list[dict]:
        results = []
        leads = self.sheets.get_leads_needing_proposal_followup()
        logger.info(f"Found {len(leads)} leads needing proposal follow-up")

        for lead in leads:
            followup_num = lead.proposal_followup_count + 1
            try:
                email_content = self.ai.write_proposal_followup(lead, followup_num)
                self.email.send(to=lead.email,
                                subject=email_content["subject"],
                                body=email_content["body"])

                lead.proposal_followup_count = followup_num
                lead.last_contact_at = datetime.utcnow().isoformat()
                if followup_num == 1:
                    lead.status = LeadStatus.PROPOSAL_FOLLOWUP_1.value
                else:
                    lead.status = LeadStatus.PROPOSAL_FOLLOWUP_2.value
                self.sheets.update_lead(lead)

                results.append({"email": lead.email, "followup": followup_num,
                                "success": True})
            except Exception as e:
                logger.error(f"Proposal follow-up failed for {lead.email}: {e}")
                results.append({"email": lead.email, "error": str(e),
                                "success": False})

        return results

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  STAGE 6 — Deal signed → Onboarding
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def handle_deal_signed(self, email: str) -> dict:
        lead = self.sheets.find_lead_by_email(email)
        if not lead:
            return {"success": False, "message": "Lead not found"}

        lead.status = LeadStatus.SIGNED.value
        self.sheets.update_lead(lead)

        # Generate and send onboarding email
        email_content = self.ai.write_onboarding(lead)
        self.email.send(to=lead.email,
                        subject=email_content["subject"],
                        body=email_content["body"])

        lead.status = LeadStatus.ONBOARDED.value
        lead.last_contact_at = datetime.utcnow().isoformat()
        self.sheets.update_lead(lead)

        return {"success": True, "message": "Deal signed — onboarding email sent",
                "lead_email": email, "status": lead.status}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  STAGE 7 — Flag stale leads (called by scheduler)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def flag_stale_leads(self) -> list[dict]:
        results = []
        stale = self.sheets.get_stale_leads()
        logger.info(f"Found {len(stale)} stale leads to flag")

        for lead in stale:
            lead.status = LeadStatus.HUMAN_REVIEW.value
            self.sheets.update_lead(lead)
            results.append({"email": lead.email, "status": "human_review"})

        return results
