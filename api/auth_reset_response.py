"""Browser-session cleanup for the native password-reset route."""

from fastapi import Request, Response

from api.auth import auth_backend


async def clear_cookie_after_password_reset(request: Request, response: Response) -> None:
    """Clear the caller's cookie when the native reset endpoint succeeds.

    FastAPI merges this injected response's headers into a successful endpoint
    response and discards them when validation or the endpoint raises. Scoping
    by route name leaves the native forgot-password endpoint untouched.
    """
    if request.scope["route"].name != "reset:reset_password":
        return
    logout = await auth_backend.transport.get_logout_response()
    for cookie in logout.headers.getlist("set-cookie"):
        response.headers.append("set-cookie", cookie)
