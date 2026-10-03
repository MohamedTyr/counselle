"""Google's verified OIDC identity; provider tokens never enter our database."""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass
from functools import partial
from typing import Any

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.id_token import verify_oauth2_token
from pydantic import EmailStr, TypeAdapter, ValidationError

_EMAIL = TypeAdapter(EmailStr)


class GoogleFlowError(Exception):
    """A fixed, non-sensitive error code safe to show in the callback URL."""

    def __init__(self, code: str = "oauth_failed") -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    email_authoritative: bool
    authenticated_at: int | None

    @property
    def account_ids(self) -> tuple[str, str]:
        # People API people.get documents people/{account_id}; Google OIDC
        # documents sub as the Google Account ID. Preserve existing mappings
        # from httpx-oauth's People API without ever matching on email.
        # https://developers.google.com/people/api/rest/v1/people/get
        return self.subject, f"people/{self.subject}"

    def recently_authenticated(self, max_age: int) -> bool:
        timestamp = self.authenticated_at
        return timestamp is not None and 0 <= time.time() - timestamp <= max_age


def identity_from_claims(claims: dict[str, Any], nonce: str) -> GoogleIdentity:
    """Validate claims after Google's library verifies signature/audience/expiry."""
    claimed_nonce = claims.get("nonce")
    subject = claims.get("sub")
    if (
        not isinstance(claimed_nonce, str)
        or not secrets.compare_digest(claimed_nonce, nonce)
        or not isinstance(subject, str)
        or not subject.isascii()
        or not subject.isdigit()
        or len(subject) > 255
        or claims.get("email_verified") is not True
    ):
        raise GoogleFlowError()
    try:
        email = str(_EMAIL.validate_python(claims.get("email")))
    except ValidationError as exc:
        raise GoogleFlowError() from exc
    auth_time = claims.get("auth_time")
    if type(auth_time) is not int or auth_time < 0 or auth_time > time.time():
        auth_time = None
    # Google's verified email can be stale for non-Google-hosted inboxes.
    # https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
    authoritative = email.rsplit("@", 1)[1].lower() in {"gmail.com", "googlemail.com"}
    authoritative = authoritative or bool(claims.get("hd"))
    return GoogleIdentity(subject, email, authoritative, auth_time)


async def verify_google_identity(
    token: dict[str, Any], client_id: str, nonce: str
) -> GoogleIdentity:
    encoded = token.get("id_token")
    if not isinstance(encoded, str):
        raise GoogleFlowError()
    # The official verifier checks Google's signature, issuer, audience, and
    # expiration. Certificate fetches are bounded and run outside the event loop.
    request = partial(GoogleRequest(), timeout=10)
    claims = await asyncio.to_thread(verify_oauth2_token, encoded, request, client_id)
    if claims.get("azp", client_id) != client_id:
        raise GoogleFlowError()
    return identity_from_claims(claims, nonce)
