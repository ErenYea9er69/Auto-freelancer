"""
Google Sheets service — reads and writes the lead pipeline spreadsheet.

Sheet layout (row 1 = headers):
  A: Name | B: Email | C: Project Description | D: Budget | E: Timeline
  F: Website | G: Source | H: Status | I: Temperature | J: Created At
  K: Last Contact At | L: Followup Count | M: Proposal Followup Count
  N: Call Date | O: Project Type | P: Proposal Budget | Q: Proposal Timeline
  R: Notes
"""

import gspread
from google.oauth2.service_account import Credentials
from typing import Optional
from datetime import datetime, timedelta
import logging

from app.config import get_settings
from app.models import LeadRecord, LeadStatus

logger = logging.getLogger(__name__)

COLUMNS = {
    "name": 1, "email": 2, "project_description": 3, "budget": 4,
    "timeline": 5, "website": 6, "source": 7, "status": 8,
    "temperature": 9, "created_at": 10, "last_contact_at": 11,
    "followup_count": 12, "proposal_followup_count": 13, "call_date": 14,
    "project_type": 15, "proposal_budget": 16, "proposal_timeline": 17,
    "notes": 18,
}
HEADERS = list(COLUMNS.keys())
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


class SheetsService:
    def __init__(self):
        settings = get_settings()
        creds = Credentials.from_service_account_file(
            settings.google_service_account_file, scopes=SCOPES
        )
        self.client = gspread.authorize(creds)
        self.sheet = self.client.open_by_key(settings.google_sheet_id)
        self._ensure_worksheet()

    def _ensure_worksheet(self):
        try:
            self.ws = self.sheet.worksheet("Leads")
        except gspread.exceptions.WorksheetNotFound:
            self.ws = self.sheet.add_worksheet(title="Leads", rows=1000, cols=20)
            self.ws.update("A1:R1", [HEADERS])
            self.ws.format("A1:R1", {"textFormat": {"bold": True}})
            logger.info("Created 'Leads' worksheet with headers")

    # ── READ ───────────────────────────────────────────────

    def find_lead_by_email(self, email: str) -> Optional[LeadRecord]:
        try:
            cell = self.ws.find(email, in_column=COLUMNS["email"])
            if cell is None:
                return None
            return self._row_to_lead(self.ws.row_values(cell.row), cell.row)
        except gspread.exceptions.CellNotFound:
            return None

    def get_all_leads(self) -> list[LeadRecord]:
        all_rows = self.ws.get_all_values()
        leads = []
        for i, row in enumerate(all_rows[1:], start=2):
            if row and row[0]:
                leads.append(self._row_to_lead(row, i))
        return leads

    def get_leads_by_status(self, status: str) -> list[LeadRecord]:
        return [l for l in self.get_all_leads() if l.status == status]

    def get_leads_needing_followup(self) -> list[LeadRecord]:
        now = datetime.utcnow()
        eligible = []
        for lead in self.get_all_leads():
            if lead.status not in (
                LeadStatus.QUALIFIED_HOT.value,
                LeadStatus.QUALIFIED_WARM.value,
                LeadStatus.FOLLOWUP_1_SENT.value,
            ):
                continue
            if lead.followup_count >= 2 or not lead.last_contact_at:
                continue
            try:
                last = datetime.fromisoformat(lead.last_contact_at)
            except ValueError:
                continue
            if lead.followup_count == 0 and (now - last) >= timedelta(hours=48):
                eligible.append(lead)
            elif lead.followup_count == 1 and (now - last) >= timedelta(days=5):
                eligible.append(lead)
        return eligible

    def get_leads_needing_proposal_followup(self) -> list[LeadRecord]:
        now = datetime.utcnow()
        eligible = []
        for lead in self.get_all_leads():
            if lead.status not in (
                LeadStatus.PROPOSAL_SENT.value,
                LeadStatus.PROPOSAL_FOLLOWUP_1.value,
            ):
                continue
            if lead.proposal_followup_count >= 2 or not lead.last_contact_at:
                continue
            try:
                last = datetime.fromisoformat(lead.last_contact_at)
            except ValueError:
                continue
            if lead.proposal_followup_count == 0 and (now - last) >= timedelta(hours=48):
                eligible.append(lead)
            elif lead.proposal_followup_count == 1 and (now - last) >= timedelta(days=5):
                eligible.append(lead)
        return eligible

    def get_stale_leads(self) -> list[LeadRecord]:
        stale = []
        for lead in self.get_all_leads():
            if lead.status == LeadStatus.FOLLOWUP_2_SENT.value:
                stale.append(lead)
            elif lead.status == LeadStatus.PROPOSAL_FOLLOWUP_2.value:
                stale.append(lead)
        return stale

    # ── WRITE ──────────────────────────────────────────────

    def add_lead(self, lead: LeadRecord) -> LeadRecord:
        self.ws.append_row(self._lead_to_row(lead), value_input_option="USER_ENTERED")
        cell = self.ws.find(lead.email, in_column=COLUMNS["email"])
        lead.row_number = cell.row if cell else None
        logger.info(f"Added lead: {lead.email} at row {lead.row_number}")
        return lead

    def update_lead(self, lead: LeadRecord):
        row_num = lead.row_number
        if not row_num:
            existing = self.find_lead_by_email(lead.email)
            if not existing or not existing.row_number:
                raise ValueError(f"Lead {lead.email} not found in sheet")
            row_num = existing.row_number
        self.ws.update(f"A{row_num}:R{row_num}", [self._lead_to_row(lead)],
                       value_input_option="USER_ENTERED")
        logger.info(f"Updated lead: {lead.email} at row {row_num}")

    def update_field(self, email: str, field: str, value):
        lead = self.find_lead_by_email(email)
        if not lead or not lead.row_number:
            raise ValueError(f"Lead {email} not found")
        col = COLUMNS.get(field)
        if not col:
            raise ValueError(f"Unknown field: {field}")
        self.ws.update_cell(lead.row_number, col, str(value))

    # ── HELPERS ────────────────────────────────────────────

    def _row_to_lead(self, row: list, row_number: int) -> LeadRecord:
        def g(idx):
            try:
                return row[idx] if row[idx] else None
            except IndexError:
                return None
        return LeadRecord(
            name=g(0) or "", email=g(1) or "", project_description=g(2) or "",
            budget=g(3), timeline=g(4), website=g(5), source=g(6),
            status=g(7) or LeadStatus.NEW.value, temperature=g(8),
            created_at=g(9) or datetime.utcnow().isoformat(),
            last_contact_at=g(10), followup_count=int(g(11) or 0),
            proposal_followup_count=int(g(12) or 0), call_date=g(13),
            project_type=g(14), proposal_budget=g(15),
            proposal_timeline=g(16), notes=g(17), row_number=row_number,
        )

    def _lead_to_row(self, lead: LeadRecord) -> list:
        return [
            lead.name, lead.email, lead.project_description,
            lead.budget or "", lead.timeline or "", lead.website or "",
            lead.source or "", lead.status, lead.temperature or "",
            lead.created_at, lead.last_contact_at or "",
            str(lead.followup_count), str(lead.proposal_followup_count),
            lead.call_date or "", lead.project_type or "",
            lead.proposal_budget or "", lead.proposal_timeline or "",
            lead.notes or "",
        ]
