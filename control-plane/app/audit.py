"""Append-only audit trail of mutating actions.

Every state-changing endpoint records who did what, when, from where. Stored in
the SQLite `audit` table (insert-only) and echoed to stdout as a structured log
so a cluster collector can ship it to Loki/SIEM. Never raises into the request.
"""
import time

from . import db, log


def _source_ip(request) -> str:
    if request is None:
        return ""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def record(principal, action: str, target: str = "", request=None, detail: str = ""):
    who = getattr(principal, "name", "anonymous")
    role = getattr(getattr(principal, "role", None), "value", "")
    ip = _source_ip(request)
    at = int(time.time() * 1000)
    try:
        db.audit_insert(at, who, role, action, target, ip, detail)
    except Exception as e:
        print("audit: persist failed:", e)
    log.info("audit", action=action, principal=who, role=role, target=target, source_ip=ip, detail=detail)


def recent(limit: int = 200):
    try:
        return db.audit_recent(limit)
    except Exception as e:
        print("audit: read failed:", e)
        return []
