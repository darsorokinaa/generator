from django.utils import timezone
from .models import UserProfile


class SecurityHeadersMiddleware:
    """Дополнительные заголовки защиты (OWASP ASVS baseline)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        # Не перезаписываем, если уже выставлены выше по стеку
        if 'Referrer-Policy' not in response:
            response['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        if 'Permissions-Policy' not in response:
            response['Permissions-Policy'] = (
                'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), '
                'microphone=(self), payment=(), usb=()'
            )
        if 'Cross-Origin-Opener-Policy' not in response:
            response['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups'
        return response


class UpdateLastActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if request.user.is_authenticated:
            UserProfile.objects.filter(
                username=request.user.username
            ).update(last_activity=timezone.now())

        return response
