from rest_framework import permissions


class IsLKTeacher(permissions.BasePermission):
    """
    Доступ к API личного кабинета только у учителей без прав админки.
    Учётки staff/superuser предназначены для /admin/ и не должны совпадать с ЛК.
    """

    message = (
        'Учётная запись администратора не используется в личном кабинете. '
        'Войдите в кабинет под учителем или откройте /admin/.'
    )

    def has_permission(self, request, view):
        u = request.user
        if not u.is_authenticated:
            return False
        if u.is_staff or u.is_superuser:
            return False
        return True
