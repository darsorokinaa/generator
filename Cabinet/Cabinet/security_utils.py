"""Общие проверки безопасности для представлений и API."""
from urllib.parse import urlparse

from django.conf import settings
from django.utils.http import url_has_allowed_host_and_scheme


def safe_redirect_target(next_url: str, request) -> str | None:
    """
    Защита от open redirect: разрешены только относительные пути или URL того же хоста.
    """
    if not next_url or not isinstance(next_url, str):
        return None
    next_url = next_url.strip()
    if not next_url:
        return None
    allowed = {request.get_host(), *getattr(settings, 'ALLOWED_HOSTS', [])}
    allowed = {h for h in allowed if h and h != '*'}
    require_https = request.is_secure()
    if url_has_allowed_host_and_scheme(
        next_url,
        allowed_hosts=allowed,
        require_https=require_https,
    ):
        return next_url
    return None


def parse_positive_int(value, *, max_value: int = 2_147_483_647) -> int | None:
    """Целое для id из query/body; None если не число или вне диапазона."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        if 1 <= value <= max_value:
            return value
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s or not s.isdigit():
            return None
        try:
            n = int(s)
        except ValueError:
            return None
        if 1 <= n <= max_value:
            return n
    return None
