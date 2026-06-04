"""Minimal structured (JSON-line) logging to stdout.

12-factor: emit one JSON object per line; a cluster log collector ships it. Used
for the operationally important events (run lifecycle, reconcile, boot) where a
correlation id (run_id) and fields matter. Plain print() remains elsewhere.
"""
import json
import sys
import time


def _emit(level: str, msg: str, fields: dict):
    rec = {"ts": round(time.time(), 3), "level": level, "msg": msg}
    rec.update(fields)
    try:
        sys.stdout.write(json.dumps(rec, default=str) + "\n")
        sys.stdout.flush()
    except Exception:
        print(level, msg, fields)


def info(msg: str, **fields):
    _emit("info", msg, fields)


def warn(msg: str, **fields):
    _emit("warn", msg, fields)


def error(msg: str, **fields):
    _emit("error", msg, fields)
