from django.conf import settings


def site_urls(request):
    """FRONTEND_URL из настроек — в шаблонах вместо localhost."""
    return {
        'FRONTEND_URL': settings.FRONTEND_URL,
    }
