"""API authentication: a shared Bearer key guarding every route.

Design (locked with the user): a single ``RUDDER_API_KEY`` is the v1 auth — KISS,
offline-friendly, and enough to make the API safe to expose behind an
authenticating reverse proxy (which supplies real SSO/OIDC). When the key is
unset the API stays open for existing localhost/community installs (with a loud
warning). A ``Role`` seam + ``require_role`` exists now so M4 RBAC can add
operator/viewer without re-touching every endpoint.
"""
import hmac
from enum import Enum

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config

# Probes + API schema stay reachable without a key.
OPEN_PATHS = {"/healthz", "/readyz", "/metrics", "/docs", "/redoc", "/openapi.json"}
_warned = {"done": False}
_bearer = HTTPBearer(auto_error=False)


class Role(str, Enum):
    admin = "admin"
    operator = "operator"
    viewer = "viewer"


class Principal:
    def __init__(self, name: str, role: Role):
        self.name = name
        self.role = role


def _key_map() -> dict:
    """Build {api_key: Role}. RUDDER_API_KEY is an admin key; RUDDER_API_KEYS adds
    'key:role' pairs. Built per-request (cheap) so config changes/tests apply."""
    m = {}
    if config.API_KEY:
        m[config.API_KEY] = Role.admin
    for pair in config.API_KEYS.split(","):
        pair = pair.strip()
        if not pair or ":" not in pair:
            continue
        k, _, r = pair.partition(":")
        k = k.strip()
        if not k:                       # never register an empty key
            continue
        try:
            m[k] = Role(r.strip())
        except ValueError:
            pass
    return m


def _proxy_identity(request: Request) -> str:
    """Identity from an upstream auth proxy (oauth2-proxy etc.) for attribution."""
    return (request.headers.get("x-auth-request-email")
            or request.headers.get("x-forwarded-user")
            or request.headers.get("x-forwarded-email") or "")


def require_auth(request: Request,
                 creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> Principal:
    if request.url.path in OPEN_PATHS:
        return Principal("probe", Role.admin)
    keys = _key_map()
    who = _proxy_identity(request)
    if not keys:
        if not _warned["done"]:
            print("auth: no API key configured — the API is UNAUTHENTICATED. "
                  "Set RUDDER_API_KEY (from a Secret) before exposing Rudder beyond localhost.")
            _warned["done"] = True
        return Principal(who or "anonymous", Role.admin)
    token = creds.credentials if creds else ""
    role = None
    for k, r in keys.items():
        if token and hmac.compare_digest(token, k):
            role = r
            break
    if role is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="invalid or missing API key",
                            headers={"WWW-Authenticate": "Bearer"})
    return Principal(who or ("apikey:" + role.value), role)


WRITERS = (Role.admin, Role.operator)    # run, reconcile, connect repos
ADMINS = (Role.admin,)                   # secrets + destructive actions


def require_role(*roles: Role):
    def dep(principal: Principal = Depends(require_auth)) -> Principal:
        if principal.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="insufficient role for this action")
        return principal
    return dep
