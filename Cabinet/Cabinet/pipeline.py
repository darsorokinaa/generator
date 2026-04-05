from .models import UserProfile


def create_user_profile(backend, user, response, *args, **kwargs):
    """
    Создаёт UserProfile при первом входе через VK, если его ещё нет.
    """
    if hasattr(user, 'profile'):
        return

    first_name = getattr(user, 'first_name', '') or response.get('first_name', '')
    last_name  = getattr(user, 'last_name',  '') or response.get('last_name',  '')
    email      = getattr(user, 'email', '')       or response.get('email', '')

    UserProfile.objects.create(
        user     = user,
        username = user.username,
        name     = first_name,
        surname  = last_name,
        email    = email,
        role     = 'teacher',
    )
