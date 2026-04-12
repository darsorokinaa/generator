from rest_framework import permissions

from .models import UserProfile


def user_can_use_lk(user) -> bool:
    """
    Доступ к ЛК: учитель с профилем кабинета (в т.ч. с ошибочным is_staff).
    Суперпользователь — только /admin/, даже если в БД есть UserProfile.
    Без профиля: staff/superuser не в ЛК.
    """
    if not getattr(user, 'is_authenticated', False):
        return False
    if user.is_superuser:
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


class IsCabinetTeacher(permissions.BasePermission):
    """Только учитель (не ученик): управление учениками, группами, уроками."""

    message = 'Доступно только учителю.'

    def has_permission(self, request, view):
        if not user_can_use_lk(request.user):
            return False
        try:
            return request.user.profile.role != 'student'
        except UserProfile.DoesNotExist:
            return False
