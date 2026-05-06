"""
Claude AI service — generates all personalized emails, qualifies leads,
and writes proposals using the Anthropic API.
"""

import anthropic
import json
import logging
from app.config import get_settings
from app.models import LeadRecord

logger = logging.getLogger(__name__)


class AIService:
    def __init__(self):
        settings = get_settings()
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.model = settings.claude_model
        self.settings = settings

    def _call(self, system: str, user: str, max_tokens: int = 1500) -> str:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return response.content[0].text

    # ── LEAD QUALIFICATION ─────────────────────────────────

    def qualify_lead(self, lead: LeadRecord) -> dict:
        """
        Analyse the inquiry and return:
          { "temperature": "hot"|"warm"|"cold", "reasoning": "...",
            "qualifying_question": "..." (only if warm) }
        """
        system = (
            "You are a lead-qualification assistant for a freelance business. "
            "Analyse the prospect's inquiry and classify their temperature.\n\n"
            "HOT = clear project, mentions budget/timeline, ready to start soon.\n"
            "WARM = interested but vague — needs one clarifying question.\n"
            "COLD = spam, irrelevant, or clearly not a fit.\n\n"
            "Return ONLY valid JSON with keys: temperature, reasoning, "
            "qualifying_question (null if hot or cold)."
        )
        user = (
            f"Name: {lead.name}\n"
            f"Project: {lead.project_description}\n"
            f"Budget: {lead.budget or 'Not specified'}\n"
            f"Timeline: {lead.timeline or 'Not specified'}\n"
            f"Website: {lead.website or 'None'}"
        )
        raw = self._call(system, user, max_tokens=500)
        try:
            # Strip markdown fencing if present
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning(f"AI qualification parse error: {raw}")
            return {"temperature": "warm", "reasoning": "Parse error — defaulting to warm",
                    "qualifying_question": "Could you tell me more about the scope and timeline?"}

    # ── ACKNOWLEDGMENT EMAIL ───────────────────────────────

    def write_acknowledgment(self, lead: LeadRecord, temperature: str,
                             qualifying_question: str = None) -> dict:
        """
        Write the first response email. Returns { "subject": "...", "body": "..." }
        """
        calendar_line = ""
        if temperature == "hot":
            calendar_line = (
                f"Include a line inviting them to book a call: {self.settings.calendar_link}"
            )
        question_line = ""
        if temperature == "warm" and qualifying_question:
            question_line = (
                f"End with this qualifying question naturally woven in: {qualifying_question}"
            )

        system = (
            f"You are {self.settings.freelancer_name} from {self.settings.freelancer_business}. "
            f"Services: {self.settings.freelancer_services}. "
            f"Portfolio: {self.settings.portfolio_url}\n\n"
            "Write a warm, personalized acknowledgment email to a prospect who just submitted "
            "an inquiry. Reference their SPECIFIC project. Be conversational, not corporate. "
            "Keep it under 150 words. No subject line in the body.\n"
            f"{calendar_line}\n{question_line}\n\n"
            "Return ONLY valid JSON: {\"subject\": \"...\", \"body\": \"...\"}"
        )
        user = (
            f"Prospect name: {lead.name}\n"
            f"Their project: {lead.project_description}\n"
            f"Budget: {lead.budget or 'not mentioned'}\n"
            f"Timeline: {lead.timeline or 'not mentioned'}"
        )
        raw = self._call(system, user, max_tokens=800)
        return self._parse_email_json(raw)

    # ── FOLLOW-UP EMAILS ───────────────────────────────────

    def write_followup(self, lead: LeadRecord, followup_number: int) -> dict:
        """
        Write follow-up #1 (48h) or #2 (day 5). Adds value — never "just checking in."
        """
        system = (
            f"You are {self.settings.freelancer_name} from {self.settings.freelancer_business}. "
            f"Write follow-up email #{followup_number} to a prospect who hasn't responded.\n\n"
            "Rules:\n"
            "- NEVER say 'just checking in' or 'following up'\n"
            "- Add genuine value: share an insight, a relevant example, or a thought about "
            "their project\n"
            "- Reference their specific project naturally\n"
            "- Keep it under 120 words\n"
            f"- Include calendar link if relevant: {self.settings.calendar_link}\n"
            "- If this is follow-up #2, make it clear this is your last outreach — no pressure\n\n"
            "Return ONLY valid JSON: {\"subject\": \"...\", \"body\": \"...\"}"
        )
        user = (
            f"Prospect: {lead.name}\n"
            f"Original project: {lead.project_description}\n"
            f"Budget: {lead.budget or 'not mentioned'}\n"
            f"Follow-up number: {followup_number}"
        )
        raw = self._call(system, user, max_tokens=800)
        return self._parse_email_json(raw)

    # ── PROPOSAL ───────────────────────────────────────────

    def write_proposal(self, lead: LeadRecord) -> dict:
        """
        Generate a professional proposal email after the sales call.
        """
        system = (
            f"You are {self.settings.freelancer_name} from {self.settings.freelancer_business}. "
            "Write a professional proposal email after a sales call.\n\n"
            "Include:\n"
            "- Brief recap of what was discussed\n"
            "- Clear scope of work based on the project type\n"
            "- Investment / pricing\n"
            "- Timeline with milestones\n"
            "- Simple next step to accept\n\n"
            "Be confident and professional. Under 300 words.\n\n"
            "Return ONLY valid JSON: {\"subject\": \"...\", \"body\": \"...\"}"
        )
        user = (
            f"Client: {lead.name}\n"
            f"Original inquiry: {lead.project_description}\n"
            f"Project type: {lead.project_type}\n"
            f"Budget: {lead.proposal_budget}\n"
            f"Timeline: {lead.proposal_timeline}\n"
            f"Notes: {lead.notes or 'None'}"
        )
        raw = self._call(system, user, max_tokens=1200)
        return self._parse_email_json(raw)

    # ── PROPOSAL FOLLOW-UP ─────────────────────────────────

    def write_proposal_followup(self, lead: LeadRecord, followup_number: int) -> dict:
        system = (
            f"You are {self.settings.freelancer_name}. Write proposal follow-up "
            f"#{followup_number}.\n"
            "- Add value, don't just ask if they've reviewed it\n"
            "- Under 100 words\n"
            "- If #2, make it warm and final — no pressure\n\n"
            "Return ONLY valid JSON: {\"subject\": \"...\", \"body\": \"...\"}"
        )
        user = (
            f"Client: {lead.name}\n"
            f"Project: {lead.project_type}\n"
            f"Budget: {lead.proposal_budget}"
        )
        raw = self._call(system, user, max_tokens=600)
        return self._parse_email_json(raw)

    # ── ONBOARDING EMAIL ───────────────────────────────────

    def write_onboarding(self, lead: LeadRecord) -> dict:
        system = (
            f"You are {self.settings.freelancer_name} from {self.settings.freelancer_business}. "
            "Write a warm welcome/onboarding email for a client who just signed.\n\n"
            "Include:\n"
            "- Excitement about working together\n"
            "- What happens next (intake form, first-week schedule)\n"
            "- Any immediate action items for the client\n\n"
            "Under 200 words. Professional but warm.\n\n"
            "Return ONLY valid JSON: {\"subject\": \"...\", \"body\": \"...\"}"
        )
        user = (
            f"Client: {lead.name}\n"
            f"Project: {lead.project_type}\n"
            f"Timeline: {lead.proposal_timeline}"
        )
        raw = self._call(system, user, max_tokens=800)
        return self._parse_email_json(raw)

    # ── HELPER ─────────────────────────────────────────────

    def _parse_email_json(self, raw: str) -> dict:
        try:
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning(f"AI email parse error, using raw text")
            return {"subject": "Following up on your project",
                    "body": raw}
