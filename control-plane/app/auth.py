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
OPEN_PATHS = {"/healthz", "/readyz", "/docs", "/redoc", "/openapi.json"}
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


def require_auth(request: Request,
                 creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> Principal:
    if request.url.path in OPEN_PATHS:
        return Principal("probe", Role.admin)
    key = config.API_KEY
    if not key:
        if not _warned["done"]:
            print("auth: RUDDER_API_KEY is unset — the API is UNAUTHENTICATED. "
                  "Set it (from a Secret) before exposing Rudder beyond localhost.")
            _warned["done"] = True
        return Principal("anonymous", Role.admin)
    token = creds.credentials if creds else ""
    if not token or not hmac.compare_digest(token, key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="invalid or missing API key",
                            headers={"WWW-Authenticate": "Bearer"})
    return Principal("apikey", Role.admin)


def require_role(*roles: Role):
    """Seam for M4 RBAC — every principal is admin today."""
    def dep(principal: Principal = Depends(require_auth)) -> Principal:
        if principal.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="insufficient role")
        return principal
    return dep
