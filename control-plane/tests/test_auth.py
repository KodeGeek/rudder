"""API auth: open fallback when unset, Bearer-key enforcement when set, probes open."""
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

from app import auth, config


def _req(path):
    return Request({"type": "http", "method": "GET", "path": path,
                    "headers": [], "query_string": b""})


def _creds(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token) if token else None


def test_open_when_key_unset(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "")
    p = auth.require_auth(_req("/repos"), None)          # no header, no key → allowed
    assert p.role == auth.Role.admin


def test_probe_paths_always_open(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert auth.require_auth(_req("/healthz"), None).name == "probe"
    assert auth.require_auth(_req("/readyz"), None).name == "probe"


def test_valid_key_accepted(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    monkeypatch.setattr(config, "API_KEYS", "")
    p = auth.require_auth(_req("/repos"), _creds("secret"))
    assert p.role == auth.Role.admin and p.name.startswith("apikey")


def test_missing_key_rejected(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    with pytest.raises(HTTPException) as ei:
        auth.require_auth(_req("/repos"), None)
    assert ei.value.status_code == 401


def test_wrong_key_rejected(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    with pytest.raises(HTTPException) as ei:
        auth.require_auth(_req("/repos"), _creds("nope"))
    assert ei.value.status_code == 401


def test_require_role_seam(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "API_KEYS", "")
    dep = auth.require_role(auth.Role.admin)
    # default principal is admin → passes; build it via require_auth
    p = auth.require_auth(_req("/repos"), None)
    assert dep(p).role == auth.Role.admin
    with pytest.raises(HTTPException) as ei:
        auth.require_role(auth.Role.operator)(p)         # admin not in {operator} → 403
    assert ei.value.status_code == 403


def test_multi_key_roles(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "adminkey")
    monkeypatch.setattr(config, "API_KEYS", "opkey:operator, viewkey:viewer")
    assert auth.require_auth(_req("/repos"), _creds("adminkey")).role == auth.Role.admin
    assert auth.require_auth(_req("/repos"), _creds("opkey")).role == auth.Role.operator
    assert auth.require_auth(_req("/repos"), _creds("viewkey")).role == auth.Role.viewer
    with pytest.raises(HTTPException):
        auth.require_auth(_req("/repos"), _creds("bogus"))


def test_viewer_blocked_from_writes(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "API_KEYS", "viewkey:viewer")
    viewer = auth.require_auth(_req("/jobs/x/run"), _creds("viewkey"))
    with pytest.raises(HTTPException) as ei:
        auth.require_role(*auth.WRITERS)(viewer)
    assert ei.value.status_code == 403


def test_proxy_identity_attribution(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "adminkey")
    monkeypatch.setattr(config, "API_KEYS", "")
    req = Request({"type": "http", "method": "GET", "path": "/repos",
                   "headers": [(b"x-auth-request-email", b"alice@corp.com")], "query_string": b""})
    assert auth.require_auth(req, _creds("adminkey")).name == "alice@corp.com"
