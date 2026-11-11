import hashlib
import secrets
from datetime import date, timedelta

from django.db.models import Count, Q
from django.utils import timezone

from .models import AuditEvent, CaptureSession, Goal, Record, User


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def invite_token():
    return secrets.token_urlsafe(32)


def audit(actor, entity, entity_id, action, metadata=None):
    AuditEvent.objects.create(actor=actor, entity=entity, entity_id=entity_id, action=action, metadata=metadata or {})


def visible_records(user):
    qs = Record.objects.select_related("capturer", "manager", "capture_session").prefetch_related("versions__changed_by")
    if user.role == User.Role.CAPTURER:
        return qs.filter(capturer=user)
    if user.role == User.Role.MANAGER:
        return qs.filter(manager=user)
    return qs


def apply_record_filters(qs, params):
    query = (params.get("q") or "").strip()
    if query:
        qs = qs.filter(Q(first_name__icontains=query) | Q(paternal_surname__icontains=query) | Q(maternal_surname__icontains=query) | Q(phone__icontains=query) | Q(electoral_key__icontains=query) | Q(address__icontains=query))
    for key in ("address", "district", "neighborhood", "postal_code", "section_code", "leadership_name", "status"):
        if params.get(key):
            qs = qs.filter(**{f"{key}__iexact": params[key]})
    for key in ("date_from", "date_to"):
        if params.get(key):
            field = "created_at__date__gte" if key == "date_from" else "created_at__date__lte"
            qs = qs.filter(**{field: params[key]})
    if params.get("capturer_id"):
        qs = qs.filter(capturer_id=params["capturer_id"])
    if params.get("manager_id"):
        qs = qs.filter(manager_id=params["manager_id"])
    return qs


def period_bounds(period, on_date=None):
    on_date = on_date or timezone.localdate()
    if period == Goal.Period.DAILY:
        return on_date, on_date
    if period == Goal.Period.WEEKLY:
        start = on_date - timedelta(days=on_date.weekday())
        return start, start + timedelta(days=6)
    start = on_date.replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, next_month - timedelta(days=1)


def progress_for_goal(goal, today=None):
    today = today or timezone.localdate()
    period_start, period_end = period_bounds(goal.period_type, today)
    start, end = max(goal.starts_on, period_start), min(goal.ends_on, period_end, today)
    qs = Record.objects.filter(manager=goal.manager, status=Record.Status.ACTIVE)
    if goal.capturer_id:
        qs = qs.filter(capturer_id=goal.capturer_id)
    count = qs.filter(created_at__date__gte=start, created_at__date__lte=end).count() if end >= start else 0
    return {"count": count, "target": goal.target_count, "percentage": min(100, round(count * 100 / max(goal.target_count, 1))), "status": "complete" if count >= goal.target_count else "in_progress"}


def dashboard_counts(records):
    today = timezone.localdate()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    return {
        "total_records": records.count(),
        "records_today": records.filter(created_at__date=today).count(),
        "records_week": records.filter(created_at__date__gte=week_start).count(),
        "records_month": records.filter(created_at__date__gte=month_start).count(),
    }
