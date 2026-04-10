from rest_framework import permissions

from .models import UserProfile


def user_can_use_lk(user) -> bool:
    """
    Доступ к ЛК: есть профиль учителя (регистрация в кабинете) — всегда да,
    даже если у записи по ошибке включён staff. Чистый админ (staff/superuser без профиля) — нет.
    """
    if not getattr(user, 'is_authenticated', False):
        return False
    if UserProfile.objects.filter(user=user).exists():
        return True
    return not (user.is_staff or user.is_superuser)


class IsLKTeacher(permissions.BasePermission):
    """
    API личного кабинета: не чистые админские учётки (см. user_can_use_lk).
    """

    message = (
        'Эта учётная запись только для админ-панели (/admin/). '
        'Войдите в личный кабинет под учителем.'
    )

    def has_permission(self, request, view):
        return user_can_use_lk(request.user)
