from django.shortcuts import render, redirect          # render — рендер шаблона, redirect — перенаправление
from django.contrib.auth import authenticate, login, logout  # стандартная аутентификация Django
from django.contrib.auth.models import User            # встроенная модель пользователя Django
from django.contrib.auth.password_validation import validate_password  # валидатор надёжности пароля
from django.core.exceptions import ValidationError     # исключение при нарушении правил валидации
from django.contrib import messages                    # фреймворк flash-сообщений для шаблонов
from django.conf import settings                       # доступ к настройкам проекта (settings.py)
from django.core.cache import cache                    # кэш-бэкенд (Redis / LocMem / etc.)
from django.utils import timezone                      # timezone.now() — текущее время с учётом TZ
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.utils.dateparse import parse_date          # безопасный парсинг строки "YYYY-MM-DD" → date
import os                                              # работа с файловой системой и переменными окружения
import random                                          # генерация случайных чисел и выборок
import string                                          # наборы символов (ascii_letters, digits)
import time                                            # time.time() — текущий Unix-timestamp
import re                                              # регулярные выражения
import json       
import requests                                    # HTTP-клиент для проксирования запросов к генератору
import urllib.request                                  # HTTP-запросы без сторонних библиотек
import urllib.error                                    # HTTPError при проксировании запросов
import jwt                                             # PyJWT — создание и верификация JWT-токенов
from .models import (                                  # импорт всех моделей приложения
    UserProfile,                                       # профиль пользователя (учитель / ученик)
    FunnyWord,                                         # словарь слов для генерации логинов
    Subject,                                           # справочник предметов
    Level,                                             # справочник уровней (база, ОГЭ, ЕГЭ…)
    TeacherSubject,                                    # связь учитель → предмет
    TeachersStudent,                                   # связь учитель → ученик + параметры занятия
    TeachersGroup,                                     # связь группа → ученик (участники группы)
    Group,                                             # учебная группа учителя
    Homework,                                          # домашнее задание
    HomeworkAttachment,                                # вложение к ДЗ (файл от учителя)
    HomeworkAssignment,                                # назначение ДЗ конкретному ученику
    HomeworkAnswerFile,                                # файл ответа от ученика
    HomeworkTeacherFeedbackFile,                       # файл обратной связи от учителя
    Notification,                                      # уведомление пользователю
    TeacherVariant,                                    # сохранённый вариант учителя
)
from rest_framework import viewsets, status            # ViewSet-базы и HTTP-коды статусов
from rest_framework.views import APIView               # базовый класс для API-представлений
from rest_framework.response import Response           # объект JSON-ответа DRF
from rest_framework.permissions import IsAuthenticated, AllowAny  # permission: любой аутентифицированный
from rest_framework.authentication import SessionAuthentication       # сессия для ЛК при смешанном auth

from .permissions import IsLKTeacher, IsCabinetTeacher, user_can_use_lk  # кастомные разрешения ЛК
from .security_utils import safe_redirect_target       # безопасная проверка URL для редиректа
from .serializers import (                             # сериализаторы для чтения данных
    UserProfileSerializer, SubjectSerializer,
    LevelSerializer, TeachersStudentSerializer, GroupSerializer,
    HomeworkSerializer, HomeworkAttachmentSerializer,
    HomeworkAssignmentSerializer, HomeworkAssignmentDetailSerializer,
    HomeworkAnswerFileSerializer,
    HomeworkTeacherFeedbackFileSerializer,
    NotificationSerializer,
    TeacherVariantSerializer,
)
from .serializers_input import (                       # сериализаторы для валидации входящих данных
    StudentCreateSerializer,                           # создание ученика
    GroupCreateSerializer,                             # создание группы
    LessonTokenSerializer,                             # запрос токена урока
)
from datetime import timedelta
from .models import LessonInvite







FRONTEND_URL = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')   # URL React SPA (из settings или дефолт)
GENUROK_URL  = getattr(settings, 'GENUROK_URL',  'https://test.genurok.ru')  # URL сервиса генератора заданий
LESSON_SECRET = getattr(settings, 'LESSON_SECRET', settings.SECRET_KEY)     # секрет для подписи JWT урока
LESSON_TTL    = 60 * 60 * 2  # время жизни токена урока — 2 часа в секундах
HW_ROOM_TTL   = int(getattr(settings, 'HOMEWORK_ROOM_TTL', 60 * 60 * 24 * 30))  # JWT «комнаты» ДЗ для генератора


def _normalize_revision_task_ids(raw):
    """Список номеров заданий (строки) без дубликатов."""
    if raw is None:
        return []
    if not isinstance(raw, (list, tuple)):
        return []
    out = []
    for x in raw:
        s = str(x).strip()
        if s:
            out.append(s)
    return list(dict.fromkeys(out))


def _mint_homework_room_token(assignment):
    """JWT для /lesson/join/ на генераторе (режим домашки — query cabinet_session=homework)."""
    hw = assignment.homework
    teacher = hw.teacher
    teacher_uid = getattr(getattr(teacher, 'user', None), 'id', None) or 0
    room_id = (assignment.homework_room_id or '').strip() or f'hw-{assignment.pk}-{int(time.time())}'
    now = int(time.time())
    target_name = f'{assignment.student.name} {assignment.student.surname}'.strip() or 'Ученик'
    payload = {
        'iss': 'cabinet',
        'iat': now,
        'exp': now + HW_ROOM_TTL,
        'room_id': room_id,
        'teacher_id': teacher_uid,
        'teacher': f'{teacher.name} {teacher.surname}'.strip() or 'Учитель',
        'lesson_format': 'homework',
        'target_id': assignment.student_id,
        'target_name': target_name,
        'variant_id': int(hw.variant_id),
        'session_kind': 'homework',
        'homework_assignment_id': assignment.pk,
    }
    token = jwt.encode(payload, LESSON_SECRET, algorithm='HS256')
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token, room_id


def _homework_room_token_valid(token):
    if not token or not str(token).strip():
        return False
    try:
        jwt.decode(
            str(token).strip(),
            LESSON_SECRET,
            algorithms=['HS256'],
            options={'require': ['exp']},
        )
        return True
    except Exception:
        return False


def _ensure_homework_room_credentials(assignment, save=True):
    """Гарантирует неистёкший JWT и room_id у назначения ДЗ."""
    token = (assignment.homework_room_token or '').strip()
    room_id = (assignment.homework_room_id or '').strip()
    update_fields = []
    if not _homework_room_token_valid(token):
        token, room_id = _mint_homework_room_token(assignment)
        assignment.homework_room_token = token
        assignment.homework_room_id = room_id
        update_fields.extend(['homework_room_token', 'homework_room_id'])
    elif not room_id:
        token, room_id = _mint_homework_room_token(assignment)
        assignment.homework_room_id = room_id
        update_fields.append('homework_room_id')
    if save and update_fields:
        assignment.save(update_fields=list(dict.fromkeys(update_fields)))
    return str(token).strip(), (assignment.homework_room_id or '').strip()


def _local_dev_generator_fallback_base():
    """
    Локальная отладка: если GENUROK_URL ошибочно указывает на Cabinet (8001),
    то ссылки /lesson/join/ будут открывать SPA ЛК и редиректить на /app/.
    В DEBUG режиме подменяем базу на локальный генератор (по умолчанию 127.0.0.1:8000).
    """
    return str(getattr(settings, 'LOCAL_GENUROK_URL', '') or os.environ.get('LOCAL_GENUROK_URL') or 'http://127.0.0.1:8000').strip().rstrip('/')


def _strip_generator_base_app_suffix(base: str) -> str:
    """GENUROK_URL иногда копируют из ЛК с /app — иначе путь /app/lesson/join не попадает в генератор."""
    b = (base or '').strip().rstrip('/')
    low = b.lower()
    if low.endswith('/app'):
        return b[:-4].rstrip('/')
    return b


def _looks_like_local_cabinet_not_generator(base: str) -> bool:
    """Типичная ошибка .env: GENUROK_URL = тот же хост:порт, что и Django (8001) — SPA вместо урока."""
    if not base or not isinstance(base, str):
        return False
    try:
        from urllib.parse import urlparse

        u = urlparse(base.strip())
        if u.scheme not in ('http', 'https'):
            return False
        h = (u.hostname or '').strip().lower()
        if h not in ('localhost', '127.0.0.1', '0.0.0.0', '::1'):
            return False
        return u.port == 8001
    except Exception:
        return False


def _generator_base_for_links(request=None):
    """
    База генератора для ссылок (/lesson/join и прямые /ege/.../variant/...).
    См. settings.HOMEWORK_LINKS_USE_LOCAL_GENERATOR — в DEBUG по умолчанию всегда LOCAL_GENUROK_URL.
    """
    if getattr(settings, 'HOMEWORK_LINKS_USE_LOCAL_GENERATOR', False):
        return _local_dev_generator_fallback_base()
    base = _strip_generator_base_app_suffix((GENUROK_URL or '').strip().rstrip('/'))
    if not base:
        return _local_dev_generator_fallback_base()
    if _looks_like_local_cabinet_not_generator(base):
        return _local_dev_generator_fallback_base()
    if not getattr(settings, 'DEBUG', False):
        return base
    try:
        from urllib.parse import urlparse

        def _loopback(h):
            return (h or '').strip().lower() in ('localhost', '127.0.0.1', '0.0.0.0', '::1')

        u = urlparse(base)
        host = (u.hostname or '').strip().lower()
        port = u.port
        req_host = ''
        req_port = None
        if request is not None:
            try:
                raw = (request.get_host() or '').strip()
                if ':' in raw:
                    req_host, p = raw.split(':', 1)
                    req_host = req_host.strip().lower()
                    try:
                        req_port = int(p)
                    except ValueError:
                        req_port = None
                else:
                    req_host = raw.lower()
            except Exception:
                req_host = ''
        if _loopback(host) and port == 8001:
            return _local_dev_generator_fallback_base()
        # localhost vs 127.0.0.1 — один и тот же Cabinet
        if req_host and _loopback(host) and _loopback(req_host) and (port in (8001, None) or (req_port in (8001, None) and port == req_port)):
            return _local_dev_generator_fallback_base()
        if req_host and host == req_host and _loopback(host):
            return _local_dev_generator_fallback_base()
    except Exception:
        pass
    # На случай обхода проверок выше: никогда не отдаём ссылки ДЗ на тот же loopback:8001, что и runserver ЛК.
    try:
        from urllib.parse import urlparse

        bu = urlparse((base or '').strip())
        if bu.scheme in ('http', 'https') and bu.port == 8001:
            lh = (bu.hostname or '').strip().lower()
            if lh in ('localhost', '127.0.0.1', '0.0.0.0', '::1'):
                return _local_dev_generator_fallback_base()
    except Exception:
        pass
    return base


def _homework_room_join_urls(assignment, request=None):
    from urllib.parse import quote

    token, _rid = _ensure_homework_room_credentials(assignment, save=True)
    genurok_url = _generator_base_for_links(request).rstrip('/')
    aid = assignment.pk
    tok_q = quote(str(token), safe='')
    base = f'{genurok_url}/lesson/join/?token={tok_q}&cabinet_session=homework&cabinet_assignment={aid}'
    return {
        'teacher': f'{base}&role=teacher',
        'student': f'{base}&role=student',
    }


def _generator_public_site_url():
    """Корень сайта заданий без суффикса /api (страницы /ege/math/variant/…)."""
    b = _generator_base_for_links().rstrip('/')
    if len(b) >= 4 and b.lower().endswith('/api'):
        b = b[:-4].rstrip('/')
    if not b.startswith(('http://', 'https://')):
        return ''
    return b


def _homework_direct_exam_urls(assignment):
    """
    Прямая ссылка на страницу варианта с тем же JWT и cabinet_session=homework.
    Обычно даёт меньше HTTP-редиректов, чем цепочка /lesson/join/ на генераторе.
    """
    from urllib.parse import urlencode

    token = (assignment.homework_room_token or '').strip()
    if not token:
        return None
    hw = assignment.homework
    try:
        vid = int(hw.variant_id)
    except (TypeError, ValueError):
        return None
    data = None
    for require_secret in (False, True):
        try:
            data = _gen_proxy(f'api/variant-lookup/{vid}/', require_secret=require_secret)
            break
        except Exception:
            data = None
    if not isinstance(data, dict):
        return None
    level = str(data.get('level') or data.get('level_slug') or '').strip().lower().strip('/')
    subject = str(data.get('subject') or data.get('subject_slug') or '').strip().lower().strip('/')
    if not subject and hw.subject:
        subject = str(hw.subject).strip().lower().strip('/')
    if not level or not subject:
        return None
    pub = _generator_public_site_url().rstrip('/')
    if not pub:
        return None
    base = f'{pub}/{level}/{subject}/variant/{vid}/'
    qbase = {
        'token': token,
        'cabinet_session': 'homework',
        'cabinet_assignment': str(assignment.pk),
    }

    def with_role(r):
        return f'{base}?{urlencode({**qbase, "role": r})}'

    return {'teacher': with_role('teacher'), 'student': with_role('student')}


def _merge_homework_result_for_revision(assignment, incoming_result):
    """Частичная доработка: обновляем только ключи из revision_task_ids."""
    if not isinstance(incoming_result, dict):
        return assignment.result or {}
    old = dict(assignment.result or {})
    rev = _normalize_revision_task_ids(getattr(assignment, 'revision_task_ids', None))
    if assignment.status == 'revision' and rev:
        merged = dict(old)
        for k, v in incoming_result.items():
            ks = str(k).strip()
            if ks in rev:
                merged[ks] = v
        return merged
    return incoming_result


def _lesson_ring_dismiss_mark(user_id=None, profile_id=None, profile_username=None, user_username=None, token=''):
    """Ученик вошёл в урок — больше не показываем ему звонок по этому JWT (важно для групп и вкладки только с генератором)."""
    if not token:
        return
    t = str(token).strip()
    if user_id:
        cache.set(f'lesson_ring_dismiss:u:{user_id}:{t}', 1, LESSON_TTL)
    if profile_id:
        cache.set(f'lesson_ring_dismiss:p:{profile_id}:{t}', 1, LESSON_TTL)
    pu = (profile_username or '').strip()
    if pu:
        cache.set(f'lesson_ring_dismiss:un:{pu}:{t}', 1, LESSON_TTL)
    uu = (user_username or '').strip()
    if uu and uu != pu:
        cache.set(f'lesson_ring_dismiss:un:{uu}:{t}', 1, LESSON_TTL)


def _lesson_ring_dismiss_is_set_for_request(request, token):
    if not token:
        return False
    t = str(token).strip()
    user_id = getattr(request.user, 'id', None)
    profile = getattr(request.user, 'profile', None)
    profile_id = getattr(profile, 'id', None)
    profile_username = str(getattr(profile, 'username', '') or '').strip()
    user_username = str(getattr(request.user, 'username', '') or '').strip()
    if user_id and cache.get(f'lesson_ring_dismiss:u:{user_id}:{t}'):
        return True
    if profile_id and cache.get(f'lesson_ring_dismiss:p:{profile_id}:{t}'):
        return True
    if profile_username and cache.get(f'lesson_ring_dismiss:un:{profile_username}:{t}'):
        return True
    if user_username and user_username != profile_username and cache.get(f'lesson_ring_dismiss:un:{user_username}:{t}'):
        return True
    return False


def _lesson_pending_cache_delete_user_keys(user_id=None, profile_id=None, profile_username=None, user_username=None):
    if user_id:
        cache.delete(f'lesson_pending_invite_user:{user_id}')
    if profile_id:
        cache.delete(f'lesson_pending_invite_profile:{profile_id}')
    pu = (profile_username or '').strip()
    if pu:
        cache.delete(f'lesson_pending_invite_username:{pu}')
    uu = (user_username or '').strip()
    if uu and uu != pu:
        cache.delete(f'lesson_pending_invite_username:{uu}')


def _ws_notify_users_payload(user_ids, payload_dict):
    if not user_ids:
        return
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        for uid in user_ids:
            async_to_sync(channel_layer.group_send)(
                f'user_{uid}',
                {'type': 'notify_message', 'data': payload_dict},
            )
    except Exception:
        pass


def _lesson_jwt_recipients_for_ring_stop(lesson_type, target_id, teacher_uid=None):
    """Списки user_id / profile_id / username — кого затронул урок (как в teacher-joined)."""
    notify_user_ids = []
    notify_profile_ids = []
    notify_usernames = []
    if target_id is not None and lesson_type == 'student':
        try:
            ts = TeachersStudent.objects.select_related('student__user', 'teacher__user').get(pk=target_id)
        except TeachersStudent.DoesNotExist:
            ts = TeachersStudent.objects.select_related('student__user', 'teacher__user').filter(
                teacher__user_id=teacher_uid,
                student_id=target_id,
            ).first()
        if ts:
            if teacher_uid is not None and int(ts.teacher.user_id) != int(teacher_uid):
                return None, None, None
            if ts.student:
                notify_profile_ids.append(int(ts.student.id))
                if ts.student.user_id:
                    notify_user_ids.append(int(ts.student.user_id))
                if ts.student.username:
                    notify_usernames.append(str(ts.student.username))
                if ts.student.user and ts.student.user.username:
                    notify_usernames.append(str(ts.student.user.username))
    elif target_id is not None and lesson_type == 'group':
        try:
            grp = Group.objects.select_related('teacher', 'teacher__user').get(pk=target_id)
        except Group.DoesNotExist:
            grp = None
        if grp:
            if teacher_uid is not None and int(grp.teacher.user_id) != int(teacher_uid):
                return None, None, None
            for row in TeachersGroup.objects.filter(group_id=target_id).select_related('student', 'student__user'):
                sid = getattr(row.student, 'id', None)
                uid = getattr(row.student, 'user_id', None)
                susername = getattr(row.student, 'username', None)
                uusername = getattr(getattr(row.student, 'user', None), 'username', None)
                if sid:
                    notify_profile_ids.append(int(sid))
                if uid:
                    notify_user_ids.append(int(uid))
                if susername:
                    notify_usernames.append(str(susername))
                if uusername:
                    notify_usernames.append(str(uusername))
    notify_user_ids = list(dict.fromkeys(notify_user_ids))
    notify_profile_ids = list(dict.fromkeys(notify_profile_ids))
    notify_usernames = list(dict.fromkeys(notify_usernames))
    return notify_user_ids, notify_profile_ids, notify_usernames

# Глобальный флаг: проверены ли нужные колонки миграции 0016 в БД.
# None — ещё не проверялось; True/False — результат проверки.
_HOMEWORK_ASSIGNMENT_META_COLUMNS_READY = None
TASKS_GET_SECRET = getattr(settings, 'TASKS_GET_SECRET', '').strip()

def _homework_assignment_meta_columns_ready():
    """
    Без этих колонок ORM делает SELECT … task_teacher_comments … и падает на проде до migrate.
    """
    global _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY                           # используем глобальную переменную-кэш
    if _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY is not None:                  # уже проверяли — возвращаем кэш
        return _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY
    try:
        from django.db import connection                                      # импортируем соединение с БД

        table = HomeworkAssignment._meta.db_table                            # имя таблицы в БД
        with connection.cursor() as cursor:                                  # открываем курсор
            desc = connection.introspection.get_table_description(cursor, table)  # читаем описание колонок
        names = {row.name for row in desc}                                   # множество имён колонок
        _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY = (                          # True если обе колонки существуют
            'task_teacher_comments' in names and 'whiteboard_strokes' in names
        )
    except Exception:
        _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY = True                       # при ошибке считаем колонки готовыми
    return _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY


def homework_assignment_select_qs():
    """Менеджер: при отсутствии колонок 0016 — defer, чтобы SELECT не ломался."""
    if _homework_assignment_meta_columns_ready():                            # колонки есть → обычный queryset
        return HomeworkAssignment.objects
    return HomeworkAssignment.objects.defer('task_teacher_comments', 'whiteboard_strokes')  # исключаем отсутствующие колонки


# def _make_jitsi_jwt(name: str, room: str, is_moderator: bool, app_id: str, secret: str, hostname: str) -> str:
#     """
#     Генерирует Jitsi JWT для своего сервера.
#     is_moderator=True → учитель становится организатором без входа в Jitsi.
#     Формат токена соответствует стандарту Jitsi Meet (prosody token_verification).
#     """
#     payload = {                                                              # формируем тело JWT по стандарту Jitsi
#         "context": {
#             "user": {
#                 "name": name,                                                # отображаемое имя участника
#                 "moderator": is_moderator,                                   # True → роль организатора в Jitsi
#             }
#         },
#         "aud": "jitsi",                                                      # аудитория токена — сервис Jitsi
#         "iss": app_id,                                                       # идентификатор приложения (prosody app_id)
#         "sub": hostname,                                                     # домен Jitsi-сервера
#         "room": room,                                                        # название комнаты
#         "exp": int(time.time()) + LESSON_TTL,                               # время истечения токена
#     }
#     return jwt.encode(payload, secret, algorithm="HS256")                   # подписываем токен алгоритмом HS256


_FUNNY_WORDS_CACHE_KEY = 'cabinet:funny_words'   # ключ кэша для словаря логин-слов
_FUNNY_WORDS_TTL      = 300                      # TTL кэша — 5 минут


def generate_username():
    """Случайное слово + 4 цифры, гарантированно уникальное."""
    words = cache.get(_FUNNY_WORDS_CACHE_KEY)                               # пробуем из кэша (избегаем SELECT каждый раз)
    if words is None:                                                        # кэш пуст или истёк
        words = list(FunnyWord.objects.values_list('word', flat=True))      # загружаем из БД один раз
        if words:                                                            # кэшируем только если список непустой
            cache.set(_FUNNY_WORDS_CACHE_KEY, words, timeout=_FUNNY_WORDS_TTL)
    if not words:                                                            # словарь пуст — запасное слово
        words = ['учитель']
    for _ in range(20):                                                      # до 20 попыток сгенерировать уникальный логин
        username = f"{random.choice(words)}_{random.randint(1000, 9999)}"   # слово_XXXX
        if not User.objects.filter(username=username).exists():             # проверяем уникальность в БД
            return username                                                  # нашли свободный — возвращаем
    return f"user_{random.randint(100000, 999999)}"                         # запасной вариант если все 20 попыток заняты


def get_user_by_login(login_str):
    """Ищет пользователя по логину или email."""
    user = User.objects.filter(username=login_str).first()                  # сначала ищем точное совпадение по username
    if user is None and '@' in login_str:                                   # если не нашли и строка похожа на email
        user = User.objects.filter(email=login_str).first()                 # ищем по email
    return user                                                             # возвращаем объект User или None


def _dashboard_url(request):
    """
    URL дашборда (React SPA).
    В проде SPA отдаётся Django с path /app/; отдельный CRA — http://localhost:3000.
    """
    fe = (FRONTEND_URL or '').rstrip('/')                                   # убираем trailing slash из URL фронтенда
    if fe and (':3000' in fe or fe.rstrip('/').endswith('3000')):           # если фронтенд на порту 3000 (dev-режим)
        return fe                                                            # возвращаем адрес CRA напрямую
    return request.build_absolute_uri('/app/')                              # иначе SPA встроен в Django по пути /app/


def _login_rate_limit_key(request):
    return f'cabinet:login_fail:{request.META.get("REMOTE_ADDR", "unknown")}'  # ключ кэша: провалы входа по IP


def login_view(request):
    if request.user.is_authenticated:                                       # пользователь уже вошёл
        if user_can_use_lk(request.user):                                   # имеет доступ к ЛК
            return redirect(_dashboard_url(request))                        # → редирект на дашборд
        return redirect('/admin/')                                          # суперпользователь → в админку

    if request.method == 'POST':                                            # обработка формы входа
        rl_key = _login_rate_limit_key(request)                            # ключ для rate limit по IP
        if cache.get(rl_key, 0) >= 25:                                     # превышен лимит попыток (25 за 15 минут)
            messages.error(
                request,
                'Слишком много неудачных попыток входа с этого адреса. Подождите около 15 минут.',
            )
            return render(request, 'login.html')                           # показываем форму с ошибкой блокировки

        login_str = (request.POST.get('username') or '').strip()[:254]    # читаем логин, ограничиваем длину
        password  = (request.POST.get('password') or '')[:128]            # читаем пароль, ограничиваем длину

        user_obj = get_user_by_login(login_str)                            # ищем пользователя по логину / email
        user = authenticate(request, username=user_obj.username, password=password) if user_obj else None  # проверяем пароль

        if user is not None:                                                # аутентификация успешна
            if not user_can_use_lk(user):                                  # но нет доступа к ЛК (например superuser)
                messages.error(
                    request,
                    'Эта учётная запись только для админ-панели (/admin/). '
                    'В личный кабинет учителя входите под отдельным логином (регистрация в кабинете).',
                )
            else:
                cache.delete(rl_key)                                        # сбрасываем счётчик неудачных попыток
                login(request, user)                                        # создаём сессию Django
                next_raw = request.GET.get('next')                         # читаем параметр ?next= для редиректа
                safe = safe_redirect_target(next_raw, request) if next_raw else None  # проверяем безопасность URL
                return redirect(safe or _dashboard_url(request))           # редиректим на next или дашборд
        else:
            try:
                cache.incr(rl_key)                                          # увеличиваем счётчик неудачных попыток
            except ValueError:
                cache.set(rl_key, 1, timeout=900)                          # ключ не существует — создаём с TTL 15 минут
            messages.error(request, 'Неверный логин / email или пароль')   # сообщение об ошибке для шаблона

    return render(request, 'login.html')                                    # GET-запрос или ошибка → рендерим форму


def register_view(request):
    if request.user.is_authenticated:                                       # уже авторизован — не нужна регистрация
        if user_can_use_lk(request.user):
            return redirect(_dashboard_url(request))                        # → в ЛК
        return redirect('/admin/')                                          # → в админку

    subjects = Subject.objects.all().order_by('subject_name')              # все предметы для чекбоксов формы

    if request.method == 'POST':                                            # отправка формы регистрации
        name        = (request.POST.get('name') or '').strip()[:100]       # имя (макс. 100 символов)
        surname     = (request.POST.get('surname') or '').strip()[:100]    # фамилия
        email       = (request.POST.get('email') or '').strip()[:254]      # email (макс. 254 по RFC)
        password1   = (request.POST.get('password1') or '')[:128]          # пароль
        password2   = (request.POST.get('password2') or '')[:128]          # подтверждение пароля
        subject_ids = request.POST.getlist('subjects')                     # список выбранных ID предметов

        try:
            subj_ints = [int(x) for x in subject_ids]                      # конвертируем строки в int
        except (TypeError, ValueError):
            messages.error(request, 'Некорректный выбор предметов')
            return render(request, 'register.html', {'subjects': subjects}) # показываем форму с ошибкой

        if not all([name, surname, email, password1]):                      # проверяем обязательные поля
            messages.error(request, 'Заполните все обязательные поля')
        elif not subj_ints:                                                 # хотя бы один предмет должен быть выбран
            messages.error(request, 'Выберите хотя бы один предмет')
        elif password1 != password2:                                        # пароли должны совпадать
            messages.error(request, 'Пароли не совпадают')
        elif len(password1) < 8:                                            # минимальная длина пароля
            messages.error(request, 'Пароль должен быть не менее 8 символов')
        elif email and User.objects.filter(email=email).exists():           # email уже занят
            messages.error(request, 'Email уже используется')
        else:
            try:
                validate_password(password1, user=User(email=email, username=email[:30]))  # валидация надёжности пароля
            except ValidationError as e:
                for err in e.messages:                                      # показываем каждую ошибку валидатора
                    messages.error(request, err)
                return render(request, 'register.html', {'subjects': subjects})

            valid_subject_ids = set(Subject.objects.filter(id__in=subj_ints).values_list('id', flat=True))  # ID предметов из БД
            if valid_subject_ids != set(subj_ints):                        # кто-то подделал ID предметов
                messages.error(request, 'Выбран неизвестный предмет')
                return render(request, 'register.html', {'subjects': subjects})

            username = generate_username()                                  # генерируем случайный уникальный логин
            user = User.objects.create_user(                               # создаём Django-пользователя
                username=username,
                email=email,
                password=password1,
                first_name=name,
                last_name=surname,
                is_staff=False,                                             # не сотрудник — нет доступа в /admin/
                is_superuser=False,                                         # не суперпользователь
            )
            profile = UserProfile.objects.create(                          # создаём профиль ЛК
                user=user,
                username=username,
                name=name,
                surname=surname,
                email=email,
                role='teacher',                                             # при регистрации через форму — всегда учитель
            )
            selected = Subject.objects.filter(id__in=subj_ints)            # queryset выбранных предметов
            TeacherSubject.objects.bulk_create([                           # массово создаём связи учитель → предмет
                TeacherSubject(teacher=profile, subject=s) for s in selected
            ])
            login(request, user)                                           # сразу авторизуем после регистрации
            return render(request, 'register_success.html', {'username': username})  # страница с логином

    return render(request, 'register.html', {'subjects': subjects})        # GET или ошибки → форма регистрации


def logout_view(request):
    logout(request)                                                         # завершаем сессию Django
    return redirect(settings.LOGOUT_REDIRECT_URL)                          # перенаправляем на страницу после выхода


def settings_view(request):
    if request.user.is_authenticated and not user_can_use_lk(request.user):  # суперпользователь без ЛК
        return redirect('/admin/')                                           # → в Django admin
    return render(request, 'settings.html')                                 # рендерим страницу настроек


# ── REST API ──────────────────────────────────────────────────────────────────

class TeacherProfileMixin:
    """
    Миксин: единая точка получения UserProfile учителя для всех API-View.
    Использует get_or_create — безопасен при повторных вызовах для суперпользователей
    без профиля (не создаёт дубликаты в отличие от create).
    """

    def get_teacher_profile(self, request):
        try:
            return request.user.profile                              # обычный путь через related_name
        except Exception:
            profile, _ = UserProfile.objects.get_or_create(         # идемпотентно — не создаёт дубликаты
                user=request.user,
                defaults={
                    'username': request.user.username,
                    'name':     request.user.first_name or request.user.username,
                    'surname':  request.user.last_name or '',
                    'email':    request.user.email or '',
                    'role':     'teacher',
                },
            )
            return profile

class UserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Только чтение собственного профиля (без массового CRUD по чужим записям)."""

    permission_classes = [IsCabinetTeacher]                                # только авторизованные пользователи ЛК
    serializer_class = UserProfileSerializer                               # сериализатор профиля

    def get_queryset(self):
        return UserProfile.objects.filter(user_id=self.request.user.id)    # возвращаем только профиль текущего пользователя


class SubjectListView(APIView):
    permission_classes = [IsCabinetTeacher]                                # доступно только пользователям ЛК

    def get(self, request):
        try:
            teacher_profile = request.user.profile                         # получаем профиль учителя
            subject_ids = TeacherSubject.objects.filter(                   # ID предметов которые ведёт учитель
                teacher=teacher_profile
            ).values_list('subject_id', flat=True)
            subjects = Subject.objects.filter(id__in=subject_ids).order_by('subject_name')  # предметы учителя
        except Exception:
            subjects = Subject.objects.all().order_by('subject_name')      # fallback — все предметы если профиля нет
        return Response(SubjectSerializer(subjects, many=True).data)       # возвращаем список предметов


class LevelListView(APIView):
    permission_classes = [IsCabinetTeacher]                                # доступно только пользователям ЛК

    def get(self, request):
        levels = Level.objects.all()                                       # все уровни (нет фильтрации по учителю)
        return Response(LevelSerializer(levels, many=True).data)           # сериализуем и отдаём список


class StudentsView(TeacherProfileMixin, APIView):
    permission_classes = [IsCabinetTeacher]                                # только учитель ЛК

    def get(self, request):
        teacher_profile = self.get_teacher_profile(request)               # профиль текущего учителя
        qs = TeachersStudent.objects.filter(teacher=teacher_profile).select_related(  # связи ученик-учитель
            'student', 'subject', 'level', 'group'                        # подтягиваем связанные объекты за 1 запрос
        )
        return Response(TeachersStudentSerializer(qs, many=True).data)    # сериализуем список учеников

    def post(self, request):
        """Создаёт ученика (UserProfile) и связь с учителем (TeachersStudent)."""
        ser = StudentCreateSerializer(data=request.data)                   # валидируем входящие данные
        if not ser.is_valid():
            return Response({'error': ser.errors}, status=status.HTTP_400_BAD_REQUEST)  # ошибки валидации

        vd = ser.validated_data                                            # валидированные данные
        name        = vd['name']                                           # имя ученика
        surname     = vd['surname']                                        # фамилия
        email       = vd['email']                                          # email (может быть пустым)
        phone       = vd['phone']                                          # телефон
        subject_id  = vd['subject']                                        # ID предмета
        level_id    = vd['level']                                          # ID уровня
        grade       = vd['grade']                                          # класс (7-11)
        goal        = vd['goal']                                           # цель обучения
        st_status   = vd['status']                                         # статус ученика (активен / пауза / …)
        lesson_type = vd['lesson_type']                                    # тип занятия: individual / group
        group_id    = vd.get('group')                                      # ID группы (если lesson_type='group')
        gender      = vd['gender']                                         # пол
        birth_date  = vd.get('birth_date')                                 # дата рождения (опционально)

        teacher_profile = self.get_teacher_profile(request)               # профиль учителя из запроса

        try:
            subject = Subject.objects.get(id=subject_id)                  # проверяем существование предмета
            level   = Level.objects.get(id=level_id)                      # проверяем существование уровня
        except (Subject.DoesNotExist, Level.DoesNotExist):
            return Response({'error': 'Предмет или уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)

        group = None                                                        # группа по умолчанию отсутствует
        if lesson_type == 'group' and group_id:                           # если групповое занятие и указана группа
            try:
                group = Group.objects.get(id=group_id, teacher=teacher_profile)  # группа должна принадлежать учителю
            except Group.DoesNotExist:
                return Response({'error': 'Группа не найдена'}, status=status.HTTP_400_BAD_REQUEST)

        username = generate_username()                                     # случайный логин для ученика
        password = ''.join(random.choices(string.ascii_letters + string.digits, k=10))  # случайный пароль 10 символов
        user = User.objects.create_user(                                  # создаём Django-пользователя ученика
            username=username,
            email=email or f"{username}@noemail.local",                   # заглушка если email не указан
            password=password,
            first_name=name,
            last_name=surname,
        )
        student_profile = UserProfile.objects.create(                     # профиль ученика в ЛК
            user=user,
            username=username,
            name=name,
            surname=surname,
            email=email or '',
            phone=phone or None,
            gender=gender,
            birth_date=birth_date,
            role='student',                                                # роль — ученик
        )

        ts = TeachersStudent.objects.create(                               # создаём связь учитель-ученик
            teacher=teacher_profile,
            student=student_profile,
            subject=subject,
            level=level,
            grade=grade,
            goal=goal,
            status=st_status,
            lesson_type=lesson_type,
            group=group,
        )
        data = TeachersStudentSerializer(ts).data                         # сериализуем созданную связь
        data['credentials'] = {'login': username, 'password': password, 'gender': gender}  # добавляем учётные данные в ответ
        return Response(data, status=status.HTTP_201_CREATED)             # 201 Created


class StudentDetailView(TeacherProfileMixin, APIView):
    permission_classes = [IsCabinetTeacher]                               # только учитель ЛК

    def post(self, request, pk):
        """Сброс пароля ученика: POST { "action": "reset_password" }"""
        if request.data.get('action') != 'reset_password':               # принимаем только это действие
            return Response(
                {'error': 'Укажите action: reset_password'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        teacher_profile = self.get_teacher_profile(request)              # профиль учителя
        try:
            ts = TeachersStudent.objects.select_related('student__user').get(  # ищем ученика учителя по pk
                pk=pk, teacher=teacher_profile
            )
        except TeachersStudent.DoesNotExist:
            return Response({'error': 'Ученик не найден'}, status=status.HTTP_404_NOT_FOUND)

        student_user = ts.student.user                                    # Django-пользователь ученика
        if not student_user:
            return Response({'error': 'У ученика нет учётной записи'}, status=status.HTTP_400_BAD_REQUEST)

        new_password = ''.join(random.choices(string.ascii_letters + string.digits, k=10))  # новый случайный пароль
        student_user.set_password(new_password)                           # хэшируем и устанавливаем пароль
        student_user.save(update_fields=['password'])                     # сохраняем только поле password

        return Response({
            'login': ts.student.username,                                 # логин ученика для вывода учителю
            'password': new_password,                                     # новый пароль в открытом виде
        })

    def patch(self, request, pk):
        """
        PATCH полей ученика и связи TeachersStudent.
        Профиль: student_name, student_surname, student_email, student_phone, gender, birth_date
        Обучение: subject, level, grade, goal, status
        Группа: group_id (null — без группы) или lesson_type individual/group
        """
        teacher_profile = self.get_teacher_profile(request)              # профиль учителя из запроса
        try:
            ts = TeachersStudent.objects.select_related(                  # загружаем связанные объекты
                'student', 'student__user', 'group', 'subject', 'level',
            ).get(pk=pk, teacher=teacher_profile)                         # только ученик этого учителя
        except TeachersStudent.DoesNotExist:
            return Response({'error': 'Ученик не найден'}, status=status.HTTP_404_NOT_FOUND)

        profile = ts.student                                              # профиль ученика
        user    = profile.user                                            # Django-пользователь ученика
        data    = request.data                                            # входящие данные запроса

        profile_field_keys = {                                            # поля которые относятся к профилю ученика
            'student_name', 'student_surname', 'student_email', 'student_phone',
            'gender', 'birth_date',
        }
        if profile_field_keys & data.keys():                              # если переданы поля профиля
            if 'student_name' in data:
                profile.name = str(data.get('student_name') or '')[:100]  # обновляем имя (макс. 100 символов)
            if 'student_surname' in data:
                profile.surname = str(data.get('student_surname') or '')[:100]  # обновляем фамилию
            if 'student_email' in data:
                em = str(data.get('student_email') or '').strip()[:254]  # новый email
                if em:                                                    # обновляем только если не пустой
                    profile.email = em
                    if user:
                        user.email = em                                   # синхронизируем email в User
            if 'student_phone' in data:
                ph = data.get('student_phone')
                profile.phone = (str(ph).strip() if ph else '') or None  # None если пустая строка
            if 'gender' in data:
                g = data.get('gender')
                if g in ('female', 'male', 'other'):                     # проверяем допустимые значения
                    profile.gender = g
            if 'birth_date' in data:
                bd = data.get('birth_date')
                if bd in (None, '', 'null'):                             # очистка даты
                    profile.birth_date = None
                elif isinstance(bd, str):
                    parsed = parse_date(bd[:10])                         # парсим ISO-дату YYYY-MM-DD
                    if parsed is None:
                        return Response({'error': 'Неверная дата рождения'}, status=status.HTTP_400_BAD_REQUEST)
                    profile.birth_date = parsed
                else:
                    profile.birth_date = bd                              # уже date-объект

            profile.save()                                               # сохраняем профиль ученика

            if user and any(k in data for k in ('student_name', 'student_surname', 'student_email')):
                user.first_name = (profile.name or '')[:150]            # синхронизируем имя в User
                user.last_name  = (profile.surname or '')[:150]         # синхронизируем фамилию в User
                user.save(update_fields=['first_name', 'last_name', 'email'])  # сохраняем только изменённые поля

        ts_fields = []                                                   # список полей TeachersStudent для сохранения

        if 'subject' in data:
            try:
                ts.subject = Subject.objects.get(id=int(data['subject']))  # меняем предмет
                ts_fields.append('subject')
            except (Subject.DoesNotExist, ValueError, TypeError):
                return Response({'error': 'Предмет не найден'}, status=status.HTTP_400_BAD_REQUEST)
        if 'level' in data:
            try:
                ts.level = Level.objects.get(id=int(data['level']))      # меняем уровень
                ts_fields.append('level')
            except (Level.DoesNotExist, ValueError, TypeError):
                return Response({'error': 'Уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)
        if 'grade' in data:
            g = str(data['grade'])
            valid_g = {c[0] for c in TeachersStudent.GRADE_CHOICES}      # допустимые классы из модели
            if g not in valid_g:
                return Response({'error': 'Неверный класс'}, status=status.HTTP_400_BAD_REQUEST)
            ts.grade = g
            ts_fields.append('grade')
        if 'goal' in data:
            raw = data.get('goal')
            ts.goal = (str(raw)[:200] if raw else '') or None             # цель обучения (макс. 200 символов)
            ts_fields.append('goal')
        if 'status' in data:
            st = str(data['status'])
            valid_s = {c[0] for c in TeachersStudent.STUDENTS_STATUS_CHOICES}  # допустимые статусы из модели
            if st not in valid_s:
                return Response({'error': 'Неверный статус'}, status=status.HTTP_400_BAD_REQUEST)
            ts.status = st
            ts_fields.append('status')

        if 'group_id' in data:                                           # явное указание group_id
            group_id = data.get('group_id')
            if group_id:                                                 # перемещаем в группу
                try:
                    group = Group.objects.get(id=int(group_id), teacher=teacher_profile)  # группа принадлежит учителю
                except (Group.DoesNotExist, ValueError, TypeError):
                    return Response({'error': 'Группа не найдена'}, status=status.HTTP_404_NOT_FOUND)
                ts.group = group
                ts.lesson_type = 'group'                                 # автоматически меняем тип занятия
            else:                                                        # group_id = null → переводим в индивидуальные
                ts.group = None
                ts.lesson_type = 'individual'
            ts_fields.extend(['group', 'lesson_type'])
        elif 'lesson_type' in data:                                      # изменение типа без явного group_id
            lt = str(data.get('lesson_type') or '')
            if lt == 'individual':                                       # переводим в индивидуальные
                ts.group = None
                ts.lesson_type = 'individual'
                ts_fields.extend(['group', 'lesson_type'])
            elif lt == 'group' and ts.group_id:                         # переводим в групповые (группа уже есть)
                ts.lesson_type = 'group'
                ts_fields.append('lesson_type')

        if ts_fields:
            ts.save(update_fields=list(dict.fromkeys(ts_fields)))        # сохраняем только изменённые поля (дедупликация)

        ts.refresh_from_db()                                             # обновляем объект из БД
        return Response(
            TeachersStudentSerializer(
                TeachersStudent.objects.select_related(                  # перезагружаем со всеми связями
                    'student', 'subject', 'level', 'group',
                ).get(pk=ts.pk),
            ).data,
        )

    def delete(self, request, pk):
        teacher_profile = self.get_teacher_profile(request)             # профиль учителя
        try:
            ts = TeachersStudent.objects.get(pk=pk, teacher=teacher_profile)  # ищем связь учитель-ученик
        except TeachersStudent.DoesNotExist:
            return Response({'error': 'Ученик не найден'}, status=status.HTTP_404_NOT_FOUND)
        ts.delete()                                                      # удаляем связь (не самого ученика)
        return Response(status=status.HTTP_204_NO_CONTENT)               # 204 No Content — успешное удаление


class MeProfile(APIView):
    permission_classes = [IsLKTeacher]                                   # учитель или ученик ЛК

    def get(self, request):
        try:
            profile = request.user.profile                               # профиль пользователя
            subject_names = list(
                TeacherSubject.objects.filter(teacher=profile)           # предметы учителя
                .values_list('subject__subject_name', flat=True)         # только имена предметов
            )
        except Exception:
            return Response({                                            # fallback для пользователей без профиля
                'username': request.user.username,
                'name': request.user.first_name or request.user.username,
                'surname': request.user.last_name or '',
                'email': request.user.email or '',
                'role': 'teacher',
                'subjects': [],
            })
        if profile.role == 'student':                                   # профиль ученика — без предметов
            return Response({
                'username': profile.username,
                'name': profile.name,
                'surname': profile.surname,
                'email': profile.email,
                'role': profile.role,
                'subjects': [],                                         # у ученика нет предметов в этом контексте
            })
        return Response({                                               # профиль учителя — с предметами
            'username': profile.username,
            'name': profile.name,
            'surname': profile.surname,
            'email': profile.email,
            'role': profile.role,
            'subjects': subject_names,                                  # список предметов учителя
        })


class GroupView(TeacherProfileMixin, APIView):
    permission_classes = [IsCabinetTeacher]                             # только учитель ЛК

    def get(self, request):
        teacher_profile = self.get_teacher_profile(request)            # профиль учителя
        groups = Group.objects.filter(teacher=teacher_profile).select_related('subject', 'level')  # группы учителя
        return Response(GroupSerializer(groups, many=True).data)        # список групп

    def post(self, request):
        ser = GroupCreateSerializer(data=request.data)                  # валидируем входящие данные группы
        if not ser.is_valid():
            return Response({'error': ser.errors}, status=status.HTTP_400_BAD_REQUEST)
        vd = ser.validated_data                                         # валидированные данные
        group_name = vd['group_name']                                   # название группы
        try:
            subj  = Subject.objects.get(id=vd['subject'])              # предмет группы
            level = Level.objects.get(id=vd['level'])                  # уровень группы
        except (Subject.DoesNotExist, Level.DoesNotExist):
            return Response({'error': 'Предмет или уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)
        teacher_profile = self.get_teacher_profile(request)
        group = Group.objects.create(                                   # создаём группу
            group_name=group_name,
            teacher=teacher_profile,
            subject=subj,
            level=level,
        )
        return Response(GroupSerializer(group).data, status=status.HTTP_201_CREATED)  # 201 Created


class LessonTokenView(APIView):
    """
    POST /api/lesson/token/
    Тело: { room_id, type: 'student'|'group', target_id, target_name, variant_id? }
    Ответ: { url, token, expires_in }
    """
    permission_classes = [IsCabinetTeacher]                             # только учитель ЛК

    def post(self, request):
        ser = LessonTokenSerializer(data=request.data)                  # валидируем параметры токена
        if not ser.is_valid():
            return Response({'error': ser.errors}, status=status.HTTP_400_BAD_REQUEST)
        vd          = ser.validated_data
        room_id     = vd['room_id']                                     # уникальный идентификатор комнаты урока
        lesson_type = vd['type']                                        # 'student' (инд.) или 'group' (групповой)
        target_id   = vd['target_id']                                   # ID ученика или группы
        target_name = vd['target_name']                                 # отображаемое имя ученика / группы
        variant_id  = vd.get('variant_id')                              # номер варианта (опционально)

        try:
            profile      = request.user.profile                        # профиль учителя
            teacher_name = f'{profile.name} {profile.surname}'.strip() # полное имя для Jitsi
        except Exception:
            return Response(
                {'error': 'Профиль учителя не найден'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if lesson_type == 'student':                                    # индивидуальное занятие
            from django.db.models import Q
            ts = TeachersStudent.objects.filter(
                teacher=profile,
                lesson_type='individual',
                status='1',                                             # только активные ученики
            ).filter(
                Q(id=target_id) | Q(student_id=target_id),             # принимаем и id связи, и id профиля ученика
            ).first()
            if not ts:
                return Response(
                    {'error': 'Ученик не найден или находится в архиве'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            target_id = ts.id                                           # нормализуем в id связи для остального пайплайна
        else:                                                           # групповое занятие
            if not Group.objects.filter(id=target_id, teacher=profile).exists():
                return Response({'error': 'Группа не найдена'}, status=status.HTTP_404_NOT_FOUND)

        from django.conf import settings as dj_settings
        import urllib.parse
        from urllib.parse import urlparse as _urlparse

        genurok_url = GENUROK_URL.rstrip('/')                          # базовый URL генератора без trailing slash

        now = int(time.time())                                         # текущий Unix-timestamp
        # jitsi_base = getattr(dj_settings, 'JITSI_BASE_URL', 'https://meet.jit.si').rstrip('/')  # URL Jitsi-сервера
        # room_slug  = re.sub(r'[^A-Za-z0-9_-]+', '-', room_id).strip('-') or f"lesson-{now}"  # безопасное имя комнаты
        # room_path  = urllib.parse.quote(room_slug, safe='-_')          # URL-кодирование имени комнаты

        # jitsi_app_id     = getattr(dj_settings, 'JITSI_APP_ID', '').strip()        # ID приложения Jitsi JWT
        # jitsi_jwt_secret = getattr(dj_settings, 'JITSI_JWT_SECRET', '').strip()    # секрет подписи Jitsi JWT
        # jitsi_hostname   = _urlparse(jitsi_base).hostname or 'meet.jit.si'          # hostname для поля sub в JWT

        # use_jitsi_jwt = bool(jitsi_app_id and jitsi_jwt_secret)       # использовать ли JWT для Jitsi

        # if use_jitsi_jwt:
        #     # Токен учителя: moderator=True → Jitsi выдаёт роль организатора автоматически
        #     teacher_jitsi_tok = _make_jitsi_jwt(
        #         teacher_name, room_slug, True, jitsi_app_id, jitsi_jwt_secret, jitsi_hostname
        #     )
        #     # Токен ученика: moderator=False → обычный участник
        #     student_jitsi_tok = _make_jitsi_jwt(
        #         target_name, room_slug, False, jitsi_app_id, jitsi_jwt_secret, jitsi_hostname
        #     )
        #     teacher_video_url = f"{jitsi_base}/{room_path}?jwt={teacher_jitsi_tok}"   # URL учителя с JWT
        #     student_video_url = f"{jitsi_base}/{room_path}?jwt={student_jitsi_tok}"   # URL ученика с JWT
        # else:
        #     # Fallback: meet.jit.si без JWT — только отображаемое имя через fragment
        #     teacher_jitsi_tok = ''
        #     student_jitsi_tok = ''

        #     def jitsi_url(display_name):
        #         safe_display = urllib.parse.quote((display_name or '').strip() or 'Участник', safe='')  # URL-кодируем имя
        #         return (
        #             f"{jitsi_base}/{room_path}"
        #             f"#userInfo.displayName=%22{safe_display}%22"               # имя в fragment (#)
        #             f"&config.prejoinPageEnabled=false"                          # отключаем экран ожидания
        #             f"&config.prejoinConfig.enabled=false"
        #         )

        #     teacher_video_url = jitsi_url(teacher_name)                # URL учителя без JWT
        #     student_video_url = jitsi_url(target_name)                 # URL ученика без JWT

        payload = {                                                     # тело ЛК-токена урока
            'iss':               'cabinet',                            # издатель токена
            'iat':               now,                                  # время выдачи
            'exp':               now + LESSON_TTL,                     # время истечения
            'room_id':           room_id,                              # оригинальный room_id
            'teacher_id':        request.user.id,                      # ID Django-пользователя учителя
            'teacher':           teacher_name,                         # имя учителя
            'lesson_format':     lesson_type,                          # 'student'/'group' — тип занятия, НЕ роль
            'target_id':         target_id,                            # ID ученика или группы
            'target_name':       target_name,                          # имя ученика / группы
            # 'jitsi_room':         room_slug,                           # slug комнаты Jitsi
            # 'teacher_jitsi_room': room_slug,                           # для обратной совместимости
            # 'student_jitsi_room': room_slug,                           # для обратной совместимости
            # 'video_url':          teacher_video_url,                   # legacy-поле (старые клиенты)
            # 'teacher_video_url':  teacher_video_url,                   # URL видео для учителя
            # 'student_video_url':  student_video_url,                   # URL видео для ученика
            # 'jitsi_jwt':         teacher_jitsi_tok,                    # Jitsi JWT учителя (пусто если не настроен)
            # 'student_jitsi_jwt': student_jitsi_tok,                    # Jitsi JWT ученика
        }
        if variant_id is not None:
            payload['variant_id'] = int(variant_id)

        token       = jwt.encode(payload, LESSON_SECRET, algorithm='HS256')          # подписываем ЛК-токен
        teacher_url = f'{genurok_url}/lesson/join/?token={token}&role=teacher'       # ссылка для учителя
        student_url = f'{genurok_url}/lesson/join/?token={token}&role=student'       # ссылка для ученика

        return Response({
            'url':         teacher_url,   # URL учителя для открытия урока
            'student_url': student_url,   # URL ученика для отправки в уведомлении
            'token':       token,         # сам токен (для дополнительных нужд)
            'expires_in':  LESSON_TTL,    # время жизни в секундах
            'variant_id':  variant_id,    # номер варианта (если передан)
            # Явно передаём роли вместе с тем же токеном.
            'teacher_role': 'teacher',
            'student_role': 'student',
            'teacher': {'role': 'teacher', 'url': teacher_url, 'token': token},
            'student': {'role': 'student', 'url': student_url, 'token': token},
        })


class LessonStart(APIView):
    """
    POST /api/lesson/start/
    Создаёт токен урока и LessonInvite со статусом scheduled (без звонка ученику).
    Звонок и pending — после POST /api/lesson/teacher-joined/ со стороны генератора.
    Тело: { room_id, type: 'student'|'group', target_id, target_name, variant_id? }
    """

    permission_classes = [IsCabinetTeacher]
   
    def post(self, request):
        # 1. Получаем токен через LessonTokenView
        token_view = LessonTokenView()
        token_response = token_view.post(request)
        if token_response.status_code != 200:
            return token_response

        data = token_response.data
        token = data['token']
        vd = LessonTokenSerializer(data=request.data)
        if not vd.is_valid():
            return Response({'error': vd.errors}, status=status.HTTP_400_BAD_REQUEST)
        target_id   = vd.validated_data['target_id']
        target_name = vd.validated_data['target_name']
        lesson_type = vd.validated_data['type']
        variant_id  = vd.validated_data.get('variant_id')

        # 2. Сохраняем инвайт в БД
        try:
            profile = request.user.profile
        except Exception:
            return Response(
                {'error': 'Профиль учителя не найден'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        LessonInvite.objects.create(
            teacher=profile,
            target_type='ind' if lesson_type == 'student' else 'group',
            target_id=target_id,
            target_name=target_name,
            token=token,
            expires_at=timezone.now() + timedelta(seconds=LESSON_TTL),
            lesson_link=data['student_url'],
            status='pending',
        )

        teacher_name = f'{profile.name} {profile.surname}'.strip() or 'Учитель'
        invite_payload = {
            "event": "incoming_lesson",
            "teacher": teacher_name,
            "target_name": target_name,
            "lesson_type": lesson_type,
            "student_url": data.get('student_url'),
            "token": token,
            "role": "student",
        }
        if variant_id is not None:
            invite_payload["variant_id"] = int(variant_id)

        notify_user_ids = []
        notify_profile_ids = []
        notify_usernames = []
        if lesson_type == 'student':
            try:
                ts = TeachersStudent.objects.select_related('student__user').get(
                    pk=target_id,
                    teacher=profile,
                )
            except TeachersStudent.DoesNotExist:
                ts = TeachersStudent.objects.select_related('student__user').filter(
                    teacher=profile,
                    student_id=target_id,
                ).first()
            if ts and ts.student:
                notify_profile_ids.append(int(ts.student.id))
                if ts.student.user_id:
                    notify_user_ids.append(int(ts.student.user_id))
                if ts.student.username:
                    notify_usernames.append(str(ts.student.username))
                if ts.student.user and ts.student.user.username:
                    notify_usernames.append(str(ts.student.user.username))
        else:
            grp_exists = Group.objects.filter(id=target_id, teacher=profile).exists()
            if grp_exists:
                for row in TeachersGroup.objects.filter(group_id=target_id).select_related('student', 'student__user'):
                    sid = getattr(row.student, 'id', None)
                    uid = getattr(row.student, 'user_id', None)
                    susername = getattr(row.student, 'username', None)
                    uusername = getattr(getattr(row.student, 'user', None), 'username', None)
                    if sid:
                        notify_profile_ids.append(int(sid))
                    if uid:
                        notify_user_ids.append(int(uid))
                    if susername:
                        notify_usernames.append(str(susername))
                    if uusername:
                        notify_usernames.append(str(uusername))

        notify_user_ids = list(dict.fromkeys(notify_user_ids))
        notify_profile_ids = list(dict.fromkeys(notify_profile_ids))
        notify_usernames = list(dict.fromkeys(notify_usernames))

        for uid in notify_user_ids:
            cache.set(f'lesson_pending_invite_user:{uid}', invite_payload, timeout=LESSON_TTL)
        for pid in notify_profile_ids:
            cache.set(f'lesson_pending_invite_profile:{pid}', invite_payload, timeout=LESSON_TTL)
        for uname in notify_usernames:
            cache.set(f'lesson_pending_invite_username:{uname}', invite_payload, timeout=LESSON_TTL)

        ws_sent = False
        if notify_user_ids:
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                for uid in notify_user_ids:
                    async_to_sync(channel_layer.group_send)(
                        f"user_{uid}",
                        {
                            "type": "notify_message",
                            "data": invite_payload,
                        },
                    )
                ws_sent = True
            except Exception:
                ws_sent = False

        if variant_id is not None:
            data['variant_id'] = int(variant_id)
        data['invite_sent'] = bool(notify_user_ids)
        data['ws_sent'] = ws_sent
        data['debug_notify_user_ids'] = notify_user_ids
        data['debug_notify_profile_ids'] = notify_profile_ids
        data['debug_notify_usernames'] = notify_usernames
        return Response(data)


class LessonTeacherJoinedView(APIView):
    """
    POST /api/lesson/teacher-joined/
    Тело: { token }
    Вызывается Генератором, когда учитель реально открыл /lesson/join/?...&role=teacher.
    """
    authentication_classes = []   # без стандартной аутентификации — запрос от Генератора
    permission_classes     = []   # без стандартных разрешений
    throttle_classes       = []   # лимит — секрет вебхука + проверка JWT

    def post(self, request):
        webhook_secret = (getattr(settings, 'LESSON_WEBHOOK_SECRET', None) or '').strip()  # секрет вебхука из settings
        if webhook_secret:
            if (request.headers.get('X-Lesson-Webhook-Secret') or '').strip() != webhook_secret:  # проверяем заголовок
                return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
        elif not settings.DEBUG:
            return Response(                                             # на проде без секрета — ошибка конфигурации
                {'error': 'LESSON_WEBHOOK_SECRET is not configured'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        token = (request.data.get('token') or '').strip()             # читаем ЛК-токен из тела запроса
        if not token:
            return Response({'error': 'token required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = jwt.decode(                                      # декодируем и верифицируем токен
                token,
                LESSON_SECRET,
                algorithms=['HS256'],
                options={'require': ['exp']},                          # exp обязателен (проверяем срок действия)
            )
        except Exception:
            return Response({'error': 'invalid token'}, status=status.HTTP_401_UNAUTHORIZED)

        if payload.get('iss') != 'cabinet':                           # токен должен быть от нашего кабинета
            return Response({'error': 'invalid token issuer'}, status=status.HTTP_401_UNAUTHORIZED)

        room_id      = str(payload.get('room_id') or '').strip()      # ID комнаты из токена
        target_id    = payload.get('target_id')                       # ID ученика / группы
        teacher_uid  = payload.get('teacher_id')                      # ID учителя для проверки прав
        teacher_name = str(payload.get('teacher') or '').strip() or 'Учитель'   # имя учителя
        target_name  = str(payload.get('target_name') or '').strip() or 'Ученик'  # имя ученика
        lesson_type  = str(payload.get('lesson_format') or payload.get('type') or 'student').strip() or 'student'  # тип занятия
        variant_id   = payload.get('variant_id')                       # номер варианта (если передан)
        genurok_url  = GENUROK_URL.rstrip('/')                        # URL генератора
        student_url  = f'{genurok_url}/lesson/join/?token={token}&role=student'  # ссылка для ученика

        # Дедупликация: предотвращаем повторную отправку приглашений за время жизни токена
        already_sent = False
        if room_id:
            cache_key    = f'lesson_invite_sent:{room_id}'            # ключ дедупликации по room_id
            already_sent = not cache.add(cache_key, 1, timeout=LESSON_TTL)  # add возвращает False если ключ уже есть
        if already_sent:
            return Response({
                'ok': True,
                'student_url': student_url,
                'ws_sent': False,
                'already_sent': True,
                'variant_id': variant_id,
                'student_role': 'student',
            })

        # Учитель в комнате: переводим из scheduled → pending и включаем звонок ученику.
        LessonInvite.objects.filter(token=token, status__in=['scheduled', 'pending']).update(
            status='pending',
            lesson_link=student_url,
        )

        invite_payload = {                                            # данные приглашения для ученика
            "event":       "incoming_lesson",                        # тип события
            "teacher":     teacher_name,                             # имя учителя
            "target_name": target_name,                              # имя ученика / группы
            "lesson_type": lesson_type,                              # тип занятия
            "student_url": student_url,                              # ссылка для подключения
            "token":       token,                                    # JWT токен урока
            "role":        "student",                                # роль получателя приглашения
        }
        if variant_id is not None:
            invite_payload["variant_id"] = variant_id

        # Собираем user_id/profile_id всех учеников которым нужно отправить уведомление
        notify_user_ids: list[int] = []
        notify_profile_ids: list[int] = []
        notify_usernames: list[str] = []
        if target_id is not None and lesson_type == 'student':       # индивидуальное занятие
            try:
                ts = TeachersStudent.objects.select_related(
                    'student__user', 'teacher__user'
                ).get(pk=target_id)                                   # связь учитель-ученик
            except TeachersStudent.DoesNotExist:
                ts = TeachersStudent.objects.select_related(
                    'student__user', 'teacher__user'
                ).filter(
                    teacher__user_id=teacher_uid,
                    student_id=target_id,
                ).first()
            if ts:
                if teacher_uid is not None and int(teacher_uid) != ts.teacher.user_id:  # проверяем что учитель совпадает
                    return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
                if ts.student:
                    notify_profile_ids.append(int(ts.student.id))
                    if ts.student.user_id:
                        notify_user_ids.append(int(ts.student.user_id))  # добавляем ID ученика
                    if ts.student.username:
                        notify_usernames.append(str(ts.student.username))
                    if ts.student.user and ts.student.user.username:
                        notify_usernames.append(str(ts.student.user.username))
        elif target_id is not None and lesson_type == 'group':        # групповое занятие
            try:
                grp = Group.objects.select_related('teacher', 'teacher__user').get(pk=target_id)
            except Group.DoesNotExist:
                grp = None
            if grp:
                if teacher_uid is not None and int(teacher_uid) != grp.teacher.user_id:  # проверяем владельца группы
                    return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
                for row in TeachersGroup.objects.filter(group_id=target_id).select_related(
                    'student', 'student__user'
                ):
                    sid = getattr(row.student, 'id', None)
                    uid = getattr(row.student, 'user_id', None)      # user_id каждого члена группы
                    susername = getattr(row.student, 'username', None)
                    uusername = getattr(getattr(row.student, 'user', None), 'username', None)
                    if sid:
                        notify_profile_ids.append(int(sid))
                    if uid:
                        notify_user_ids.append(int(uid))             # добавляем в список уведомлений
                    if susername:
                        notify_usernames.append(str(susername))
                    if uusername:
                        notify_usernames.append(str(uusername))

        # Сохраняем pending invite в кэш — ученик получит при следующем GET /api/lesson/pending/
        notify_user_ids = list(dict.fromkeys(notify_user_ids))
        notify_profile_ids = list(dict.fromkeys(notify_profile_ids))
        notify_usernames = list(dict.fromkeys(notify_usernames))
        for uid in notify_user_ids:
            cache.set(f'lesson_pending_invite_user:{uid}', invite_payload, timeout=LESSON_TTL)
        for pid in notify_profile_ids:
            cache.set(f'lesson_pending_invite_profile:{pid}', invite_payload, timeout=LESSON_TTL)
        for uname in notify_usernames:
            cache.set(f'lesson_pending_invite_username:{uname}', invite_payload, timeout=LESSON_TTL)

        ws_sent = False                                               # флаг: отправлено ли через WebSocket
        if notify_user_ids:
            try:
                from channels.layers import get_channel_layer        # Django Channels для WebSocket
                from asgiref.sync import async_to_sync               # запуск async-кода из sync-контекста
                channel_layer = get_channel_layer()                  # получаем channel layer (Redis)
                for uid in notify_user_ids:
                    async_to_sync(channel_layer.group_send)(         # отправляем сообщение в WS-группу пользователя
                        f"user_{uid}",                               # имя WS-группы: user_<id>
                        {
                            "type": "notify_message",                # тип обработчика в consumer
                            "data": invite_payload,                  # данные приглашения
                        },
                    )
                ws_sent = True                                        # WebSocket-отправка успешна
            except Exception:
                ws_sent = False                                       # Channels не настроен или ошибка

        return Response({
            'ok':           True,                                    # успешная обработка
            'student_url':  student_url,                             # ссылка для ученика (для логов Генератора)
            'ws_sent':      ws_sent,                                 # отправлено ли через WS
            'already_sent': already_sent,                            # было ли уже отправлено (дедупликация)
            'variant_id':   variant_id,                              # номер варианта (если передан)
            'student_role': 'student',
        })


class LessonPendingInviteView(APIView):
    """
    GET /api/lesson/pending/
    Возвращает pending invite для текущего пользователя (если есть) и очищает его.
    Нужен ученику (fallback, если WS не доставил).
    """
    permission_classes = [IsAuthenticated]                           # любой авторизованный пользователь

    def get(self, request):
        user_id = getattr(request.user, 'id', None)                  # ID текущего пользователя
        profile = getattr(request.user, 'profile', None)
        profile_id = getattr(profile, 'id', None)
        profile_username = str(getattr(profile, 'username', '') or '').strip()
        user_username = str(getattr(request.user, 'username', '') or '').strip()
        if not user_id and not profile_id:
            return Response({'ok': True, 'invite': None})            # анонимный — нет приглашения

        cached_invites = []
        if user_id:
            cached_invites.append(cache.get(f'lesson_pending_invite_user:{user_id}'))
        if profile_id:
            cached_invites.append(cache.get(f'lesson_pending_invite_profile:{profile_id}'))
        if profile_username:
            cached_invites.append(cache.get(f'lesson_pending_invite_username:{profile_username}'))
        if user_username and user_username != profile_username:
            cached_invites.append(cache.get(f'lesson_pending_invite_username:{user_username}'))
        for invite in cached_invites:
            if invite:
                tok = str(invite.get('token') or '')
                if tok and _lesson_ring_dismiss_is_set_for_request(request, tok):
                    continue
                return Response({'ok': True, 'invite': invite})

        # Надёжный fallback: ищем активный LessonInvite в БД.
        # Это защищает от потери cache/WS в dev и при перезапусках.
        now = timezone.now()
        student_link_ids = []
        group_ids = []
        student_target_ids = []
        if profile_id:
            student_link_ids = list(
                TeachersStudent.objects.filter(student_id=profile_id).values_list('id', flat=True)
            )
            student_target_ids = student_link_ids + [int(profile_id)]
            group_ids = list(
                TeachersGroup.objects.filter(student_id=profile_id).values_list('group_id', flat=True)
            )
        elif user_id:
            student_link_ids = list(
                TeachersStudent.objects.filter(student__user_id=user_id).values_list('id', flat=True)
            )
            student_profile_ids = list(
                TeachersStudent.objects.filter(student__user_id=user_id).values_list('student_id', flat=True)
            )
            student_target_ids = student_link_ids + student_profile_ids
            group_ids = list(
                TeachersGroup.objects.filter(student__user_id=user_id).values_list('group_id', flat=True)
            )
        qs = LessonInvite.objects.filter(expires_at__gt=now, status='pending')
        if student_target_ids or group_ids:
            from django.db.models import Q
            q = Q()
            if student_target_ids:
                q |= Q(target_type='ind', target_id__in=student_target_ids)
            if group_ids:
                q |= Q(target_type='group', target_id__in=group_ids)
            qs = qs.filter(q)
        else:
            qs = LessonInvite.objects.none()

        invite_obj = qs.select_related('teacher').order_by('-created_at').first()
        if not invite_obj:
            return Response({'ok': True, 'invite': None})            # нет ожидающего приглашения

        payload = {
            'event': 'incoming_lesson',
            'teacher': f'{invite_obj.teacher.name} {invite_obj.teacher.surname}'.strip() or 'Учитель',
            'target_name': invite_obj.target_name,
            'lesson_type': 'group' if invite_obj.target_type == 'group' else 'student',
            'student_url': invite_obj.lesson_link,
            'token': invite_obj.token,
            'role': 'student',
        }
        try:
            token_payload = jwt.decode(
                invite_obj.token,
                LESSON_SECRET,
                algorithms=['HS256'],
                options={'verify_exp': False},
            )
            if token_payload.get('variant_id') is not None:
                payload['variant_id'] = token_payload.get('variant_id')
        except Exception:
            pass

        if _lesson_ring_dismiss_is_set_for_request(request, invite_obj.token):
            return Response({'ok': True, 'invite': None})

        return Response({'ok': True, 'invite': payload})


class LessonStudentJoinedView(APIView):
    """
    POST /api/lesson/student-joined/
    ЛК (cookie): тело { token? } — ученик нажал «Присоединиться» или вошёл из ЛК.
    Генератор (вебхук): заголовок X-Lesson-Webhook-Secret, тело { token, student_user_id? }.
    Для группового урока student_user_id обязателен (Django user id вошедшего ученика).
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        webhook_secret = (getattr(settings, 'LESSON_WEBHOOK_SECRET', None) or '').strip()
        hdr = (request.headers.get('X-Lesson-Webhook-Secret') or '').strip()
        if webhook_secret:
            if hdr == webhook_secret:
                return self._post_webhook(request)
            if hdr:
                return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
        elif settings.DEBUG and request.data.get('token') and not request.user.is_authenticated:
            return self._post_webhook(request)
        if request.user.is_authenticated:
            return self._post_session(request)
        return Response({'ok': False, 'error': 'unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)

    def _post_session(self, request):
        user_id = getattr(request.user, 'id', None)
        profile = getattr(request.user, 'profile', None)
        profile_id = getattr(profile, 'id', None)
        if not user_id and not profile_id:
            return Response({'ok': False, 'error': 'unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)

        profile_username = str(getattr(profile, 'username', '') or '').strip()
        user_username = str(getattr(request.user, 'username', '') or '').strip()
        _lesson_pending_cache_delete_user_keys(user_id, profile_id, profile_username, user_username)

        token = str(request.data.get('token') or '').strip()
        now = timezone.now()
        student_link_ids = []
        group_ids = []
        student_target_ids = []
        if profile_id:
            student_link_ids = list(
                TeachersStudent.objects.filter(student_id=profile_id).values_list('id', flat=True)
            )
            student_target_ids = student_link_ids + [int(profile_id)]
            group_ids = list(
                TeachersGroup.objects.filter(student_id=profile_id).values_list('group_id', flat=True)
            )
        elif user_id:
            student_link_ids = list(
                TeachersStudent.objects.filter(student__user_id=user_id).values_list('id', flat=True)
            )
            student_profile_ids = list(
                TeachersStudent.objects.filter(student__user_id=user_id).values_list('student_id', flat=True)
            )
            student_target_ids = student_link_ids + student_profile_ids
            group_ids = list(
                TeachersGroup.objects.filter(student__user_id=user_id).values_list('group_id', flat=True)
            )
        qs = LessonInvite.objects.filter(expires_at__gt=now)
        if token:
            qs = qs.filter(token=token)

        pending_rows = []
        if student_target_ids or group_ids:
            from django.db.models import Q
            q = Q()
            if student_target_ids:
                q |= Q(target_type='ind', target_id__in=student_target_ids)
            if group_ids:
                q |= Q(target_type='group', target_id__in=group_ids)
            qs = qs.filter(q)
            qs = qs.filter(status='pending')
            pending_rows = list(qs)
            for inv in pending_rows:
                if inv.target_type == 'ind':
                    LessonInvite.objects.filter(pk=inv.pk, status='pending').update(
                        expires_at=now,
                        status='accepted',
                    )

        eff_token = token or (pending_rows[0].token if pending_rows else '')
        if eff_token:
            _lesson_ring_dismiss_mark(
                user_id, profile_id, profile_username, user_username, eff_token,
            )
            if user_id:
                _ws_notify_users_payload(
                    [user_id],
                    {'event': 'student_joined_lesson', 'token': eff_token},
                )

        return Response({'ok': True})

    def _post_webhook(self, request):
        webhook_secret = (getattr(settings, 'LESSON_WEBHOOK_SECRET', None) or '').strip()
        if webhook_secret:
            if (request.headers.get('X-Lesson-Webhook-Secret') or '').strip() != webhook_secret:
                return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
        elif not settings.DEBUG:
            return Response(
                {'error': 'LESSON_WEBHOOK_SECRET is not configured'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        token = str(request.data.get('token') or '').strip()
        if not token:
            return Response({'error': 'token required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = jwt.decode(
                token,
                LESSON_SECRET,
                algorithms=['HS256'],
                options={'require': ['exp']},
            )
        except Exception:
            return Response({'error': 'invalid token'}, status=status.HTTP_401_UNAUTHORIZED)
        if payload.get('iss') != 'cabinet':
            return Response({'error': 'invalid token issuer'}, status=status.HTTP_401_UNAUTHORIZED)

        lesson_type = str(payload.get('lesson_format') or payload.get('type') or 'student').strip() or 'student'
        target_id = payload.get('target_id')
        teacher_uid = payload.get('teacher_id')
        nu, np, nuname = _lesson_jwt_recipients_for_ring_stop(lesson_type, target_id, teacher_uid)
        if nu is None:
            return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)

        student_user_id_raw = request.data.get('student_user_id')
        ws_user_ids = []

        if lesson_type == 'group':
            if student_user_id_raw is None or str(student_user_id_raw).strip() == '':
                return Response({'error': 'student_user_id required for group lessons'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                suid = int(student_user_id_raw)
            except (TypeError, ValueError):
                return Response({'error': 'invalid student_user_id'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                u = User.objects.select_related('profile').get(pk=suid)
            except User.DoesNotExist:
                return Response({'error': 'user not found'}, status=status.HTTP_404_NOT_FOUND)
            if suid not in nu:
                return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
            prof = getattr(u, 'profile', None)
            pid = getattr(prof, 'id', None)
            pun = str(getattr(prof, 'username', '') or '').strip()
            uun = str(u.username or '').strip()
            _lesson_pending_cache_delete_user_keys(suid, pid, pun, uun)
            _lesson_ring_dismiss_mark(suid, pid, pun, uun, token)
            ws_user_ids = [suid]
        else:
            if not nu:
                return Response({'error': 'cannot resolve lesson recipients'}, status=status.HTTP_400_BAD_REQUEST)
            LessonInvite.objects.filter(token=token, status='pending').update(
                expires_at=timezone.now(),
                status='accepted',
            )
            for uid in nu:
                cache.delete(f'lesson_pending_invite_user:{uid}')
            for pid in np:
                cache.delete(f'lesson_pending_invite_profile:{pid}')
            for uname in nuname:
                cache.delete(f'lesson_pending_invite_username:{uname}')
            for uid in nu:
                try:
                    u = User.objects.select_related('profile').get(pk=uid)
                    prof = getattr(u, 'profile', None)
                    _lesson_ring_dismiss_mark(
                        uid,
                        getattr(prof, 'id', None),
                        str(getattr(prof, 'username', '') or '').strip(),
                        str(u.username or '').strip(),
                        token,
                    )
                except User.DoesNotExist:
                    _lesson_ring_dismiss_mark(uid, None, '', '', token)
            ws_user_ids = list(nu)

        if ws_user_ids:
            _ws_notify_users_payload(
                ws_user_ids,
                {'event': 'student_joined_lesson', 'token': token},
            )
        return Response({'ok': True})


class LessonStudentRejectView(APIView):
    """
    POST /api/lesson/student-reject/
    Тело: { token }
    Ученик отклонил звонок или сработал таймаут.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user_id = getattr(request.user, 'id', None)
        profile = getattr(request.user, 'profile', None)
        profile_id = getattr(profile, 'id', None)
        if not user_id and not profile_id:
            return Response({'ok': False, 'error': 'unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)

        profile_username = str(getattr(profile, 'username', '') or '').strip()
        user_username = str(getattr(request.user, 'username', '') or '').strip()
        _lesson_pending_cache_delete_user_keys(user_id, profile_id, profile_username, user_username)

        token = str(request.data.get('token') or '').strip()
        if token:
            _lesson_ring_dismiss_mark(
                user_id, profile_id, profile_username, user_username, token,
            )

        return Response({'ok': True})


class LessonTeacherLeftView(APIView):
    """
    POST /api/lesson/teacher-left/
    Тело: { token }
    Вызывается, когда учитель завершил урок: гасим активный звонок ученикам.
    """
    authentication_classes = []
    permission_classes = []
    throttle_classes = []

    def post(self, request):
        webhook_secret = (getattr(settings, 'LESSON_WEBHOOK_SECRET', None) or '').strip()
        if webhook_secret:
            if (request.headers.get('X-Lesson-Webhook-Secret') or '').strip() != webhook_secret:
                return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
        elif not settings.DEBUG:
            return Response(
                {'error': 'LESSON_WEBHOOK_SECRET is not configured'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        token = (request.data.get('token') or '').strip()
        if not token:
            return Response({'error': 'token required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            payload = jwt.decode(
                token,
                LESSON_SECRET,
                algorithms=['HS256'],
                options={'require': ['exp']},
            )
        except Exception:
            return Response({'error': 'invalid token'}, status=status.HTTP_401_UNAUTHORIZED)

        if payload.get('iss') != 'cabinet':
            return Response({'error': 'invalid token issuer'}, status=status.HTTP_401_UNAUTHORIZED)

        target_id = payload.get('target_id')
        lesson_type = str(payload.get('lesson_format') or payload.get('type') or 'student').strip() or 'student'
        notify_user_ids = []
        notify_profile_ids = []
        notify_usernames = []

        if target_id is not None and lesson_type == 'student':
            try:
                ts = TeachersStudent.objects.select_related('student__user').get(pk=target_id)
            except TeachersStudent.DoesNotExist:
                ts = TeachersStudent.objects.select_related('student__user').filter(student_id=target_id).first()
            if ts and ts.student:
                notify_profile_ids.append(int(ts.student.id))
                if ts.student.user_id:
                    notify_user_ids.append(int(ts.student.user_id))
                if ts.student.username:
                    notify_usernames.append(str(ts.student.username))
                if ts.student.user and ts.student.user.username:
                    notify_usernames.append(str(ts.student.user.username))
        elif target_id is not None and lesson_type == 'group':
            for row in TeachersGroup.objects.filter(group_id=target_id).select_related('student', 'student__user'):
                sid = getattr(row.student, 'id', None)
                uid = getattr(row.student, 'user_id', None)
                susername = getattr(row.student, 'username', None)
                uusername = getattr(getattr(row.student, 'user', None), 'username', None)
                if sid:
                    notify_profile_ids.append(int(sid))
                if uid:
                    notify_user_ids.append(int(uid))
                if susername:
                    notify_usernames.append(str(susername))
                if uusername:
                    notify_usernames.append(str(uusername))

        notify_user_ids = list(dict.fromkeys(notify_user_ids))
        notify_profile_ids = list(dict.fromkeys(notify_profile_ids))
        notify_usernames = list(dict.fromkeys(notify_usernames))
        for uid in notify_user_ids:
            cache.delete(f'lesson_pending_invite_user:{uid}')
        for pid in notify_profile_ids:
            cache.delete(f'lesson_pending_invite_profile:{pid}')
        for uname in notify_usernames:
            cache.delete(f'lesson_pending_invite_username:{uname}')

        cancel_payload = {'event': 'lesson_call_cancelled', 'token': token}
        if notify_user_ids:
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                for uid in notify_user_ids:
                    async_to_sync(channel_layer.group_send)(
                        f"user_{uid}",
                        {
                            'type': 'notify_message',
                            'data': cancel_payload,
                        },
                    )
            except Exception:
                pass

        LessonInvite.objects.filter(token=token, status__in=['pending', 'scheduled']).update(
            status='cancelled',
            expires_at=timezone.now(),
        )

        return Response({'ok': True})


# ── Homework API ───────────────────────────────────────────────────────────────

def _detect_file_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()                      # расширение файла в нижнем регистре
    if ext in {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'}:  # изображения
        return 'image'
    if ext in {'.mp4', '.mov', '.avi', '.mkv', '.webm'}:            # видеофайлы
        return 'video'
    if ext in {'.mp3', '.wav', '.ogg', '.m4a', '.flac'}:            # аудиофайлы
        return 'audio'
    return 'file'                                                    # прочие файлы — общий тип


def _notify(user_profile, text, notification_type, assignment=None):
    Notification.objects.create(                                     # создаём запись уведомления в БД
        user=user_profile,                                           # кому адресовано
        text=text,                                                   # текст уведомления
        notification_type=notification_type,                         # тип (homework_assigned, submitted, …)
        read=False,                                                  # новое уведомление — непрочитанное
        homework_assignment=assignment,                              # ссылка на назначение ДЗ (опционально)
    )


class HomeworkListView(TeacherProfileMixin, APIView):
    """
    GET  /api/homework/        — список ДЗ учителя
    POST /api/homework/        — создать ДЗ (учитель)
    """
    permission_classes = [IsCabinetTeacher]                         # только учитель ЛК

    def get(self, request):
        teacher = self.get_teacher_profile(request)
        qs = Homework.objects.filter(teacher=teacher).prefetch_related('attachments', 'assignments')  # все ДЗ учителя
        return Response(HomeworkSerializer(qs, many=True, context={'request': request}).data)  # список ДЗ

    def post(self, request):
        teacher    = self.get_teacher_profile(request)
        variant_id = request.data.get('variant_id')                 # ID варианта из генератора (обязателен)
        if not variant_id:
            return Response({'error': 'variant_id обязателен'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            variant_id = int(variant_id)                            # конвертируем в int
        except (TypeError, ValueError):
            return Response({'error': 'variant_id должен быть числом'}, status=status.HTTP_400_BAD_REQUEST)

        hw = Homework.objects.create(                               # создаём ДЗ
            variant_id=variant_id,
            title=request.data.get('title', ''),                    # заголовок (опционально)
            text=request.data.get('text', ''),                      # описание (опционально)
            subject=request.data.get('subject', ''),                # предмет как строка (опционально)
            teacher=teacher,
            deadline=request.data.get('deadline') or timezone.now() + timezone.timedelta(days=1),  # дедлайн (по умолчанию +1 день)
        )
        return Response(HomeworkSerializer(hw, context={'request': request}).data, status=status.HTTP_201_CREATED)


class HomeworkDetailView(APIView):
    """
    GET    /api/homework/<id>/  — детали ДЗ
    PATCH  /api/homework/<id>/  — обновить
    DELETE /api/homework/<id>/  — удалить
    """
    permission_classes = [IsCabinetTeacher]                         # только учитель ЛК

    def _get_hw(self, request, pk):
        teacher = request.user.profile                              # профиль учителя
        try:
            return Homework.objects.prefetch_related('attachments', 'assignments').get(pk=pk, teacher=teacher)  # ДЗ принадлежит этому учителю
        except Homework.DoesNotExist:
            return None                                             # не найдено или чужое ДЗ

    def get(self, request, pk):
        hw = self._get_hw(request, pk)
        if not hw:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        return Response(HomeworkSerializer(hw, context={'request': request}).data)  # детали ДЗ

    def patch(self, request, pk):
        hw = self._get_hw(request, pk)
        if not hw:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        for field in ('title', 'text', 'subject'):                 # безопасные строковые поля — без доп. валидации
            if field in request.data:
                setattr(hw, field, request.data[field])

        if 'variant_id' in request.data:                           # variant_id должен быть целым числом
            try:
                hw.variant_id = int(request.data['variant_id'])
            except (TypeError, ValueError):
                return Response({'error': 'variant_id должен быть числом'}, status=status.HTTP_400_BAD_REQUEST)

        if 'deadline' in request.data:                             # deadline должен быть валидной ISO 8601 датой/датавременем
            dl = request.data['deadline']
            if dl in (None, '', 'null'):
                hw.deadline = None
            else:
                from django.utils.dateparse import parse_datetime as _parse_dt
                parsed = _parse_dt(str(dl))
                if parsed is None:                                 # parse_datetime не смогла распознать формат
                    return Response(
                        {'error': 'Неверный формат deadline — ожидается ISO 8601 (например 2025-06-01T23:59:00)'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                hw.deadline = parsed

        hw.save()                                                  # сохраняем только изменённые поля
        return Response(HomeworkSerializer(hw, context={'request': request}).data)

    def delete(self, request, pk):
        hw = self._get_hw(request, pk)
        if not hw:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        hw.delete()                                                 # каскадное удаление attachments и assignments
        return Response(status=status.HTTP_204_NO_CONTENT)


class HomeworkAssignView(APIView):
    """
    POST /api/homework/<id>/assign/
    Тело: { student_ids: [1,2,3] } и/или { group_id: 5 }
    Назначает ДЗ ученикам.
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        teacher = request.user.profile                              # профиль учителя
        try:
            hw = Homework.objects.get(pk=pk, teacher=teacher)      # ДЗ принадлежит учителю
        except Homework.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        student_ids = request.data.get('student_ids') or []        # явный список ID учеников
        group_id    = request.data.get('group_id')                 # или ID группы

        if group_id:                                               # если указана группа — раскрываем её в список учеников
            from .models import TeachersGroup
            group_student_ids = TeachersGroup.objects.filter(
                group_id=group_id, group__teacher=teacher,         # только участники группы этого учителя
            ).values_list('student_id', flat=True)
            student_ids = list(student_ids) + list(group_student_ids)  # объединяем оба источника

        if not student_ids:
            return Response({'error': 'Укажите student_ids или group_id'}, status=status.HTTP_400_BAD_REQUEST)

        # Проверяем что все ID принадлежат ученикам этого учителя
        valid_ids = set(
            TeachersStudent.objects.filter(
                teacher=teacher, student_id__in=student_ids,
            ).values_list('student_id', flat=True)
        )

        created, skipped = 0, 0                                    # счётчики созданных и пропущенных назначений
        for sid in set(student_ids):                               # дедупликация ID
            if sid not in valid_ids:                               # чужой или несуществующий ученик
                skipped += 1
                continue
            try:
                student = UserProfile.objects.get(pk=sid)         # профиль ученика
            except UserProfile.DoesNotExist:
                skipped += 1
                continue
            assignment, is_new = HomeworkAssignment.objects.get_or_create(  # идемпотентное создание
                homework=hw, student=student,
                defaults={'status': 'sent'},                       # статус при первом назначении
            )
            if is_new:                                             # только для новых назначений
                created += 1
                title = hw.title or f'Вариант {hw.variant_id}'
                _notify(                                           # уведомляем ученика о новом ДЗ
                    student,
                    f'Новое домашнее задание: {title}',
                    'homework_assigned',
                    assignment=assignment,
                )
                suid = getattr(student, 'user_id', None)
                if suid:
                    _ws_notify_users_payload(
                        [suid],
                        {
                            'event': 'homework_assigned',
                            'assignment_id': assignment.pk,
                        },
                    )
                try:
                    _ensure_homework_room_credentials(assignment, save=True)
                except Exception:
                    pass

        return Response({'created': created, 'skipped': skipped}) # итоги назначения


class HomeworkUploadAttachmentView(APIView):
    """
    POST /api/homework/upload-attachment/
    Тело: multipart { homework_id, file }
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        teacher = request.user.profile
        hw_id   = request.data.get('homework_id')                  # ID ДЗ к которому прикрепляем файл
        f       = request.FILES.get('file')                        # загружаемый файл
        if not hw_id or not f:
            return Response({'error': 'homework_id и file обязательны'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            hw = Homework.objects.get(pk=hw_id, teacher=teacher)   # ДЗ принадлежит учителю
        except Homework.DoesNotExist:
            return Response({'error': 'ДЗ не найдено'}, status=status.HTTP_404_NOT_FOUND)
        filename  = f.name                                         # оригинальное имя файла
        file_type = _detect_file_type(filename)                    # определяем тип по расширению
        att = HomeworkAttachment.objects.create(                   # создаём вложение
            homework=hw, file=f, filename=filename, file_type=file_type,
        )
        return Response(
            HomeworkAttachmentSerializer(att, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class HomeworkMyView(APIView):
    """
    GET /api/homework/my/
    ДЗ текущего ученика.
    """
    permission_classes = [IsLKTeacher]                             # учитель или ученик ЛК

    def get(self, request):
        try:
            profile = request.user.profile                         # профиль текущего пользователя
        except Exception:
            return Response([], status=status.HTTP_200_OK)         # нет профиля — пустой список
        qs = (
            homework_assignment_select_qs()
            .filter(student=profile)                               # только ДЗ этого ученика
            .select_related('homework', 'homework__teacher')       # подтягиваем ДЗ и учителя
            .prefetch_related('answer_files', 'homework__attachments')  # ответы и вложения
        )
        return Response(
            HomeworkAssignmentDetailSerializer(qs, many=True, context={'request': request}).data,
        )


def _extract_generator_homework_jwt(request):
    """JWT из ?token=, Authorization: Bearer … или X-Lesson-Token (вызовы генератора без cookie ЛК)."""
    t = (request.GET.get('token') or '').strip()
    if t:
        return t
    auth = (request.META.get('HTTP_AUTHORIZATION') or '').strip()
    if auth.lower().startswith('bearer '):
        return auth[7:].strip()
    xt = (request.META.get('HTTP_X_LESSON_TOKEN') or '').strip()
    if xt:
        return xt
    return ''


def _homework_assignment_for_generator_jwt(token_raw, pk: int):
    """
    Чтение назначения ДЗ для сайта заданий: JWT кабинета (LESSON_SECRET, iss=cabinet),
    homework_assignment_id в payload совпадает с pk, режим homework.
    """
    if not token_raw or not str(token_raw).strip():
        return None
    try:
        payload = jwt.decode(
            str(token_raw).strip(),
            LESSON_SECRET,
            algorithms=['HS256'],
            options={'require': ['exp']},
        )
    except Exception:
        return None
    if payload.get('iss') != 'cabinet':
        return None
    aid = payload.get('homework_assignment_id')
    if aid is None:
        return None
    try:
        aid_int = int(aid)
    except (TypeError, ValueError):
        return None
    if aid_int != int(pk):
        return None
    sk = str(payload.get('session_kind') or '')
    lf = str(payload.get('lesson_format') or '')
    if sk != 'homework' and lf != 'homework':
        return None
    qs = (
        homework_assignment_select_qs()
        .select_related('homework', 'homework__teacher', 'student')
        .prefetch_related('answer_files', 'homework__attachments')
    )
    try:
        return qs.get(pk=pk)
    except HomeworkAssignment.DoesNotExist:
        return None


def homework_student_assignment_for_write(request, pk):
    """
    Назначение ДЗ для save-draft / submit:
    - сессия ЛК и роль student, назначение принадлежит этому ученику; или
    - валидный JWT комнаты ДЗ (тот же LESSON_SECRET, homework_assignment_id == pk).
    Учитель в сессии не блокирует второй путь — генератор шлёт JWT без cookie ученика.
    """
    int_pk = int(pk)
    if getattr(request.user, 'is_authenticated', False):
        try:
            profile = request.user.profile
        except Exception:
            profile = None
        else:
            if profile and profile.role == 'student':
                try:
                    return HomeworkAssignment.objects.select_related(
                        'homework__teacher', 'student',
                    ).get(pk=int_pk, student=profile)
                except HomeworkAssignment.DoesNotExist:
                    pass
    raw = _extract_generator_homework_jwt(request)
    return _homework_assignment_for_generator_jwt(raw, int_pk)


def _homework_post_is_session_student_owner(request, assignment):
    if not getattr(request.user, 'is_authenticated', False):
        return False
    try:
        p = request.user.profile
    except Exception:
        return False
    return p.role == 'student' and p.pk == assignment.student_id


def _assert_lesson_webhook_for_generator_backend(request):
    """Как POST /api/homework/assignment/fetch-by-token/ — серверный вызов с X-Lesson-Webhook-Secret."""
    webhook_secret = (getattr(settings, 'LESSON_WEBHOOK_SECRET', None) or '').strip()
    if webhook_secret:
        if (request.headers.get('X-Lesson-Webhook-Secret') or '').strip() != webhook_secret:
            return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
        return None
    if not settings.DEBUG:
        return Response(
            {'error': 'LESSON_WEBHOOK_SECRET is not configured'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return None


def homework_assignment_accessible(request, pk):
    """Назначение ДЗ, если текущий пользователь (ученик-владелец или учитель ДЗ) имеет к нему доступ."""
    try:
        profile = request.user.profile                             # профиль текущего пользователя
    except Exception:
        return None                                                # нет профиля — нет доступа
    qs = (
        homework_assignment_select_qs()
        .select_related('homework', 'homework__teacher', 'student')
        .prefetch_related('answer_files', 'homework__attachments')
    )
    try:
        obj = qs.get(pk=pk)                                        # ищем назначение по pk
    except HomeworkAssignment.DoesNotExist:
        return None                                                # назначение не найдено
    if profile.role == 'student' and obj.student_id != profile.pk:  # ученик пытается просмотреть чужое ДЗ
        return None
    if profile.role != 'student' and obj.homework.teacher_id != profile.pk:  # учитель проверяет чужое ДЗ
        return None
    return obj                                                     # доступ разрешён — возвращаем объект


class HomeworkAssignmentDetailView(APIView):
    """
    GET /api/homework/assignment/<id>/
    Детали назначения ДЗ:
    - сессия ЛК (ученик-владелец или учитель ДЗ), или
    - JWT в ?token= / Authorization: Bearer (LESSON_SECRET, iss=cabinet, homework_assignment_id=id,
      session_kind или lesson_format = homework) — для генератора без cookie.
    """
    permission_classes = [AllowAny]
    authentication_classes = [SessionAuthentication]

    def get(self, request, pk):
        obj = homework_assignment_accessible(request, pk)
        if not obj:
            raw = _extract_generator_homework_jwt(request)
            obj = _homework_assignment_for_generator_jwt(raw, pk)
        if not obj:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        return Response(HomeworkAssignmentDetailSerializer(obj, context={'request': request}).data)


@method_decorator(csrf_exempt, name='dispatch')
class HomeworkAssignmentFetchByTokenView(APIView):
    """
    POST /api/homework/assignment/fetch-by-token/
    Тело JSON или form: token, assignment_id — тот же JSON, что GET /api/homework/assignment/<id>/.
    Заголовок X-Lesson-Webhook-Secret обязателен (как у вебхуков урока), кроме DEBUG без секрета.
    """
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        err = _assert_lesson_webhook_for_generator_backend(request)
        if err:
            return err

        token = (request.data.get('token') or request.POST.get('token') or '').strip()
        raw_aid = request.data.get('assignment_id', request.POST.get('assignment_id'))
        try:
            pk = int(raw_aid)
        except (TypeError, ValueError):
            return Response({'error': 'assignment_id обязателен (число)'}, status=status.HTTP_400_BAD_REQUEST)

        obj = _homework_assignment_for_generator_jwt(token, pk)
        if not obj:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        return Response(HomeworkAssignmentDetailSerializer(obj, context={'request': request}).data)


@method_decorator(csrf_exempt, name='dispatch')
class HomeworkSaveDraftView(APIView):
    """
    POST /api/homework/assignment/<id>/save-draft/
    Ученик сохраняет черновик ответов (без смены статуса на «сдано»).
    Тело: { result?: {...}, score?: int }
    Доступ: сессия ЛК (ученик-владелец) или JWT в ?token= / Authorization: Bearer / X-Lesson-Token;
    без сессии ученика — заголовок X-Lesson-Webhook-Secret (как fetch-by-token).
    """
    permission_classes = [AllowAny]
    authentication_classes = [SessionAuthentication]

    def post(self, request, pk):
        assignment = homework_student_assignment_for_write(request, pk)
        if not assignment:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        if not _homework_post_is_session_student_owner(request, assignment):
            err = _assert_lesson_webhook_for_generator_backend(request)
            if err:
                return err

        if assignment.status not in ('sent', 'revision'):
            return Response(
                {'error': f'Черновик недоступен для статуса «{assignment.status}»'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = request.data.get('result')
        score = request.data.get('score')
        update_fields = []
        if isinstance(result, dict):
            assignment.result = _merge_homework_result_for_revision(assignment, result)
            update_fields.append('result')
        if score is not None:
            try:
                assignment.score = int(score)
                update_fields.append('score')
            except (TypeError, ValueError):
                pass
        if not update_fields:
            return Response({'error': 'Передайте result и/или score'}, status=status.HTTP_400_BAD_REQUEST)
        assignment.save(update_fields=update_fields)
        assignment.refresh_from_db()
        return Response(
            HomeworkAssignmentDetailSerializer(assignment, context={'request': request}).data,
        )


class HomeworkAssignmentJoinUrlView(APIView):
    """
    GET /api/homework/assignment/<id>/join-url/?role=teacher|student|auto
    Ссылка на комнату ДЗ на генераторе (cabinet_session=homework).
    Дополнительно exam_url — прямой URL страницы варианта с тем же token (меньше редиректов, чем /lesson/join/).
    """
    permission_classes = [IsLKTeacher]

    def get(self, request, pk):
        obj = homework_assignment_accessible(request, pk)
        if not obj:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Профиль не найден'}, status=status.HTTP_400_BAD_REQUEST)

        role = (request.GET.get('role') or 'auto').strip().lower()
        if role == 'auto':
            role = 'student' if profile.role == 'student' else 'teacher'
        if role not in ('teacher', 'student'):
            return Response({'error': 'role: teacher, student или auto'}, status=status.HTTP_400_BAD_REQUEST)
        if role == 'student' and obj.student_id != profile.pk:
            return Response({'error': 'Нет прав'}, status=status.HTTP_403_FORBIDDEN)
        if role == 'teacher' and obj.homework.teacher_id != profile.pk:
            return Response({'error': 'Нет прав'}, status=status.HTTP_403_FORBIDDEN)

        urls = _homework_room_join_urls(obj, request=request)
        exam = _homework_direct_exam_urls(obj)
        out = {
            'url': urls[role],
            'teacher_url': urls['teacher'],
            'student_url': urls['student'],
            'expires_in': HW_ROOM_TTL,
        }
        if exam:
            out['exam_url'] = exam[role]
            out['exam_teacher_url'] = exam['teacher']
            out['exam_student_url'] = exam['student']
        return Response(out)


class HomeworkAssignmentMetaPatchView(APIView):
    """
    PATCH /api/homework/assignment/<id>/meta/
    - whiteboard_strokes: полный список штрихов (ученик или учитель)
    - task_teacher_comments: частичное обновление { "номер задания": "текст" } (только учитель)
    """
    permission_classes = [IsLKTeacher]

    def patch(self, request, pk):
        if not _homework_assignment_meta_columns_ready():           # колонки 0016 не созданы в БД
            return Response(
                {'error': 'Обновите сервер: выполните миграции БД (0016_homeworkassignment_board_comments).'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        obj = homework_assignment_accessible(request, pk)           # проверяем права
        if not obj:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        profile          = request.user.profile
        is_student_owner = profile.role == 'student' and obj.student_id == profile.pk        # ученик — владелец ДЗ
        is_teacher_owner = profile.role != 'student' and obj.homework.teacher_id == profile.pk  # учитель — владелец ДЗ

        update_fields = []                                          # список полей для save(update_fields=…)

        if 'whiteboard_strokes' in request.data:
            if not (is_student_owner or is_teacher_owner):         # доска доступна и ученику и учителю
                return Response({'error': 'Нет прав'}, status=status.HTTP_403_FORBIDDEN)
            strokes = request.data.get('whiteboard_strokes')
            if not isinstance(strokes, list):
                return Response({'error': 'whiteboard_strokes должен быть массивом'}, status=status.HTTP_400_BAD_REQUEST)
            if len(strokes) > 800:
                strokes = strokes[-800:]                           # ограничиваем хранение до 800 последних штрихов
            obj.whiteboard_strokes = strokes
            update_fields.append('whiteboard_strokes')

        if 'task_teacher_comments' in request.data:
            if not is_teacher_owner:                               # комментарии к задачам — только учитель
                return Response({'error': 'Только учитель может сохранять комментарии к заданиям'}, status=status.HTTP_403_FORBIDDEN)
            tc = request.data.get('task_teacher_comments')
            if not isinstance(tc, dict):
                return Response({'error': 'task_teacher_comments должен быть объектом'}, status=status.HTTP_400_BAD_REQUEST)
            base = dict(obj.task_teacher_comments or {})           # текущие комментарии (merge, не overwrite)
            for k, v in tc.items():
                key = str(k).strip()
                if not key:
                    continue                                        # пропускаем пустые ключи
                base[key] = '' if v is None else str(v)           # None → пустая строка (удаление комментария)
            obj.task_teacher_comments = base
            update_fields.append('task_teacher_comments')

        if not update_fields:
            return Response(
                {'error': 'Укажите whiteboard_strokes и/или task_teacher_comments'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        obj.save(update_fields=update_fields)                      # сохраняем только изменённые поля
        return Response(
            HomeworkAssignmentDetailSerializer(obj, context={'request': request}).data,
        )


def _absolutize_variant_html(html: str, base_url: str) -> str:
    """Картинки/ссылки с путём /... в HTML варианта → абсолютные URL на домен генератора."""
    if not html or not isinstance(html, str):                      # пустой или не-строковый — без изменений
        return html
    base = base_url.rstrip('/')                                    # базовый URL без trailing slash

    def abs_path(path: str) -> str:                                # делает путь абсолютным
        if not path:
            return path
        p = path.strip()
        if p.startswith(('http://', 'https://', 'data:', 'blob:', 'mailto:')):  # уже абсолютный — не трогаем
            return path
        if p.startswith('//'):                                     # protocol-relative URL — не трогаем
            return path
        if p.startswith('/'):                                      # корневой путь → добавляем домен
            return f'{base}{p}'
        return f'{base}/{p.lstrip("/")}'                           # относительный → делаем абсолютным

    def repl_attr(m):                                              # заменяем атрибут src/href
        attr, quote, path = m.group(1), m.group(2), m.group(3)
        return f'{attr}={quote}{abs_path(path)}{quote}'

    out = re.sub(r"(?is)(src|href)\s*=\s*([\"'])(/[^\s\"'>]+)\2", repl_attr, html)  # заменяем src= и href=
    out = re.sub(                                                  # заменяем url() в inline-стилях
        r'(?is)url\s*\(\s*(["\']?)(/[^)\'"]+)\1\s*\)',
        lambda m: f'url({m.group(1)}{abs_path(m.group(2))}{m.group(1)})',
        out,
    )
    return out


def _rewrite_variant_media_urls(data, base_url: str):
    """Рекурсивно правит HTML в полях заданий (картинки с /media/… на другом хосте)."""
    html_keys = {                                                  # поля которые могут содержать HTML с путями
        'text', 'task_template', 'hint', 'solution', 'description',
        'condition', 'body', 'content', 'html',
    }
    base = base_url.rstrip('/')                                    # базовый URL без trailing slash
    if isinstance(data, dict):                                     # рекурсия по словарю
        for k, v in list(data.items()):
            if k in html_keys and isinstance(v, str):             # HTML-поле — абсолютизируем
                data[k] = _absolutize_variant_html(v, base_url)
            elif k == 'file' and isinstance(v, str) and v.startswith('/') and not v.startswith('//'):  # путь к файлу
                data[k] = f'{base}{v}'                            # делаем абсолютным
            else:
                _rewrite_variant_media_urls(v, base_url)          # рекурсивно обрабатываем вложенные данные
    elif isinstance(data, list):                                   # рекурсия по списку
        for item in data:
            _rewrite_variant_media_urls(item, base_url)


class HomeworkVariantProxyView(APIView):
    """
    GET /api/homework/variant/<variant_id>/
    Проксирует JSON варианта из Генератора, чтобы фронтенд ЛК не делал кросс-доменный запрос.
    Доступно и учителям, и ученикам (любой авторизованный пользователь ЛК).
    """
    permission_classes = [IsAuthenticated]                         # любой авторизованный пользователь

    def get(self, request, variant_id):
        genurok_url = GENUROK_URL.rstrip('/')                      # URL генератора без trailing slash
        url = _build_generator_url(f'api/lesson/variant/{variant_id}/')  # URL варианта в API генератора
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json'})  # формируем GET-запрос
            with urllib.request.urlopen(req, timeout=10) as resp:  # выполняем запрос с таймаутом 10 секунд
                data = json.loads(resp.read().decode('utf-8'))      # парсим JSON-ответ
            if isinstance(data, dict):
                _rewrite_variant_media_urls(data, genurok_url)     # абсолютизируем пути к медиафайлам
            return Response(data)                                   # возвращаем данные варианта клиенту
        except urllib.error.HTTPError as e:
            return Response({'error': f'Генератор вернул {e.code}'}, status=e.code)  # HTTP-ошибка генератора
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)  # сетевая или иная ошибка


@method_decorator(csrf_exempt, name='dispatch')
class HomeworkSubmitView(APIView):
    """
    POST /api/homework/assignment/<id>/submit/
    Ученик сдаёт ДЗ. Тело: { result: {...}, score: N }
    Доступ: сессия ученика или JWT + X-Lesson-Webhook-Secret без cookie ученика (генератор).
    """
    permission_classes = [AllowAny]
    authentication_classes = [SessionAuthentication]

    def post(self, request, pk):
        assignment = homework_student_assignment_for_write(request, pk)
        if not assignment:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        if not _homework_post_is_session_student_owner(request, assignment):
            err = _assert_lesson_webhook_for_generator_backend(request)
            if err:
                return err

        if assignment.status not in ('sent', 'revision'):          # можно сдать только если статус sent или revision
            return Response({'error': f'Нельзя сдать ДЗ со статусом "{assignment.status}"'}, status=status.HTTP_400_BAD_REQUEST)

        result = request.data.get('result')                        # JSON-результат выполнения варианта
        score  = request.data.get('score')                         # балл (опционально, может считаться автоматически)

        update_fields = ['status', 'submitted_at']                 # обязательные поля для обновления
        assignment.status       = 'submitted'                      # меняем статус на "сдано"
        assignment.submitted_at = timezone.now()                   # фиксируем время сдачи
        if isinstance(result, dict):                               # сохраняем результат если это словарь
            assignment.result = _merge_homework_result_for_revision(assignment, result)
            update_fields.append('result')
        assignment.revision_task_ids = []
        update_fields.append('revision_task_ids')
        if score is not None:
            try:
                assignment.score = int(score)                      # сохраняем балл как целое число
                update_fields.append('score')
            except (TypeError, ValueError):
                pass                                               # некорректный балл — игнорируем
        assignment.save(update_fields=update_fields)               # сохраняем только изменённые поля

        title        = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        student_name = f'{assignment.student.name} {assignment.student.surname}'.strip()
        if getattr(request.user, 'is_authenticated', False):
            try:
                p = request.user.profile
                if p.role == 'student' and p.pk == assignment.student_id:
                    student_name = f'{p.name} {p.surname}'.strip() or student_name
            except Exception:
                pass
        score_str    = f' — {assignment.score} б' if assignment.score is not None else ''
        _notify(                                                   # уведомляем учителя о сдаче
            assignment.homework.teacher,
            f'{student_name} сдал(а) ДЗ: {title}{score_str}',
            'submitted',
            assignment=assignment,
        )
        return Response(HomeworkAssignmentSerializer(assignment, context={'request': request}).data)


@method_decorator(csrf_exempt, name='dispatch')
class HomeworkUploadAnswerView(APIView):
    """
    POST /api/homework/assignment/<id>/upload-answer/
    Ученик загружает файл ответа.
    Доступ: сессия ученика или JWT + X-Lesson-Webhook-Secret (генератор), как save-draft/submit.
    """
    permission_classes = [AllowAny]
    authentication_classes = [SessionAuthentication]

    def post(self, request, pk):
        assignment = homework_student_assignment_for_write(request, pk)
        if not assignment:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        if not _homework_post_is_session_student_owner(request, assignment):
            err = _assert_lesson_webhook_for_generator_backend(request)
            if err:
                return err

        f = request.FILES.get('file')                              # файл из multipart-запроса
        if not f:
            return Response({'error': 'file обязателен'}, status=status.HTTP_400_BAD_REQUEST)

        task_number = request.POST.get('task_number') or request.data.get('task_number')  # номер задания (опционально)
        tn = None
        if task_number is not None and str(task_number).strip() != '':
            try:
                tn = int(task_number)                              # конвертируем номер задания в int
            except (TypeError, ValueError):
                return Response({'error': 'task_number должен быть числом'}, status=status.HTTP_400_BAD_REQUEST)

        filename  = f.name
        file_type = _detect_file_type(filename)                    # тип файла по расширению
        answer    = HomeworkAnswerFile.objects.create(             # создаём файл ответа
            assignment=assignment,
            file=f,
            filename=filename,
            file_type=file_type,
            task_number=tn,                                        # привязываем к конкретному заданию если указан
        )
        try:
            title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
            sn    = f'{assignment.student.name} {assignment.student.surname}'.strip()
            if getattr(request.user, 'is_authenticated', False):
                try:
                    p = request.user.profile
                    if p.role == 'student' and p.pk == assignment.student_id:
                        sn = f'{p.name} {p.surname}'.strip() or sn
                except Exception:
                    pass
            extra = f' (задание {tn})' if tn is not None else ''
            _notify(                                               # уведомляем учителя о загрузке файла
                assignment.homework.teacher,
                f'{sn} добавил(а) вложение{extra} к «{title}»: {filename}',
                'submitted',
                assignment=assignment,
            )
        except Exception:
            pass                                                   # ошибка уведомления не критична
        return Response(
            HomeworkAnswerFileSerializer(answer, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class HomeworkReviewView(APIView):
    """
    POST /api/homework/assignment/<id>/review/
    Учитель проверяет ДЗ или отправляет на доработку.
    Тело: {
      action: 'reviewed'|'revision',
      comment: '...',
      part2_scores: { "19": {"score": 3, "criterion_id": 42}, ... },  # только для reviewed
      score: 12  # итог (часть 1 + 2), опционально
      revision_task_numbers: [3, 7]  # только для revision: номера заданий на доработку; [] — вся работа
    }
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        teacher = request.user.profile                             # профиль учителя
        try:
            assignment = HomeworkAssignment.objects.select_related(
                'homework', 'student',
            ).get(pk=pk, homework__teacher=teacher)                # назначение принадлежит ДЗ этого учителя
        except HomeworkAssignment.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        if assignment.status not in ('submitted', 'reviewing'):
            return Response(
                {'error': f'Проверка недоступна для статуса «{assignment.status}»'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        action  = request.data.get('action', 'reviewed')          # действие: принято или на доработку
        comment = request.data.get('comment', '')                  # комментарий учителя

        if action not in ('reviewed', 'revision'):                 # допустимые действия
            return Response({'error': 'action: reviewed или revision'}, status=status.HTTP_400_BAD_REQUEST)

        assignment.status          = action                        # reviewed | revision
        assignment.teacher_comment = str(comment) if comment is not None else ''  # сохраняем комментарий
        update_fields = ['status', 'teacher_comment']
        if action == 'reviewed':
            assignment.reviewed_at = timezone.now()                # время принятия проверки
            update_fields.append('reviewed_at')
        else:
            assignment.reviewed_at = None                          # на доработке — не «проверено»
            update_fields.append('reviewed_at')

        if action == 'revision':
            rev_in = request.data.get('revision_task_numbers')
            assignment.revision_task_ids = _normalize_revision_task_ids(rev_in)
            update_fields.append('revision_task_ids')

        if action == 'reviewed':
            assignment.revision_task_ids = []
            update_fields.append('revision_task_ids')
            part2_scores = request.data.get('part2_scores')
            if isinstance(part2_scores, dict) and part2_scores:
                base_result = dict(assignment.result or {})
                for tk, tv in part2_scores.items():
                    kn = str(tk).strip()
                    if not kn:
                        continue
                    prev = base_result.get(kn)
                    cell = dict(prev) if isinstance(prev, dict) else {}
                    if isinstance(tv, dict):
                        sc = tv.get('score')
                        if sc is not None:
                            try:
                                cell['teacher_score'] = int(sc)
                            except (TypeError, ValueError):
                                pass
                        cid = tv.get('criterion_id')
                        if cid is not None:
                            try:
                                cell['teacher_criterion_id'] = int(cid)
                            except (TypeError, ValueError):
                                pass
                    else:
                        try:
                            cell['teacher_score'] = int(tv)
                        except (TypeError, ValueError):
                            pass
                    base_result[kn] = cell
                assignment.result = base_result
                update_fields.append('result')
            score_param = request.data.get('score')
            if score_param is not None:
                try:
                    assignment.score = int(score_param)
                    update_fields.append('score')
                except (TypeError, ValueError):
                    pass

        assignment.save(update_fields=update_fields)

        title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        snip  = (assignment.teacher_comment or '').strip().replace('\n', ' ')  # убираем переносы для уведомления
        if len(snip) > 100:
            snip = snip[:100] + '…'                               # обрезаем длинный комментарий

        if action == 'reviewed':
            msg = f'ДЗ проверено: {title}'
            if snip:
                msg = f'{msg}. {snip}'
            _notify(assignment.student, msg, 'reviewed', assignment=assignment)  # уведомляем ученика: принято
        else:
            msg = f'ДЗ направлено на доработку: {title}'
            if snip:
                msg = f'{msg}. {snip}'
            _notify(assignment.student, msg, 'revision_requested', assignment=assignment)  # уведомляем: на доработку

        # refresh_from_db обновляет скалярные поля; select_related-объекты были загружены выше и остаются в кэше
        assignment.refresh_from_db()
        return Response(HomeworkAssignmentDetailSerializer(assignment, context={'request': request}).data)


class HomeworkTeacherCommentView(APIView):
    """
    POST /api/homework/assignment/<id>/teacher-comment/
    Сохранить комментарий учителя и уведомить ученика (без смены статуса «принято / доработка»).
    Тело: { comment: '...' }
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        teacher = request.user.profile
        try:
            assignment = HomeworkAssignment.objects.select_related(
                'homework', 'student',
            ).get(pk=pk, homework__teacher=teacher)
        except HomeworkAssignment.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        if assignment.status not in ('submitted', 'reviewing', 'reviewed', 'revision'):  # только для сданных работ
            return Response(
                {'error': 'Комментарий недоступен для этого статуса задания'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        comment = request.data.get('comment', '')
        if comment is None:
            comment = ''                                           # None → пустая строка (удаление комментария)
        assignment.teacher_comment = str(comment)
        assignment.save(update_fields=['teacher_comment'])         # сохраняем только комментарий

        title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        snip  = assignment.teacher_comment.strip().replace('\n', ' ')
        if len(snip) > 120:
            snip = snip[:120] + '…'
        msg = f'Комментарий к ДЗ «{title}»'
        if snip:
            msg = f'{msg}: {snip}'
        _notify(assignment.student, msg, 'teacher_comment', assignment=assignment)  # уведомляем ученика

        # refresh_from_db обновляет скалярные поля; select_related-объекты были загружены выше и остаются в кэше
        assignment.refresh_from_db()
        return Response(HomeworkAssignmentDetailSerializer(assignment, context={'request': request}).data)


class HomeworkUploadTeacherFeedbackView(APIView):
    """
    POST /api/homework/assignment/<id>/upload-teacher-feedback/
    Учитель прикрепляет файл к проверке (multipart: file, опционально source_answer_file_id).
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        teacher = request.user.profile
        try:
            assignment = HomeworkAssignment.objects.get(pk=pk, homework__teacher=teacher)
        except HomeworkAssignment.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        if assignment.status not in ('submitted', 'reviewing', 'reviewed', 'revision'):  # только для сданных работ
            return Response({'error': 'Вложения недоступны для этого статуса'}, status=status.HTTP_400_BAD_REQUEST)

        f = request.FILES.get('file')                              # файл обратной связи от учителя
        if not f:
            return Response({'error': 'file обязателен'}, status=status.HTTP_400_BAD_REQUEST)

        src     = None
        raw_src = request.POST.get('source_answer_file_id') or request.data.get('source_answer_file_id')  # ID файла ответа ученика
        if raw_src not in (None, ''):                              # привязка к конкретному файлу ответа
            try:
                sid = int(raw_src)
                src = HomeworkAnswerFile.objects.get(pk=sid, assignment=assignment)  # файл принадлежит этому назначению
            except (ValueError, TypeError, HomeworkAnswerFile.DoesNotExist):
                return Response({'error': 'Неверный source_answer_file_id'}, status=status.HTTP_400_BAD_REQUEST)

        filename  = f.name
        file_type = _detect_file_type(filename)
        row = HomeworkTeacherFeedbackFile.objects.create(          # создаём файл обратной связи
            assignment=assignment,
            file=f,
            filename=filename,
            file_type=file_type,
            source_answer_file=src,                                # ссылка на файл ответа (или None)
        )
        return Response(
            HomeworkTeacherFeedbackFileSerializer(row, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class HomeworkAnnotateView(APIView):
    """
    PATCH /api/homework/answer/<file_id>/annotate/
    Сохранить аннотации (canvas-штрихи) на файле-ответе.
    Тело: { annotations: [...] }
    """
    permission_classes = [IsCabinetTeacher]

    def patch(self, request, file_id):
        teacher = request.user.profile
        try:
            answer = HomeworkAnswerFile.objects.select_related(
                'assignment__homework__teacher',
            ).get(pk=file_id, assignment__homework__teacher=teacher)  # файл принадлежит ДЗ этого учителя
        except HomeworkAnswerFile.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        annotations = request.data.get('annotations')              # массив штрихов canvas
        if not isinstance(annotations, list):
            return Response({'error': 'annotations должен быть массивом'}, status=status.HTTP_400_BAD_REQUEST)
        answer.annotations = annotations                           # сохраняем аннотации
        answer.save(update_fields=['annotations'])
        return Response(HomeworkAnswerFileSerializer(answer, context={'request': request}).data)


class NotificationListView(APIView):
    """
    GET /api/notifications/
    Уведомления текущего пользователя (последние 50).
    """
    permission_classes = [IsLKTeacher]

    def get(self, request):
        try:
            profile = request.user.profile
        except Exception:
            return Response([])                                    # нет профиля — пустой список
        qs = (
            Notification.objects
            .filter(user=profile)                                  # уведомления текущего пользователя
            .select_related('homework_assignment')                 # подтягиваем назначение ДЗ если есть
            .order_by('-created_at')[:50]                         # последние 50 по убыванию даты
        )
        return Response(NotificationSerializer(qs, many=True).data)


class NotificationReadView(APIView):
    """
    POST /api/notifications/<id>/read/
    Отметить уведомление прочитанным.
    """
    permission_classes = [IsLKTeacher]

    def post(self, request, pk):
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Профиль не найден'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            notif = Notification.objects.get(pk=pk, user=profile) # уведомление принадлежит текущему пользователю
        except Notification.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        notif.read = True
        notif.save(update_fields=['read'])                         # сохраняем только флаг прочтения
        return Response({'ok': True})


class NotificationReadAllView(APIView):
    """
    POST /api/notifications/read-all/
    Отметить все уведомления прочитанными.
    """
    permission_classes = [IsLKTeacher]

    def post(self, request):
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Профиль не найден'}, status=status.HTTP_400_BAD_REQUEST)
        Notification.objects.filter(user=profile, read=False).update(read=True)  # массовое обновление непрочитанных
        return Response({'ok': True})


class HomeworkCancelAssignmentView(APIView):
    """
    POST /api/homework/assignment/<id>/cancel/
    Учитель отменяет назначение ДЗ ученику.
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        teacher = request.user.profile
        try:
            assignment = HomeworkAssignment.objects.select_related(
                'homework', 'student',
            ).get(pk=pk, homework__teacher=teacher)                # назначение принадлежит ДЗ этого учителя
        except HomeworkAssignment.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        assignment.status = 'cancelled'                            # отменяем назначение
        assignment.save(update_fields=['status'])

        title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        _notify(                                                   # уведомляем ученика об отмене
            assignment.student,
            f'ДЗ отменено учителем: {title}',
            'homework_assigned',
            assignment=assignment,
        )
        return Response(HomeworkAssignmentSerializer(assignment, context={'request': request}).data)


class HomeworkCancelAllView(APIView):
    """
    POST /api/homework/<id>/cancel-all/
    Учитель отменяет ДЗ для всех учеников сразу.
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        teacher = request.user.profile
        try:
            homework = Homework.objects.get(pk=pk, teacher=teacher)  # ДЗ принадлежит учителю
        except Homework.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        assignments = HomeworkAssignment.objects.filter(
            homework=homework,
        ).exclude(status='cancelled').select_related('student')    # все активные назначения этого ДЗ

        # Материализуем список до обновления — нужен для уведомлений
        assignments_list = list(assignments)
        cancelled_count  = len(assignments_list)                   # считаем до UPDATE (не делаем лишний COUNT)

        # Один UPDATE-запрос вместо N save() в цикле
        HomeworkAssignment.objects.filter(
            homework=homework,
        ).exclude(status='cancelled').update(status='cancelled')

        title = homework.title or f'Вариант {homework.variant_id}'
        for assignment in assignments_list:                        # уведомления отправляем по уже загруженным объектам
            _notify(
                assignment.student,
                f'ДЗ отменено учителем: {title}',
                'homework_assigned',
                assignment=assignment,
            )

        return Response({'cancelled': cancelled_count})            # количество отменённых назначений


class HomeworkTeacherAssignmentsView(APIView):
    """
    GET /api/homework/<id>/assignments/
    Учитель: список всех назначений для конкретного ДЗ.
    """
    permission_classes = [IsCabinetTeacher]

    def get(self, request, pk):
        teacher = request.user.profile
        try:
            hw = Homework.objects.get(pk=pk, teacher=teacher)     # ДЗ принадлежит учителю
        except Homework.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        qs = (
            homework_assignment_select_qs()
            .filter(homework=hw)                                   # все назначения этого ДЗ
            .select_related('student', 'homework')                 # подтягиваем ученика и ДЗ
            .prefetch_related('answer_files')                      # и файлы ответов
        )
        return Response(
            HomeworkAssignmentDetailSerializer(qs, many=True, context={'request': request}).data,
        )


from rest_framework.decorators import api_view, permission_classes as drf_permission_classes


@api_view(['POST'])
@drf_permission_classes([IsCabinetTeacher])
def save_teacher_variant(request):
    """
    POST /api/variants/save/
    Body: { level, subject, task_ids: number[], title? }
    Создаёт вариант в генераторе и сохраняет связку variant_id↔учитель в БД кабинета.
    """
    level = str(request.data.get('level') or '').strip()
    subject = str(request.data.get('subject') or '').strip()
    task_ids = request.data.get('task_ids') or []
    title = str(request.data.get('title') or '').strip()

    if not level or not subject:
        return Response({'error': 'level и subject обязательны'}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(task_ids, list) or not task_ids:
        return Response({'error': 'task_ids должен быть непустым массивом'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        task_ids_int = [int(x) for x in task_ids]
    except (TypeError, ValueError):
        return Response({'error': 'task_ids должен содержать только числа'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        teacher = request.user.profile
    except Exception:
        teacher, _ = UserProfile.objects.get_or_create(
            user=request.user,
            defaults={
                'username': request.user.username,
                'name': request.user.first_name or request.user.username,
                'surname': request.user.last_name or '',
                'email': request.user.email or '',
                'role': 'teacher',
            },
        )

    create_url = _build_generator_url(f'api/{level}/{subject}/variant-from-ids/')
    try:
        gen_resp = requests.post(
            create_url,
            json={'task_ids': task_ids_int},
            timeout=20,
            verify=False,
        )
        gen_data = gen_resp.json() if gen_resp.content else {}
    except Exception as e:
        return Response({'error': f'Генератор недоступен: {e}'}, status=status.HTTP_502_BAD_GATEWAY)

    if gen_resp.status_code >= 400 or not gen_data.get('variant_id'):
        return Response(
            {'error': gen_data.get('error') or f'Ошибка генератора ({gen_resp.status_code})'},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    saved = TeacherVariant.objects.create(
        teacher=teacher,
        variant_id=int(gen_data['variant_id']),
        level=level,
        subject=subject,
        title=title,
        task_ids=task_ids_int,
    )
    return Response(TeacherVariantSerializer(saved).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def teacher_variants(request):
    """GET /api/variants/ — список сохранённых вариантов текущего учителя."""
    try:
        teacher = request.user.profile
    except Exception:
        teacher = None
    qs = TeacherVariant.objects.none() if teacher is None else TeacherVariant.objects.filter(teacher=teacher).order_by('-created_at')
    return Response(TeacherVariantSerializer(qs, many=True).data)


def _gen_proxy(path, params=None, timeout=15, require_secret=True):
    """Вспомогательная функция: делает GET к генератору и возвращает JSON."""
    url = _build_generator_url(path)
    headers = {}
    if require_secret and TASKS_GET_SECRET:
        headers['X-Tasks-Get-Secret'] = TASKS_GET_SECRET
    resp = requests.get(
        url,
        params=params or {},
        headers=headers,
        verify=False,
        timeout=timeout,
        allow_redirects=True,
    )
    # Если ответ не JSON — вернём понятную ошибку с телом ответа для отладки
    ct = resp.headers.get('Content-Type', '')
    if resp.status_code >= 400:
        raise requests.exceptions.HTTPError(
            f'HTTP {resp.status_code} from {url}: {resp.text[:300]}',
            response=resp,
        )
    if 'json' not in ct:
        raise requests.exceptions.RequestException(
            f'Unexpected Content-Type "{ct}" from {url}. Body: {resp.text[:300]}'
        )
    return resp.json()


def _build_generator_url(path):
    """
    Собирает корректный URL к API генератора без дублирования /api/api.
    Работает с базой как https://host, так и https://host/api.
    """
    base = GENUROK_URL.rstrip('/')
    normalized_path = str(path or '').lstrip('/')
    if not normalized_path:
        return base
    if base.endswith('/api'):
        if normalized_path.startswith('api/'):
            normalized_path = normalized_path[4:]
    elif not normalized_path.startswith('api/'):
        normalized_path = f'api/{normalized_path}'
    return f'{base}/{normalized_path}'


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def get_all_tasks(request):
    """GET /api/get-all-tasks/?subject=&level=&task_number=&subtopic= — прокси к API генератора."""
    subject  = request.GET.get('subject', '')
    level    = request.GET.get('level', '')
    task     = request.GET.get('task_number', '')
    subtopic = request.GET.get('subtopic', '')
    task_url = _build_generator_url('api/tasks/')
    try:
        resp = requests.get(
            task_url,
            params={'subject': subject, 'level': level, 'task': task, 'subtopic': subtopic},
            headers={'X-Tasks-Get-Secret': TASKS_GET_SECRET},
            verify=False,
            timeout=15,
        )
        resp.raise_for_status()
        return Response(resp.json())
    except requests.exceptions.RequestException as e:
        return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def gen_criteria(request):
    """GET /api/gen/criteria/?level=ege&subject=math&task_list_id=…&task_number=… — критерии части 2 с генератора."""
    level = request.GET.get('level', '')
    subject = request.GET.get('subject', '')
    task_list_id = request.GET.get('task_list_id', '')
    task_number = request.GET.get('task_number', '')
    params = {}
    if task_list_id:
        params['task_list_id'] = task_list_id
    if task_number:
        params['task_number'] = task_number
    last_err = None
    for require_secret in (False, True):
        try:
            data = _gen_proxy(
                f'api/{level}/{subject}/criteria/',
                params=params if params else None,
                require_secret=require_secret,
            )
            return Response(data)
        except requests.exceptions.RequestException as e:
            last_err = e
    return Response({'error': str(last_err)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@drf_permission_classes([IsAuthenticated])
def gen_variant_lookup(request, variant_id):
    """GET /api/gen/variant-lookup/<id>/ — slug уровня и предмета для URL страницы варианта на генераторе."""
    try:
        vid = int(variant_id)
    except (TypeError, ValueError):
        return Response({'error': 'Некорректный variant_id'}, status=status.HTTP_400_BAD_REQUEST)
    last_err = None
    for require_secret in (False, True):
        try:
            data = _gen_proxy(f'api/variant-lookup/{vid}/', require_secret=require_secret)
            return Response(data)
        except requests.exceptions.RequestException as e:
            last_err = e
    return Response({'error': str(last_err)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def gen_catalog(request):
    """GET /api/gen/catalog/ — список уровней/предметов из генератора."""
    # Пробуем сначала без секрета (каталог обычно публичный), потом с секретом
    last_err = None
    for require_secret in (False, True):
        try:
            data = _gen_proxy('api/catalog/', require_secret=require_secret)
            return Response(data)
        except requests.exceptions.RequestException as e:
            last_err = e
    return Response({'error': str(last_err)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def gen_tasks(request):
    """GET /api/gen/tasks/?level=oge&subject=math — список типов задач для уровня/предмета."""
    level   = request.GET.get('level', '')
    subject = request.GET.get('subject', '')
    try:
        data = _gen_proxy(f'api/{level}/{subject}/tasks/')
        return Response(data)
    except requests.exceptions.RequestException as e:
        return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def gen_subtopics(request):
    """GET /api/gen/subtopics/?level=oge&subject=math — список подтем для уровня/предмета."""
    level   = request.GET.get('level', '')
    subject = request.GET.get('subject', '')
    try:
        data = _gen_proxy(f'api/{level}/{subject}/subtopics/')
        return Response(data)
    except requests.exceptions.RequestException as e:
        return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def gen_task_bank(request):
    """GET /api/gen/task-bank/?level=oge&subject=math&task_list_id=5&page=1&per_page=100&subtopic_id=12"""
    level        = request.GET.get('level', '')
    subject      = request.GET.get('subject', '')
    task_list_id = request.GET.get('task_list_id', '')
    page         = request.GET.get('page', '1')
    per_page     = request.GET.get('per_page', '100')
    subtopic_id  = request.GET.get('subtopic_id', '')
    params = {'task_list_id': task_list_id, 'page': page, 'per_page': per_page}
    if subtopic_id:
        params['subtopic_id'] = subtopic_id
    try:
        data = _gen_proxy(f'api/{level}/{subject}/task-bank/', params=params)
        return Response(data)
    except requests.exceptions.RequestException as e:
        return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET'])
@drf_permission_classes([IsCabinetTeacher])
def gen_group_instances(request):
    """GET /api/gen/group-instances/?level=ege&subject=inf&group_id=12|linked_key=19_20_21&subtopic_id=5&page=1&per_page=20"""
    level       = request.GET.get('level', '')
    subject     = request.GET.get('subject', '')
    group_id    = request.GET.get('group_id', '')
    linked_key  = request.GET.get('linked_key', '')
    subtopic_id = request.GET.get('subtopic_id', '')
    page        = request.GET.get('page', '1')
    per_page    = request.GET.get('per_page', '20')
    params = {'page': page, 'per_page': per_page}
    if group_id:
        params['group_id'] = group_id
    if linked_key:
        params['linked_key'] = linked_key
    if subtopic_id:
        params['subtopic_id'] = subtopic_id
    try:
        data = _gen_proxy(f'api/{level}/{subject}/group-instances/', params=params)
        return Response(data)
    except requests.exceptions.RequestException as e:
        return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)
