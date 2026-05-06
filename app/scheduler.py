"""
APScheduler setup — runs daily cron jobs for follow-ups and stale-lead flagging.
"""

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import logging

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def _run_followups():
    """Job: send follow-up emails to unresponsive leads."""
    from app.pipeline import Pipeline
    try:
        pipeline = Pipeline()
        results = pipeline.run_followups()
        logger.info(f"Follow-up job complete: {len(results)} processed")
    except Exception as e:
        logger.error(f"Follow-up job error: {e}", exc_info=True)


def _run_proposal_followups():
    """Job: send proposal follow-ups."""
    from app.pipeline import Pipeline
    try:
        pipeline = Pipeline()
        results = pipeline.run_proposal_followups()
        logger.info(f"Proposal follow-up job complete: {len(results)} processed")
    except Exception as e:
        logger.error(f"Proposal follow-up job error: {e}", exc_info=True)


def _flag_stale():
    """Job: flag stale leads for human review."""
    from app.pipeline import Pipeline
    try:
        pipeline = Pipeline()
        results = pipeline.flag_stale_leads()
        logger.info(f"Stale-lead job complete: {len(results)} flagged")
    except Exception as e:
        logger.error(f"Stale-lead job error: {e}", exc_info=True)


def start_scheduler():
    """Register all cron jobs and start the scheduler."""

    # Run follow-ups every day at 9:00 AM UTC
    scheduler.add_job(
        _run_followups,
        trigger=CronTrigger(hour=9, minute=0),
        id="followup_job",
        name="Daily lead follow-ups",
        replace_existing=True,
    )

    # Run proposal follow-ups every day at 9:30 AM UTC
    scheduler.add_job(
        _run_proposal_followups,
        trigger=CronTrigger(hour=9, minute=30),
        id="proposal_followup_job",
        name="Daily proposal follow-ups",
        replace_existing=True,
    )

    # Flag stale leads every day at 10:00 AM UTC
    scheduler.add_job(
        _flag_stale,
        trigger=CronTrigger(hour=10, minute=0),
        id="stale_flag_job",
        name="Daily stale lead flagging",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Scheduler started — 3 daily jobs registered")


def stop_scheduler():
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler stopped")
