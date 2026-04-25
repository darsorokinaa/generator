from django.shortcuts import render, redirect          # render — рендер шаблона, redirect — перенаправление
from django.http import JsonResponse, FileResponse                    # JSON для VK ID обмена токена → сессия
from django.views.decorators.http import require_POST  # только POST для /api/auth/vkid/
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
from django.utils.text import slugify
from django.db import transaction                      # атомарные операции при удалении группы
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
import os                                              # работа с файловой системой и переменными окружения
import random                                          # генерация случайных чисел и выборок
import string                                          # наборы символов (ascii_letters, digits)
import time                                            # time.time() — текущий Unix-timestamp
import re                                              # регулярные выражения
import json       
import hashlib
import uuid
import logging
import requests                                    # HTTP-клиент для проксирования запросов к генератору
import urllib.request                                  # HTTP-запросы без сторонних библиотек
import urllib.error                                    # HTTPError при проксировании запросов
import urllib.parse
import jwt                                             # PyJWT — создание и верификация JWT-токенов
from io import BytesIO
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
    StudentLessonReport,                               # PDF-отчёты по ученикам
    TeacherVariant,                                    # сохранённый вариант учителя
    UserPlatformConsent,                               # согласия пользователя с платформой
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

logger = logging.getLogger(__name__)






FRONTEND_URL = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')   # URL React SPA (из settings или дефолт)
GENUROK_URL  = getattr(settings, 'GENUROK_URL',  'https://test.genurok.ru')  # URL сервиса генератора заданий
LESSON_SECRET = getattr(settings, 'LESSON_SECRET', settings.SECRET_KEY)     # секрет для подписи JWT урока
LESSON_TTL    = 60 * 60 * 2  # время жизни токена урока — 2 часа в секундах
STUDENT_INVITE_TTL = 60 * 60 * 24 * 7  # срок жизни ссылки-приглашения ученика — 7 дней
HW_ROOM_TTL   = int(getattr(settings, 'HOMEWORK_ROOM_TTL', 60 * 60 * 24 * 30))  # JWT «комнаты» ДЗ для генератора
CONSENT_CODE_PLATFORM_USAGE = 'platform_usage'
CONSENT_CODE_USER_AGREEMENT = 'user_agreement'
CONSENT_CODE_PERSONAL_DATA = 'personal_data'
CONSENT_CODE_STUDENT_DATA_BASIS = 'student_data_basis'
CONSENT_CODE_MARKETING = 'marketing'
LEGAL_DOCUMENT_VERSION = getattr(settings, 'LEGAL_DOCUMENT_VERSION', '2026-04-25')
LEGAL_USER_AGREEMENT_URL = getattr(settings, 'LEGAL_USER_AGREEMENT_URL', '/legal/user-agreement/')
LEGAL_PRIVACY_POLICY_URL = getattr(settings, 'LEGAL_PRIVACY_POLICY_URL', '/legal/privacy-policy/')
CONSENT_LABELS = {
    CONSENT_CODE_USER_AGREEMENT: 'Я принимаю условия Пользовательского соглашения',
    CONSENT_CODE_PERSONAL_DATA: 'Я даю согласие на обработку персональных данных в соответствии с Политикой конфиденциальности',
    CONSENT_CODE_STUDENT_DATA_BASIS: 'Я подтверждаю, что при добавлении учеников имею законные основания и согласие на обработку их персональных данных',
    CONSENT_CODE_MARKETING: 'Я согласен получать уведомления и информационные рассылки',
}
ALLOWED_PLATFORM_CONSENT_CODES = {
    CONSENT_CODE_PLATFORM_USAGE,
    CONSENT_CODE_USER_AGREEMENT,
    CONSENT_CODE_PERSONAL_DATA,
    CONSENT_CODE_STUDENT_DATA_BASIS,
    CONSENT_CODE_MARKETING,
}

AVATAR_EMOJI_POOL = {
    # Еда
    '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🥝', '🍍', '🥑',
    # Животные
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧', '🦉',
    # Растения
    '🌵', '🌿', '🍀', '🌱', '🌷', '🌸', '🌺', '🌻', '🌼', '🌴', '🍁', '🍃',
}
AVATAR_BG_POOL = {'violet', 'ocean', 'mint', 'sunset', 'peach', 'forest'}
_PDF_FONT_READY = False


def _ensure_pdf_font():
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError:
        return

    global _PDF_FONT_READY
    if _PDF_FONT_READY:
        return
    font_candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/local/share/fonts/DejaVuSans.ttf',
        '/Library/Fonts/Arial Unicode.ttf',
        '/Library/Fonts/Arial.ttf',
    ]
    for fp in font_candidates:
        try:
            if os.path.exists(fp):
                pdfmetrics.registerFont(TTFont('LKReport', fp))
                _PDF_FONT_READY = True
                return
        except Exception:
            continue
    _PDF_FONT_READY = True


def _lesson_result_rows_from_assignment(assignment):
    rows = []
    result = assignment.result if isinstance(assignment.result, dict) else {}
    homework = getattr(assignment, 'homework', None)
    task_max_map = {}
    if homework and getattr(homework, 'variant_data', None):
        try:
            tasks = list((homework.variant_data or {}).get('tasks') or [])
            for t in tasks:
                num = str(t.get('number') if isinstance(t, dict) else '').strip()
                if not num:
                    continue
                raw_max = (t.get('max_score') if isinstance(t, dict) else None)
                try:
                    task_max_map[num] = int(raw_max) if raw_max is not None else None
                except Exception:
                    task_max_map[num] = None
        except Exception:
            task_max_map = {}
    for k, v in result.items():
        num = str(k).strip()
        if not num:
            continue
        cell = v if isinstance(v, dict) else {}
        ans = str(cell.get('answer') or '').strip()
        st = str(cell.get('state') or '').strip().lower()
        t_score = cell.get('teacher_score')
        t_max = cell.get('teacher_max_score')
        max_guess = task_max_map.get(num)
        try:
            t_score_num = int(t_score) if t_score is not None else None
        except Exception:
            t_score_num = None
        try:
            t_max_num = int(t_max) if t_max is not None else (int(max_guess) if max_guess is not None else None)
        except Exception:
            t_max_num = None
        if st == 'correct':
            status_label = 'Правильно'
        elif st == 'wrong':
            status_label = 'Неправильно'
        elif st == 'partial':
            status_label = 'Частично верно'
        elif t_score_num is not None:
            if t_max_num is not None and t_max_num > 0 and t_score_num >= t_max_num:
                status_label = 'Правильно'
            elif t_score_num <= 0:
                status_label = 'Неправильно'
            else:
                status_label = 'Частично верно'
        elif st == 'empty':
            status_label = 'Пусто'
        elif st:
            status_label = 'Без автопроверки'
        else:
            status_label = 'Пусто'
        display_answer = ans or '—'
        if t_score_num is not None:
            if t_max_num is not None:
                display_answer = f'Оценка: {t_score_num} из {t_max_num}'
            else:
                display_answer = f'Оценка: {t_score_num}'
        rows.append({
            'task_num': num,
            'answer': display_answer,
            'status': status_label,
        })
    try:
        rows.sort(key=lambda x: int(str(x.get('task_num') or '0')))
    except Exception:
        rows.sort(key=lambda x: str(x.get('task_num') or ''))
    return rows


def _build_student_report_pdf(assignment):
    try:
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import A4
            from reportlab.pdfbase import pdfmetrics
        except ImportError:
            logger.warning('reportlab is not installed; falling back to generator variant PDF.')
            return None

        _ensure_pdf_font()
        font_name = 'LKReport' if 'LKReport' in pdfmetrics.getRegisteredFontNames() else 'Helvetica'
        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        width, height = A4
        y = height - 48

        def draw_line(text, size=12, dy=18):
            nonlocal y
            if y < 48:
                c.showPage()
                c.setFont(font_name, size)
                y = height - 48
            c.setFont(font_name, size)
            c.drawString(42, y, str(text))
            y -= dy

        hw = assignment.homework
        student_name = f'{assignment.student.name} {assignment.student.surname}'.strip() or f'Ученик #{assignment.student_id}'
        teacher_name = f'{hw.teacher.name} {hw.teacher.surname}'.strip() or f'Учитель #{hw.teacher_id}'
        title = hw.title or f'Вариант {hw.variant_id}'
        draw_line('Отчет по результатам ученика', size=16, dy=24)
        draw_line(f'Ученик: {student_name}')
        draw_line(f'Учитель: {teacher_name}')
        draw_line(f'Задание: {title}')
        draw_line(f'Вариант ID: {hw.variant_id}')
        draw_line(f'Статус: {assignment.status}')
        draw_line(f'Баллы: {assignment.score if assignment.score is not None else "—"}')
        draw_line(f'Проверено: {timezone.localtime(assignment.reviewed_at).strftime("%d.%m.%Y %H:%M") if assignment.reviewed_at else "—"}')
        comment = (assignment.teacher_comment or '').strip()
        draw_line(f'Комментарий учителя: {comment or "—"}', dy=22)
        draw_line('Результаты по заданиям:', size=13, dy=20)
        rows = _lesson_result_rows_from_assignment(assignment)
        if not rows:
            draw_line('Детальные ответы не найдены.', size=11, dy=16)
        for row in rows:
            draw_line(f'Задание {row["task_num"]}: {row["answer"]} | {row["status"]}', size=10, dy=14)

        c.showPage()
        c.save()
        data = buf.getvalue()
        buf.close()
        return data if data else None
    except Exception:
        logger.exception('Не удалось собрать PDF-отчет assignment=%s', getattr(assignment, 'id', None))
        return None


def _random_avatar_emoji():
    return random.choice(tuple(AVATAR_EMOJI_POOL))


def _random_avatar_bg():
    return random.choice(tuple(AVATAR_BG_POOL))


def _registration_legal_context():
    return {
        'legal_document_version': LEGAL_DOCUMENT_VERSION,
        'user_agreement_url': LEGAL_USER_AGREEMENT_URL,
        'privacy_policy_url': LEGAL_PRIVACY_POLICY_URL,
    }


def _client_ip(request):
    forwarded = (request.META.get('HTTP_X_FORWARDED_FOR') or '').split(',')
    if forwarded and forwarded[0].strip():
        return forwarded[0].strip()[:45]
    return (request.META.get('REMOTE_ADDR') or '').strip()[:45] or None


def _save_registration_consents(request, profile, *, required_codes, optional_codes=(), source='registration'):
    now = timezone.now()
    ip = _client_ip(request)
    user_agent = (request.META.get('HTTP_USER_AGENT') or '').strip()[:1000]
    doc_urls = {
        CONSENT_CODE_USER_AGREEMENT: LEGAL_USER_AGREEMENT_URL,
        CONSENT_CODE_PERSONAL_DATA: LEGAL_PRIVACY_POLICY_URL,
        CONSENT_CODE_STUDENT_DATA_BASIS: LEGAL_PRIVACY_POLICY_URL,
        CONSENT_CODE_MARKETING: LEGAL_PRIVACY_POLICY_URL,
    }
    rows = []
    for code in [*required_codes, *optional_codes]:
        accepted = request.POST.get(code) == 'on'
        row, _ = UserPlatformConsent.objects.get_or_create(
            user=profile,
            consent_code=code,
            defaults={'accepted': False},
        )
        row.accepted = accepted
        row.version = LEGAL_DOCUMENT_VERSION
        row.source = source[:32]
        row.ip_address = ip
        row.user_agent = user_agent
        row.document_url = str(doc_urls.get(code) or '')[:500]
        row.checkbox_label = CONSENT_LABELS.get(code, '')
        row.updated_at = now
        if accepted:
            row.accepted_at = now
            row.revoked_at = None
        else:
            row.revoked_at = now
        rows.append(row)
    UserPlatformConsent.objects.bulk_update(
        rows,
        ['accepted', 'version', 'source', 'ip_address', 'user_agent', 'document_url', 'checkbox_label', 'accepted_at', 'revoked_at', 'updated_at'],
    )


def _ensure_profile_avatar(profile):
    if not getattr(profile, 'avatar_emoji', ''):
        profile.avatar_emoji = _random_avatar_emoji()
    if not getattr(profile, 'avatar_bg', ''):
        profile.avatar_bg = _random_avatar_bg()
    profile.save(update_fields=['avatar_emoji', 'avatar_bg'])
    return profile


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
    то ссылки /lesson/join/ будут открывать SPA ЛК.
    В DEBUG режиме подменяем базу на локальный генератор (по умолчанию 127.0.0.1:8000).
    """
    return str(getattr(settings, 'LOCAL_GENUROK_URL', '') or os.environ.get('LOCAL_GENUROK_URL') or 'http://127.0.0.1:8000').strip().rstrip('/')


def _strip_generator_base_app_suffix(base: str) -> str:
    """GENUROK_URL иногда копируют из ЛК с /app — убираем этот префикс для корректных ссылок генератора."""
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
    aid = assignment.pk
    tok_q = quote(str(token), safe='')
    pub = _generator_public_site_url().rstrip('/')
    if not pub:
        base = _generator_base_for_links(request).rstrip('/')
        if len(base) >= 4 and base.lower().endswith('/api'):
            base = base[:-4].rstrip('/')
        pub = base
    if not pub and request is not None:
        # Самый крайний fallback (нежелательно): текущий хост ЛК.
        pub = request.build_absolute_uri('/').rstrip('/')
    join_base = f'{pub}/lesson/join'
    base = f'{join_base}/?token={tok_q}&cabinet_session=homework&cabinet_assignment={aid}'
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


def _resolve_variant_level_subject_slugs(variant_id, fallback_subject=''):
    """Определяем level/subject slug для доступа к PDF варианта на генераторе."""
    data = None
    for require_secret in (False, True):
        try:
            data = _gen_proxy(f'api/variant-lookup/{int(variant_id)}/', require_secret=require_secret)
            break
        except Exception:
            data = None
    level = str((data or {}).get('level') or (data or {}).get('level_slug') or '').strip().lower().strip('/')
    subject = str((data or {}).get('subject') or (data or {}).get('subject_slug') or '').strip().lower().strip('/')
    if not subject and fallback_subject:
        subject = slugify(str(fallback_subject).strip().lower()).replace('-', '')
    if not level or not subject:
        return None, None
    return level, subject


def _fetch_variant_pdf_content(variant_id, homework_subject=''):
    """Скачивает PDF варианта с генератора. Возвращает bytes или None."""
    level, subject = _resolve_variant_level_subject_slugs(variant_id, fallback_subject=homework_subject)
    if not level or not subject:
        return None
    pdf_url = _build_generator_url(f'api/{level}/{subject}/variant/{int(variant_id)}/pdf/')
    try:
        resp = requests.get(pdf_url, timeout=25, verify=False, allow_redirects=True)
        if resp.status_code >= 400 or not resp.content:
            return None
        return resp.content
    except requests.RequestException:
        return None


def _upsert_student_lesson_report(assignment):
    """
    Создаёт/обновляет отчёт по ученику после проверки работы.
    PDF хранится в media/student_reports/.
    """
    hw = assignment.homework
    student = assignment.student
    teacher = hw.teacher
    title = hw.title or f'Вариант {hw.variant_id}'

    report, _ = StudentLessonReport.objects.get_or_create(
        assignment=assignment,
        defaults={
            'teacher': teacher,
            'student': student,
            'variant_id': int(hw.variant_id),
        },
    )
    report.teacher = teacher
    report.student = student
    report.assignment = assignment
    report.report_kind = 'homework'
    report.lesson_token = ''
    report.variant_id = int(hw.variant_id)
    report.title = title[:255]
    report.score = assignment.score
    report.status = assignment.status
    report.teacher_comment = assignment.teacher_comment or ''

    pdf_content = _build_student_report_pdf(assignment)
    if not pdf_content:
        pdf_content = _fetch_variant_pdf_content(hw.variant_id, homework_subject=hw.subject or '')
    if pdf_content:
        student_slug = slugify(f'{student.name}-{student.surname}') or f'student-{student.id}'
        file_name = f'report-{assignment.id}-{student_slug}.pdf'
        report.report_file.save(file_name, ContentFile(pdf_content), save=False)
        report.report_filename = file_name

    report.save()
    return report


def _upsert_lesson_report_by_token(*, token, payload, student_profile):
    """
    Сохраняет отчёт по завершению обычного урока (не ДЗ), если в токене есть variant_id.
    """
    if not student_profile:
        return None
    try:
        variant_id = int(payload.get('variant_id'))
    except Exception:
        return None

    teacher_user_id = payload.get('teacher_id')
    try:
        teacher = UserProfile.objects.get(user_id=int(teacher_user_id))
    except Exception:
        return None

    target_name = str(payload.get('target_name') or '').strip()
    title = f'Урок: {target_name}' if target_name else f'Урок (вариант {variant_id})'

    report, _ = StudentLessonReport.objects.update_or_create(
        teacher=teacher,
        student=student_profile,
        report_kind='lesson',
        lesson_token=str(token or '').strip(),
        defaults={
            'assignment': None,
            'variant_id': variant_id,
            'title': title[:255],
            'score': None,
            'status': 'reviewed',
            'teacher_comment': '',
        },
    )

    # PDF отчёта урока: тот же PDF варианта, чтобы запись сразу была кликабельной в таблице результатов.
    pdf_content = _fetch_variant_pdf_content(variant_id)
    if pdf_content:
        student_slug = slugify(f'{student_profile.name}-{student_profile.surname}') or f'student-{student_profile.id}'
        token_hash = hashlib.sha1(str(token or '').encode('utf-8')).hexdigest()[:10]
        file_name = f'lesson-report-{variant_id}-{student_slug}-{token_hash}.pdf'
        report.report_file.save(file_name, ContentFile(pdf_content), save=False)
        report.report_filename = file_name
        report.save(update_fields=['report_file', 'report_filename', 'generated_at'])
    return report


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


def _coerce_homework_result_payload(raw_result):
    """
    Нормализуем payload результата:
    - dict -> как есть
    - JSON-строка -> dict
    - всё остальное -> None (игнор)
    """
    if isinstance(raw_result, dict):
        return raw_result
    if isinstance(raw_result, str):
        txt = raw_result.strip()
        if not txt:
            return None
        try:
            parsed = json.loads(txt)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


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


def _lesson_personalize_student_join_url(student_url: str, student_user_id: int):
    """
    Делает персональную student-ссылку с токеном, где зафиксирован student_user_id.
    Это нужно для группового урока, чтобы генератор различал участников (курсоры/ответы).
    """
    raw_url = (student_url or '').strip()
    if not raw_url:
        return raw_url, ''
    try:
        parts = urllib.parse.urlsplit(raw_url)
        qs = urllib.parse.parse_qs(parts.query, keep_blank_values=True)
        token = (qs.get('token') or [''])[0].strip()
        if not token:
            return raw_url, ''
        payload = jwt.decode(
            token,
            LESSON_SECRET,
            algorithms=['HS256'],
            options={'require': ['exp']},
        )
        if payload.get('iss') != 'cabinet':
            return raw_url, token
        payload['student_user_id'] = int(student_user_id)
        per_token = jwt.encode(payload, LESSON_SECRET, algorithm='HS256')
        qs['token'] = [per_token]
        per_query = urllib.parse.urlencode(qs, doseq=True)
        per_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, per_query, parts.fragment))
        return per_url, per_token
    except Exception:
        return raw_url, ''


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
            for student in _group_students_for_lesson(target_id):
                sid = getattr(student, 'id', None)
                uid = getattr(student, 'user_id', None)
                susername = getattr(student, 'username', None)
                uusername = getattr(getattr(student, 'user', None), 'username', None)
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


def _group_students_for_lesson(group_id):
    """
    Участники группы для звонков.
    Источники:
    - актуальная связь TeachersStudent.group,
    - legacy-связь TeachersGroup (для обратной совместимости).
    """
    student_ids = set(
        TeachersStudent.objects.filter(group_id=group_id).values_list('student_id', flat=True),
    )
    student_ids.update(
        TeachersGroup.objects.filter(group_id=group_id).values_list('student_id', flat=True),
    )
    if not student_ids:
        return UserProfile.objects.none()
    return UserProfile.objects.filter(id__in=student_ids).select_related('user')

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
    В проде SPA отдаётся Django на корне /.
    """
    return request.build_absolute_uri('/')


def lesson_join_spa_redirect(request):
    """
    /lesson/join/ -> /?variant_play=<assignment_id>...
    Для ДЗ-ссылок из генератора приводим оба пути (join и variant_play) к одному экрану ExamPage в SPA.
    """
    role = str(request.GET.get('role') or '').strip().lower()
    assignment_raw = request.GET.get('cabinet_assignment')
    assignment_id = None
    token = str(request.GET.get('token') or '').strip()
    try:
        assignment_id = int(assignment_raw)
    except (TypeError, ValueError):
        if token:
            try:
                payload = jwt.decode(token, LESSON_SECRET, algorithms=['HS256'])
                assignment_id = int(payload.get('homework_assignment_id'))
            except Exception:
                assignment_id = None

    base = request.build_absolute_uri('/')
    if assignment_id is None:
        # Если это не ДЗ-ссылка (assignment_id отсутствует), прокидываем на generator /lesson/join/ с тем же query,
        # чтобы не было лишнего шага через главную ЛК.
        pub = _generator_public_site_url().rstrip('/')
        if pub and token:
            qs = request.META.get('QUERY_STRING', '')
            if qs:
                return redirect(f'{pub}/lesson/join/?{qs}')
            return redirect(f'{pub}/lesson/join/')
        return redirect(base)

    params = {'variant_play': str(assignment_id)}
    # Учитель открывает режим проверки, ученик — локальный exam-view (без повторного редиректа на join-url).
    if role == 'teacher':
        params['hw_review'] = '1'
    else:
        params['hw_local'] = '1'
    return redirect(f'{base}?{urllib.parse.urlencode(params)}')


def _login_rate_limit_key(request):
    return f'cabinet:login_fail:{request.META.get("REMOTE_ADDR", "unknown")}'  # ключ кэша: провалы входа по IP


def _forgot_password_rate_limit_key(request):
    return f'cabinet:forgot_fail:{request.META.get("REMOTE_ADDR", "unknown")}'


def _mint_student_invite_token(*, teacher_profile_id, subject_id, level_id, lesson_type, group_id=None):
    now = int(time.time())
    payload = {
        'iss': 'cabinet_student_invite',
        'iat': now,
        'exp': now + STUDENT_INVITE_TTL,
        'jti': uuid.uuid4().hex,  # одноразовый идентификатор инвайта
        'teacher_profile_id': int(teacher_profile_id),
        'subject_id': int(subject_id),
        'level_id': int(level_id),
        'lesson_type': str(lesson_type),
    }
    if group_id:
        payload['group_id'] = int(group_id)
    return jwt.encode(payload, LESSON_SECRET, algorithm='HS256')


def _decode_student_invite_token(token_raw):
    try:
        payload = jwt.decode(
            str(token_raw or '').strip(),
            LESSON_SECRET,
            algorithms=['HS256'],
            options={'require': ['exp']},
        )
    except Exception:
        return None
    if payload.get('iss') != 'cabinet_student_invite':
        return None
    return payload


def _student_invite_unique_key(payload, token_raw):
    """Стабильный ключ одноразовой ссылки: jti (новые токены) или hash токена (legacy)."""
    jti = str((payload or {}).get('jti') or '').strip()
    if jti:
        return jti
    token = str(token_raw or '').strip()
    if not token:
        return ''
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _student_invite_used_cache_key(invite_key):
    return f'cabinet:student_invite:used:{invite_key}'


def _student_invite_lock_cache_key(invite_key):
    return f'cabinet:student_invite:lock:{invite_key}'


def _student_invite_used_ttl(payload):
    try:
        exp = int((payload or {}).get('exp') or 0)
    except Exception:
        exp = 0
    now = int(time.time())
    return max(300, exp - now + 300)


def _login_page_context(request):
    """Контекст страницы входа: настройки виджета VK ID (если задан VKID_APP_ID)."""
    ctx = {}
    app_id = getattr(settings, 'VKID_APP_ID', '').strip()
    if app_id and not re.fullmatch(r'\d+', app_id):
        logger.warning('VK ID disabled on /login/: VKID_APP_ID must contain only digits.')
        return ctx
    if app_id:
        ctx['vkid_app_id'] = app_id
        redir = getattr(settings, 'VKID_REDIRECT_URL', '').strip()
        ctx['vkid_redirect_url'] = redir or request.build_absolute_uri('/login/')
        ctx['vkid_scope'] = getattr(settings, 'VKID_SCOPE', 'email') or 'email'
    elif not settings.DEBUG:
        logger.warning('VK ID disabled on /login/: VKID_APP_ID is empty in production environment.')
    return ctx


def login_view(request):
    if request.user.is_authenticated:                                       # пользователь уже вошёл
        if user_can_use_lk(request.user):                                   # имеет доступ к ЛК
            return redirect(_dashboard_url(request))                        # → редирект на дашборд
        logout(request)
        messages.error(
            request,
            'Для личного кабинета используйте учётную запись с доступом в ЛК.',
        )
        return render(request, 'login.html', _login_page_context(request))

    if request.method == 'POST':                                            # обработка формы входа
        rl_key = _login_rate_limit_key(request)                            # ключ для rate limit по IP
        if cache.get(rl_key, 0) >= 25:                                     # превышен лимит попыток (25 за 15 минут)
            messages.error(
                request,
                'Слишком много неудачных попыток входа с этого адреса. Подождите около 15 минут.',
            )
            return render(request, 'login.html', _login_page_context(request))  # показываем форму с ошибкой блокировки

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

    return render(request, 'login.html', _login_page_context(request))      # GET-запрос или ошибка → рендерим форму


@require_POST
def forgot_password_view(request):
    rl_key = _forgot_password_rate_limit_key(request)
    if cache.get(rl_key, 0) >= 12:
        return JsonResponse({'error': 'Слишком много попыток. Попробуйте позже.'}, status=429)

    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Некорректный запрос.'}, status=400)

    login_str = (body.get('login') or '').strip()[:254]
    email = (body.get('email') or '').strip()[:254].lower()
    if not login_str or not email:
        return JsonResponse({'error': 'Укажите логин (или email) и email для подтверждения.'}, status=400)

    generic_error = {'error': 'Пользователь не найден или данные не совпадают.'}
    user_obj = get_user_by_login(login_str)
    user_email = (getattr(user_obj, 'email', '') or '').strip().lower() if user_obj else ''
    if not user_obj or not user_email or user_email != email:
        try:
            cache.incr(rl_key)
        except ValueError:
            cache.set(rl_key, 1, timeout=900)
        return JsonResponse(generic_error, status=400)

    try:
        profile = user_obj.profile
    except UserProfile.DoesNotExist:
        profile = None
    if not profile or profile.role == 'student' or user_obj.is_superuser:
        try:
            cache.incr(rl_key)
        except ValueError:
            cache.set(rl_key, 1, timeout=900)
        return JsonResponse(generic_error, status=400)

    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    new_password = ''.join(random.choices(alphabet, k=10))
    user_obj.set_password(new_password)
    user_obj.save(update_fields=['password'])
    cache.delete(rl_key)
    return JsonResponse({'ok': True, 'login': user_obj.username, 'password': new_password})


@require_POST
def vkid_login_view(request):
    """
    Обмен access_token VK ID на сессию Django: user_info → UserProfile (vk_user_id или email учителя).
    """
    if request.user.is_authenticated and user_can_use_lk(request.user):
        next_raw = request.GET.get('next')
        safe = safe_redirect_target(next_raw, request) if next_raw else None
        return JsonResponse({'redirect': safe or _dashboard_url(request)})

    app_id = getattr(settings, 'VKID_APP_ID', '').strip()
    if not app_id:
        return JsonResponse({'error': 'Вход через VK не настроен.'}, status=503)

    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Некорректный запрос.'}, status=400)

    access_token = (body.get('access_token') or '').strip()
    if not access_token:
        return JsonResponse({'error': 'Нет токена доступа.'}, status=400)

    try:
        r = requests.post(
            'https://id.vk.ru/oauth2/user_info',
            data={'client_id': app_id, 'access_token': access_token},
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=12,
        )
    except requests.RequestException:
        return JsonResponse({'error': 'Не удалось связаться с VK ID. Попробуйте позже.'}, status=502)

    try:
        vi = r.json()
    except ValueError:
        return JsonResponse({'error': 'Некорректный ответ VK ID.'}, status=502)

    if r.status_code != 200:
        err = vi.get('error_description') or vi.get('error') or 'Ошибка VK ID'
        return JsonResponse({'error': str(err)}, status=400)

    user_blob = vi.get('user') if isinstance(vi.get('user'), dict) else vi
    vk_id = user_blob.get('user_id')
    if vk_id is None or vk_id == '':
        return JsonResponse({'error': 'VK ID не вернул идентификатор пользователя.'}, status=400)
    vk_id = str(vk_id)

    email = (user_blob.get('email') or '').strip().lower()

    profile = UserProfile.objects.select_related('user').filter(vk_user_id=vk_id).first()

    if not profile and email:
        q = UserProfile.objects.select_related('user').filter(user__email__iexact=email)
        n = q.count()
        if n > 1:
            return JsonResponse(
                {'error': 'Несколько учётных записей с таким email. Обратитесь в поддержку.'},
                status=409,
            )
        profile = q.first()

    if not profile:
        return JsonResponse(
            {
                'error': (
                    'Аккаунт не найден. Зарегистрируйтесь в кабинете, затем войдите через VK '
                    '(email в VK должен совпадать с email в кабинете) или обратитесь в поддержку.'
                ),
            },
            status=404,
        )

    if profile.role == 'student':
        return JsonResponse({'error': 'Вход через VK доступен только учителям.'}, status=403)

    if profile.vk_user_id and profile.vk_user_id != vk_id:
        return JsonResponse({'error': 'Этот аккаунт уже привязан к другому профилю VK.'}, status=409)

    if UserProfile.objects.exclude(pk=profile.pk).filter(vk_user_id=vk_id).exists():
        return JsonResponse({'error': 'Этот аккаунт VK уже привязан к другому пользователю.'}, status=409)

    if not profile.vk_user_id:
        profile.vk_user_id = vk_id
        profile.save(update_fields=['vk_user_id'])
    if not profile.avatar_emoji or not profile.avatar_bg:
        _ensure_profile_avatar(profile)

    user = profile.user
    if not user_can_use_lk(user):
        return JsonResponse({'error': 'У этой учётной записи нет доступа к кабинету.'}, status=403)

    login(request, user)
    next_raw = request.GET.get('next')
    safe = safe_redirect_target(next_raw, request) if next_raw else None
    return JsonResponse({'redirect': safe or _dashboard_url(request)})


def register_view(request):
    if request.user.is_authenticated:                                       # уже авторизован — не нужна регистрация
        if user_can_use_lk(request.user):
            return redirect(_dashboard_url(request))                        # → в ЛК
        logout(request)
        messages.error(
            request,
            'Для регистрации в личном кабинете войдите под учётной записью ЛК.',
        )
        return redirect('login')

    subjects = Subject.objects.all().order_by('subject_name')              # все предметы для чекбоксов формы
    register_context = {'subjects': subjects, **_registration_legal_context()}

    if request.method == 'POST':                                            # отправка формы регистрации
        name        = (request.POST.get('name') or '').strip()[:100]       # имя (макс. 100 символов)
        surname     = (request.POST.get('surname') or '').strip()[:100]    # фамилия
        email       = (request.POST.get('email') or '').strip()[:254]      # email (макс. 254 по RFC)
        password1   = (request.POST.get('password1') or '')[:128]          # пароль
        password2   = (request.POST.get('password2') or '')[:128]          # подтверждение пароля
        subject_ids = request.POST.getlist('subjects')                     # список выбранных ID предметов
        required_consents = (
            CONSENT_CODE_USER_AGREEMENT,
            CONSENT_CODE_PERSONAL_DATA,
            CONSENT_CODE_STUDENT_DATA_BASIS,
        )

        try:
            subj_ints = [int(x) for x in subject_ids]                      # конвертируем строки в int
        except (TypeError, ValueError):
            messages.error(request, 'Некорректный выбор предметов')
            return render(request, 'register.html', register_context) # показываем форму с ошибкой

        if not all([name, surname, email, password1]):                      # проверяем обязательные поля
            messages.error(request, 'Заполните все обязательные поля')
        elif any(request.POST.get(code) != 'on' for code in required_consents):
            messages.error(request, 'Подтвердите обязательные юридические согласия')
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
                return render(request, 'register.html', register_context)

            valid_subject_ids = set(Subject.objects.filter(id__in=subj_ints).values_list('id', flat=True))  # ID предметов из БД
            if valid_subject_ids != set(subj_ints):                        # кто-то подделал ID предметов
                messages.error(request, 'Выбран неизвестный предмет')
                return render(request, 'register.html', register_context)

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
                avatar_emoji=_random_avatar_emoji(),
                avatar_bg=_random_avatar_bg(),
            )
            selected = Subject.objects.filter(id__in=subj_ints)            # queryset выбранных предметов
            TeacherSubject.objects.bulk_create([                           # массово создаём связи учитель → предмет
                TeacherSubject(teacher=profile, subject=s) for s in selected
            ])
            _save_registration_consents(
                request,
                profile,
                required_codes=required_consents,
                optional_codes=(CONSENT_CODE_MARKETING,),
                source='teacher_registration',
            )
            login(request, user)                                           # сразу авторизуем после регистрации
            return render(request, 'register_success.html', {'username': username})  # страница с логином

    return render(request, 'register.html', register_context)        # GET или ошибки → форма регистрации


def register_student_invite_view(request):
    """
    Саморегистрация ученика по персональной ссылке от учителя.
    GET /register/student/?token=...
    """
    token = (request.GET.get('token') or request.POST.get('token') or '').strip()
    payload = _decode_student_invite_token(token)
    if not payload:
        return render(request, 'register_student.html', {'invite_invalid': True})
    invite_key = _student_invite_unique_key(payload, token)
    if not invite_key:
        return render(request, 'register_student.html', {'invite_invalid': True})
    used_cache_key = _student_invite_used_cache_key(invite_key)
    if cache.get(used_cache_key):
        return render(request, 'register_student.html', {'invite_invalid': True})

    teacher_profile = UserProfile.objects.filter(id=payload.get('teacher_profile_id')).first()
    subject = Subject.objects.filter(id=payload.get('subject_id')).first()
    level = Level.objects.filter(id=payload.get('level_id')).first()
    lesson_type = str(payload.get('lesson_type') or 'individual')
    group_id = payload.get('group_id')
    group = None
    if lesson_type == 'group':
        group = Group.objects.filter(id=group_id, teacher=teacher_profile).first()
        if not group:
            return render(request, 'register_student.html', {'invite_invalid': True})

    if not teacher_profile or not subject or not level:
        return render(request, 'register_student.html', {'invite_invalid': True})

    if request.method == 'POST':
        name = (request.POST.get('name') or '').strip()[:100]
        surname = (request.POST.get('surname') or '').strip()[:100]
        email = (request.POST.get('email') or '').strip()[:254]
        phone = (request.POST.get('phone') or '').strip()[:64]
        grade = (request.POST.get('grade') or '').strip()
        password1 = (request.POST.get('password1') or '')[:128]
        password2 = (request.POST.get('password2') or '')[:128]
        required_consents = (
            CONSENT_CODE_USER_AGREEMENT,
            CONSENT_CODE_PERSONAL_DATA,
        )

        valid_grades = {c[0] for c in TeachersStudent.GRADE_CHOICES}
        if not name:
            messages.error(request, 'Введите имя')
        elif not email:
            messages.error(request, 'Введите email')
        elif any(request.POST.get(code) != 'on' for code in required_consents):
            messages.error(request, 'Подтвердите обязательные юридические согласия')
        elif grade not in valid_grades:
            messages.error(request, 'Выберите корректный класс')
        elif password1 != password2:
            messages.error(request, 'Пароли не совпадают')
        elif len(password1) < 8:
            messages.error(request, 'Пароль должен быть не менее 8 символов')
        elif email and User.objects.filter(email=email).exists():
            messages.error(request, 'Email уже используется')
        else:
            try:
                validate_password(password1, user=User(email=email, username=email[:30] or 'student'))
            except ValidationError as e:
                for err in e.messages:
                    messages.error(request, err)
            else:
                lock_cache_key = _student_invite_lock_cache_key(invite_key)
                got_lock = cache.add(lock_cache_key, 1, timeout=30)
                if not got_lock:
                    messages.error(request, 'Ссылка уже используется. Обновите страницу или попросите новую ссылку.')
                elif cache.get(used_cache_key):
                    messages.error(request, 'Ссылка уже была использована. Попросите учителя отправить новую.')
                else:
                    try:
                        with transaction.atomic():
                            username = generate_username()
                            user = User.objects.create_user(
                                username=username,
                                email=email,
                                password=password1,
                                first_name=name,
                                last_name=surname,
                                is_staff=False,
                                is_superuser=False,
                            )
                            profile = UserProfile.objects.create(
                                user=user,
                                username=username,
                                name=name,
                                surname=surname,
                                email=email,
                                phone=phone or None,
                                role='student',
                                avatar_emoji=_random_avatar_emoji(),
                                avatar_bg=_random_avatar_bg(),
                            )
                            TeachersStudent.objects.create(
                                teacher=teacher_profile,
                                student=profile,
                                subject=subject,
                                level=level,
                                grade=grade,
                                goal='',
                                status='1',
                                lesson_type='group' if lesson_type == 'group' else 'individual',
                                group=group if lesson_type == 'group' else None,
                            )
                            _save_registration_consents(
                                request,
                                profile,
                                required_codes=required_consents,
                                optional_codes=(CONSENT_CODE_MARKETING,),
                                source='student_invite_registration',
                            )
                            cache.set(used_cache_key, 1, timeout=_student_invite_used_ttl(payload))
                    finally:
                        cache.delete(lock_cache_key)
                    login(request, user)
                    return redirect(_dashboard_url(request))

    return render(
        request,
        'register_student.html',
        {
            'invite_invalid': False,
            'token': token,
            'teacher_name': f'{teacher_profile.name} {teacher_profile.surname}'.strip() or teacher_profile.username,
            'subject_name': subject.subject_name,
            'level_name': level.level,
            'group_name': group.group_name if group else '',
            'is_group': lesson_type == 'group',
            'grade_choices': [c[0] for c in TeachersStudent.GRADE_CHOICES],
            **_registration_legal_context(),
        },
    )


def logout_view(request):
    logout(request)                                                         # завершаем сессию Django
    return redirect(settings.LOGOUT_REDIRECT_URL)                          # перенаправляем на страницу после выхода


def settings_view(request):
    if request.user.is_authenticated and not user_can_use_lk(request.user):  # суперпользователь без ЛК
        logout(request)
        messages.error(
            request,
            'Доступ к настройкам личного кабинета разрешён только пользователям ЛК.',
        )
        return redirect('login')
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
                    'avatar_emoji': _random_avatar_emoji(),
                    'avatar_bg': _random_avatar_bg(),
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
        """Прямое создание ученика учителем отключено — только инвайт-ссылки."""
        return Response(
            {
                'error': 'Регистрация ученика учителем отключена. Используйте приглашение по ссылке.',
                'code': 'student_direct_create_disabled',
            },
            status=status.HTTP_410_GONE,
        )


class StudentInviteLinkView(TeacherProfileMixin, APIView):
    """
    POST /api/students/invite-link/
    Генерация персональной ссылки регистрации ученика:
    - individual: teacher выбирает subject + level
    - group: привязка к конкретной группе
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        teacher_profile = self.get_teacher_profile(request)
        lesson_type = str(request.data.get('lesson_type') or 'individual').strip().lower()
        if lesson_type not in ('individual', 'group'):
            return Response({'error': 'lesson_type: individual или group'}, status=status.HTTP_400_BAD_REQUEST)

        subject = None
        level = None
        group = None

        if lesson_type == 'group':
            group_id = request.data.get('group_id')
            try:
                group = Group.objects.select_related('subject', 'level').get(
                    id=int(group_id),
                    teacher=teacher_profile,
                )
            except (Group.DoesNotExist, TypeError, ValueError):
                return Response({'error': 'Группа не найдена'}, status=status.HTTP_404_NOT_FOUND)
            subject = group.subject
            level = group.level
        else:
            try:
                subject = Subject.objects.get(id=int(request.data.get('subject')))
                level = Level.objects.get(id=int(request.data.get('level')))
            except (Subject.DoesNotExist, Level.DoesNotExist, TypeError, ValueError):
                return Response({'error': 'Предмет или уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)

        token = _mint_student_invite_token(
            teacher_profile_id=teacher_profile.id,
            subject_id=subject.id,
            level_id=level.id,
            lesson_type=lesson_type,
            group_id=group.id if group else None,
        )
        token_q = urllib.parse.quote(str(token), safe='')
        invite_url = request.build_absolute_uri(f'/register/student/?token={token_q}')
        return Response({
            'invite_url': invite_url,
            'expires_in': STUDENT_INVITE_TTL,
            'lesson_type': lesson_type,
            'subject_name': subject.subject_name,
            'level_name': level.level,
            'group_name': group.group_name if group else '',
        })


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
                if not em:
                    return Response({'error': 'Email обязателен'}, status=status.HTTP_400_BAD_REQUEST)
                profile.email = em
                if user:
                    user.email = em                                       # синхронизируем email в User
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

        # Совместимость: фронт может присылать `group` вместо `group_id`.
        has_group_key = 'group_id' in data or 'group' in data
        if has_group_key:                                                # явное указание группы
            group_id = data.get('group_id') if 'group_id' in data else data.get('group')
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
                'avatar_emoji': '',
                'avatar_bg': '',
            })
        if profile.role == 'student':                                   # профиль ученика — без предметов
            if not profile.avatar_emoji or not profile.avatar_bg:
                _ensure_profile_avatar(profile)
            consent_rows = UserPlatformConsent.objects.filter(user=profile)
            consents = {row.consent_code: bool(row.accepted) for row in consent_rows}
            return Response({
                'username': profile.username,
                'name': profile.name,
                'surname': profile.surname,
                'email': profile.email,
                'role': profile.role,
                'subjects': [],                                         # у ученика нет предметов в этом контексте
                'avatar_emoji': profile.avatar_emoji or '',
                'avatar_bg': profile.avatar_bg or '',
                'consents': consents,
            })
        if not profile.avatar_emoji or not profile.avatar_bg:
            _ensure_profile_avatar(profile)
        consent_rows = UserPlatformConsent.objects.filter(user=profile)
        consents = {row.consent_code: bool(row.accepted) for row in consent_rows}
        return Response({                                               # профиль учителя — с предметами
            'username': profile.username,
            'name': profile.name,
            'surname': profile.surname,
            'email': profile.email,
            'role': profile.role,
            'subjects': subject_names,                                  # список предметов учителя
            'avatar_emoji': profile.avatar_emoji or '',
            'avatar_bg': profile.avatar_bg or '',
            'consents': consents,
        })

    def patch(self, request):
        avatar_emoji_raw = request.data.get('avatar_emoji', None)
        avatar_bg_raw = request.data.get('avatar_bg', None)
        if avatar_emoji_raw is None and avatar_bg_raw is None:
            return Response({'error': 'Нужно передать avatar_emoji или avatar_bg'}, status=status.HTTP_400_BAD_REQUEST)

        avatar_emoji = str(avatar_emoji_raw or '').strip() if avatar_emoji_raw is not None else None
        avatar_bg = str(avatar_bg_raw or '').strip() if avatar_bg_raw is not None else None

        if avatar_emoji is not None and avatar_emoji and avatar_emoji not in AVATAR_EMOJI_POOL:
            return Response(
                {'error': 'Недопустимый аватар. Используйте emoji из списка еды, животных или растений.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if avatar_bg is not None and avatar_bg and avatar_bg not in AVATAR_BG_POOL:
            return Response(
                {'error': 'Недопустимый фон аватара.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        profile, _ = UserProfile.objects.get_or_create(
            user=request.user,
            defaults={
                'username': request.user.username,
                'name': request.user.first_name or request.user.username,
                'surname': request.user.last_name or '',
                'email': request.user.email or '',
                'role': 'teacher',
                'avatar_emoji': _random_avatar_emoji(),
                'avatar_bg': _random_avatar_bg(),
            },
        )
        update_fields = []
        if avatar_emoji is not None:
            profile.avatar_emoji = avatar_emoji
            update_fields.append('avatar_emoji')
        if avatar_bg is not None:
            profile.avatar_bg = avatar_bg
            update_fields.append('avatar_bg')
        if update_fields:
            profile.save(update_fields=update_fields)

        subject_names = []
        if profile.role != 'student':
            subject_names = list(
                TeacherSubject.objects.filter(teacher=profile)
                .values_list('subject__subject_name', flat=True)
            )
        return Response({
            'username': profile.username,
            'name': profile.name,
            'surname': profile.surname,
            'email': profile.email,
            'role': profile.role,
            'subjects': subject_names if profile.role != 'student' else [],
            'avatar_emoji': profile.avatar_emoji or '',
            'avatar_bg': profile.avatar_bg or '',
            'consents': {
                row.consent_code: bool(row.accepted)
                for row in UserPlatformConsent.objects.filter(user=profile)
            },
        })


class MePlatformConsentView(APIView):
    """
    GET /api/me/consents/
    PATCH /api/me/consents/
    Хранит и возвращает состояние согласий пользователя по использованию платформы.
    """
    permission_classes = [IsLKTeacher]

    @staticmethod
    def _serialize(row):
        return {
            'consent_code': row.consent_code,
            'accepted': bool(row.accepted),
            'accepted_at': row.accepted_at,
            'revoked_at': row.revoked_at,
            'version': row.version or '',
            'source': row.source or '',
            'ip_address': row.ip_address or '',
            'document_url': row.document_url or '',
            'checkbox_label': row.checkbox_label or '',
            'updated_at': row.updated_at,
        }

    def _ensure_profile(self, request):
        profile, _ = UserProfile.objects.get_or_create(
            user=request.user,
            defaults={
                'username': request.user.username,
                'name': request.user.first_name or request.user.username,
                'surname': request.user.last_name or '',
                'email': request.user.email or '',
                'role': 'teacher',
                'avatar_emoji': _random_avatar_emoji(),
                'avatar_bg': _random_avatar_bg(),
            },
        )
        return profile

    def get(self, request):
        profile = self._ensure_profile(request)
        rows = {
            row.consent_code: row
            for row in UserPlatformConsent.objects.filter(user=profile)
        }

        # Отдаём стандартное согласие даже если запись ещё не создана.
        out = []
        for code in sorted(ALLOWED_PLATFORM_CONSENT_CODES):
            row = rows.get(code)
            if row is None:
                out.append({
                    'consent_code': code,
                    'accepted': False,
                    'accepted_at': None,
                    'revoked_at': None,
                    'version': '',
                    'source': '',
                    'ip_address': '',
                    'document_url': '',
                    'checkbox_label': CONSENT_LABELS.get(code, ''),
                    'updated_at': None,
                })
            else:
                out.append(self._serialize(row))
        return Response({'consents': out})

    def patch(self, request):
        profile = self._ensure_profile(request)
        now = timezone.now()

        if isinstance(request.data.get('consents'), list):
            raw_items = request.data.get('consents') or []
        else:
            raw_items = [request.data]

        if not raw_items:
            return Response({'error': 'Передайте consent_code и accepted'}, status=status.HTTP_400_BAD_REQUEST)

        updated_rows = []
        for item in raw_items:
            if not isinstance(item, dict):
                return Response({'error': 'Каждый элемент consents должен быть объектом'}, status=status.HTTP_400_BAD_REQUEST)

            code = str(item.get('consent_code') or '').strip().lower()
            if not code:
                return Response({'error': 'consent_code обязателен'}, status=status.HTTP_400_BAD_REQUEST)
            if code not in ALLOWED_PLATFORM_CONSENT_CODES:
                return Response({'error': f'Недопустимый consent_code: {code}'}, status=status.HTTP_400_BAD_REQUEST)
            if 'accepted' not in item:
                return Response({'error': f'accepted обязателен для {code}'}, status=status.HTTP_400_BAD_REQUEST)

            accepted = bool(item.get('accepted'))
            version = str(item.get('version') or '').strip()[:32]
            source = str(item.get('source') or 'lk').strip()[:32] or 'lk'
            document_url = str(item.get('document_url') or '').strip()[:500]
            checkbox_label = str(item.get('checkbox_label') or CONSENT_LABELS.get(code, '')).strip()

            row, _ = UserPlatformConsent.objects.get_or_create(
                user=profile,
                consent_code=code,
                defaults={'accepted': False},
            )
            row.accepted = accepted
            row.version = version
            row.source = source
            row.ip_address = _client_ip(request)
            row.user_agent = (request.META.get('HTTP_USER_AGENT') or '').strip()[:1000]
            row.document_url = document_url
            row.checkbox_label = checkbox_label
            if accepted:
                row.accepted_at = now
                row.revoked_at = None
            else:
                row.revoked_at = now
            row.save()
            updated_rows.append(row)

        return Response({'consents': [self._serialize(r) for r in updated_rows]})


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


class GroupDetailView(TeacherProfileMixin, APIView):
    """DELETE: удалить группу; ученики с этой группой → архив (статус 3), без группы, индив. занятия."""

    permission_classes = [IsCabinetTeacher]

    def patch(self, request, pk):
        teacher_profile = self.get_teacher_profile(request)
        try:
            group = Group.objects.get(pk=pk, teacher=teacher_profile)
        except Group.DoesNotExist:
            return Response({'error': 'Группа не найдена'}, status=status.HTTP_404_NOT_FOUND)

        raw_name = request.data.get('group_name')
        new_name = str(raw_name or '').strip()
        if not new_name:
            return Response({'error': 'Введите название группы'}, status=status.HTTP_400_BAD_REQUEST)
        if len(new_name) > 120:
            return Response({'error': 'Название группы слишком длинное'}, status=status.HTTP_400_BAD_REQUEST)

        group.group_name = new_name
        group.save(update_fields=['group_name'])
        return Response(GroupSerializer(group).data)

    def delete(self, request, pk):
        teacher_profile = self.get_teacher_profile(request)
        try:
            group = Group.objects.get(pk=pk, teacher=teacher_profile)
        except Group.DoesNotExist:
            return Response({'error': 'Группа не найдена'}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            TeachersStudent.objects.filter(teacher=teacher_profile, group=group).update(
                status='3',
                group=None,
                lesson_type='individual',
            )
            TeachersGroup.objects.filter(group=group).delete()
            group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
                for student in _group_students_for_lesson(target_id):
                    sid = getattr(student, 'id', None)
                    uid = getattr(student, 'user_id', None)
                    susername = getattr(student, 'username', None)
                    uusername = getattr(getattr(student, 'user', None), 'username', None)
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

        ws_sent = False
        if lesson_type == 'group':
            # Для группы шлём персональный токен/URL каждому ученику.
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
            except Exception:
                channel_layer = None

            for student in _group_students_for_lesson(target_id):
                uid = getattr(student, 'user_id', None)
                if not uid:
                    continue
                per_url, per_token = _lesson_personalize_student_join_url(data.get('student_url') or '', uid)
                per_payload = {
                    **invite_payload,
                    'student_url': per_url or invite_payload.get('student_url'),
                    'token': per_token or token,
                }
                cache.set(f'lesson_pending_invite_user:{uid}', per_payload, timeout=LESSON_TTL)
                if getattr(student, 'id', None):
                    cache.set(f'lesson_pending_invite_profile:{student.id}', per_payload, timeout=LESSON_TTL)
                if getattr(student, 'username', None):
                    cache.set(f'lesson_pending_invite_username:{student.username}', per_payload, timeout=LESSON_TTL)
                if getattr(getattr(student, 'user', None), 'username', None):
                    cache.set(f'lesson_pending_invite_username:{student.user.username}', per_payload, timeout=LESSON_TTL)
                if channel_layer:
                    try:
                        async_to_sync(channel_layer.group_send)(
                            f"user_{uid}",
                            {"type": "notify_message", "data": per_payload},
                        )
                        ws_sent = True
                    except Exception:
                        pass
        else:
            for uid in notify_user_ids:
                cache.set(f'lesson_pending_invite_user:{uid}', invite_payload, timeout=LESSON_TTL)
            for pid in notify_profile_ids:
                cache.set(f'lesson_pending_invite_profile:{pid}', invite_payload, timeout=LESSON_TTL)
            for uname in notify_usernames:
                cache.set(f'lesson_pending_invite_username:{uname}', invite_payload, timeout=LESSON_TTL)

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
                for student in _group_students_for_lesson(target_id):
                    sid = getattr(student, 'id', None)
                    uid = getattr(student, 'user_id', None)          # user_id каждого члена группы
                    susername = getattr(student, 'username', None)
                    uusername = getattr(getattr(student, 'user', None), 'username', None)
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

        ws_sent = False                                               # флаг: отправлено ли через WebSocket
        if lesson_type == 'group':
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
            except Exception:
                channel_layer = None

            for student in _group_students_for_lesson(target_id):
                uid = getattr(student, 'user_id', None)
                if not uid:
                    continue
                per_url, per_token = _lesson_personalize_student_join_url(student_url, uid)
                per_payload = {
                    **invite_payload,
                    'student_url': per_url or student_url,
                    'token': per_token or token,
                }
                cache.set(f'lesson_pending_invite_user:{uid}', per_payload, timeout=LESSON_TTL)
                if getattr(student, 'id', None):
                    cache.set(f'lesson_pending_invite_profile:{student.id}', per_payload, timeout=LESSON_TTL)
                if getattr(student, 'username', None):
                    cache.set(f'lesson_pending_invite_username:{student.username}', per_payload, timeout=LESSON_TTL)
                if getattr(getattr(student, 'user', None), 'username', None):
                    cache.set(f'lesson_pending_invite_username:{student.user.username}', per_payload, timeout=LESSON_TTL)
                if channel_layer:
                    try:
                        async_to_sync(channel_layer.group_send)(
                            f"user_{uid}",
                            {"type": "notify_message", "data": per_payload},
                        )
                        ws_sent = True
                    except Exception:
                        pass
        else:
            for uid in notify_user_ids:
                cache.set(f'lesson_pending_invite_user:{uid}', invite_payload, timeout=LESSON_TTL)
            for pid in notify_profile_ids:
                cache.set(f'lesson_pending_invite_profile:{pid}', invite_payload, timeout=LESSON_TTL)
            for uname in notify_usernames:
                cache.set(f'lesson_pending_invite_username:{uname}', invite_payload, timeout=LESSON_TTL)
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
                TeachersStudent.objects.filter(student_id=profile_id, group_id__isnull=False).values_list('group_id', flat=True)
            )
            group_ids += list(
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
                TeachersStudent.objects.filter(student__user_id=user_id, group_id__isnull=False).values_list('group_id', flat=True)
            )
            group_ids += list(
                TeachersGroup.objects.filter(student__user_id=user_id).values_list('group_id', flat=True)
            )
        group_ids = list(dict.fromkeys(group_ids))
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
                TeachersStudent.objects.filter(student_id=profile_id, group_id__isnull=False).values_list('group_id', flat=True)
            )
            group_ids += list(
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
                TeachersStudent.objects.filter(student__user_id=user_id, group_id__isnull=False).values_list('group_id', flat=True)
            )
            group_ids += list(
                TeachersGroup.objects.filter(student__user_id=user_id).values_list('group_id', flat=True)
            )
        group_ids = list(dict.fromkeys(group_ids))
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
            notify_user_ids = []
            if user_id:
                notify_user_ids.append(int(user_id))
            teacher_user_ids = [
                int(uid) for uid in set(
                    inv.teacher.user_id for inv in pending_rows if getattr(inv.teacher, 'user_id', None)
                )
            ]
            notify_user_ids.extend(teacher_user_ids)
            notify_user_ids = list(dict.fromkeys(notify_user_ids))
            if notify_user_ids:
                _ws_notify_users_payload(
                    notify_user_ids,
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
        if (student_user_id_raw is None or str(student_user_id_raw).strip() == '') and lesson_type == 'group':
            student_user_id_raw = payload.get('student_user_id')
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
        teacher_uid = payload.get('teacher_id')
        notify_user_ids, notify_profile_ids, notify_usernames = _lesson_jwt_recipients_for_ring_stop(
            lesson_type,
            target_id,
            teacher_uid=teacher_uid,
        )
        if notify_user_ids is None:
            notify_user_ids, notify_profile_ids, notify_usernames = [], [], []

        # Фолбэк для персонализированных токенов (группа): если состав группы изменился,
        # всё равно сохраняем отчёт хотя бы по ученику, чей user_id пришёл в токене/вебхуке.
        if not notify_profile_ids:
            student_user_id_raw = request.data.get('student_user_id')
            if student_user_id_raw is None or str(student_user_id_raw).strip() == '':
                student_user_id_raw = payload.get('student_user_id')
            if student_user_id_raw is not None and str(student_user_id_raw).strip() != '':
                try:
                    sp = UserProfile.objects.get(user_id=int(student_user_id_raw))
                    notify_profile_ids = [int(sp.id)]
                    notify_user_ids = [int(sp.user_id)] if sp.user_id else []
                    notify_usernames = list(dict.fromkeys([
                        str(getattr(sp, 'username', '') or '').strip(),
                        str(getattr(getattr(sp, 'user', None), 'username', '') or '').strip(),
                    ]))
                    notify_usernames = [u for u in notify_usernames if u]
                except Exception:
                    pass

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

        # После завершения обычного урока фиксируем запись в "Результаты учеников".
        if lesson_type in ('student', 'group') and payload.get('variant_id') is not None and notify_profile_ids:
            try:
                students = UserProfile.objects.filter(id__in=notify_profile_ids)
                for sp in students:
                    _upsert_lesson_report_by_token(token=token, payload=payload, student_profile=sp)
            except Exception:
                logger.exception('Не удалось сохранить lesson-report при teacher-left token=%s', token[:16])

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

        result = _coerce_homework_result_payload(request.data.get('result'))
        score = request.data.get('score')
        update_fields = []
        if result is not None:
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
            existing = obj.whiteboard_strokes if isinstance(obj.whiteboard_strokes, list) else []

            if is_teacher_owner:
                normalized = []
                for s in strokes:
                    if not isinstance(s, dict):
                        continue
                    item = dict(s)
                    item.setdefault('_author_role', 'teacher')
                    if item.get('_author_role') == 'teacher':
                        item['_author_profile_id'] = profile.pk
                    normalized.append(item)
                if len(normalized) > 800:
                    normalized = normalized[-800:]                 # ограничиваем хранение до 800 последних штрихов
                obj.whiteboard_strokes = normalized
            else:
                # Ученик не может перезаписывать/удалять учительские штрихи:
                # сохраняем teacher-слой и обновляем только его собственные.
                teacher_layer = []
                for s in existing:
                    if isinstance(s, dict) and s.get('_author_role') == 'teacher':
                        teacher_layer.append(dict(s))

                student_layer = []
                for s in strokes:
                    if not isinstance(s, dict):
                        continue
                    role = s.get('_author_role')
                    author_pid = s.get('_author_profile_id')
                    # Блокируем попытки ученика сохранить чужие student-штрихи или teacher-штрихи.
                    if role == 'teacher':
                        continue
                    if role == 'student' and author_pid not in (None, profile.pk):
                        continue
                    item = dict(s)
                    item['_author_role'] = 'student'
                    item['_author_profile_id'] = profile.pk
                    student_layer.append(item)

                merged = teacher_layer + student_layer
                if len(merged) > 800:
                    merged = merged[-800:]
                obj.whiteboard_strokes = merged
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

        result = _coerce_homework_result_payload(request.data.get('result'))  # JSON-результат выполнения варианта
        score  = request.data.get('score')                         # балл (опционально, может считаться автоматически)

        has_existing_result = isinstance(assignment.result, dict) and bool(assignment.result)
        has_any_files = assignment.answer_files.exists()
        if result is None and not has_existing_result and not has_any_files:
            return Response(
                {'error': 'Нельзя отправить пустую работу: заполните ответы или прикрепите файл.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        update_fields = ['status', 'submitted_at']                 # обязательные поля для обновления
        assignment.status       = 'submitted'                      # меняем статус на "сдано"
        assignment.submitted_at = timezone.now()                   # фиксируем время сдачи
        if result is not None:                                     # сохраняем результат (dict или JSON-строка)
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
      part2_scores: { "19": {"score": 3, "criterion_id": 42, "max_score": 3}, ... },  # только для reviewed
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
                        parsed_score = None
                        parsed_max_score = None
                        sc = tv.get('score')
                        if sc is not None:
                            try:
                                parsed_score = int(sc)
                                cell['teacher_score'] = parsed_score
                            except (TypeError, ValueError):
                                pass
                        cid = tv.get('criterion_id')
                        if cid is not None:
                            try:
                                cell['teacher_criterion_id'] = int(cid)
                            except (TypeError, ValueError):
                                pass
                        mx = tv.get('max_score')
                        if mx is not None:
                            try:
                                parsed_max_score = int(mx)
                                if parsed_max_score < 0:
                                    parsed_max_score = 0
                                cell['teacher_max_score'] = parsed_max_score
                            except (TypeError, ValueError):
                                pass
                        if parsed_score is not None:
                            max_for_state = parsed_max_score
                            if max_for_state is None:
                                old_max = cell.get('teacher_max_score')
                                if old_max is not None:
                                    try:
                                        max_for_state = int(old_max)
                                    except (TypeError, ValueError):
                                        max_for_state = None
                            if max_for_state is not None and max_for_state > 0 and parsed_score >= max_for_state:
                                cell['state'] = 'correct'
                            elif parsed_score <= 0:
                                cell['state'] = 'wrong'
                            else:
                                cell['state'] = 'partial'
                    else:
                        try:
                            parsed_score = int(tv)
                            cell['teacher_score'] = parsed_score
                            if parsed_score <= 0:
                                cell['state'] = 'wrong'
                            else:
                                cell['state'] = 'partial'
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
            try:
                _upsert_student_lesson_report(assignment)
            except Exception:
                logger.exception('Не удалось сформировать PDF-отчёт по assignment=%s', assignment.id)
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
            .select_related('homework_assignment', 'homework_assignment__homework')  # ДЗ для фильтра архива
            .order_by('-created_at')
        )
        # Не показывать оповещения по ДЗ для архивных связей (статус «Завершил обучение» в TeachersStudent).
        if profile.role == 'student':
            archived_teacher_ids = TeachersStudent.objects.filter(
                student=profile, status='3',
            ).values_list('teacher_id', flat=True)
            qs = qs.exclude(
                homework_assignment__isnull=False,
                homework_assignment__homework__teacher_id__in=archived_teacher_ids,
            )
        else:
            archived_student_ids = TeachersStudent.objects.filter(
                teacher=profile, status='3',
            ).values_list('student_id', flat=True)
            qs = qs.exclude(
                homework_assignment__isnull=False,
                homework_assignment__student_id__in=archived_student_ids,
            )
        qs = qs[:50]                                                 # последние 50 после фильтра
        return Response(NotificationSerializer(qs, many=True).data)


class NotificationReadView(APIView):
    """
    POST /api/notifications/<id>/read/
    Отметить уведомление прочитанным (теперь удаляет его).
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
        notif.delete()                                             # удаляем уведомление
        return Response({'ok': True})


class NotificationReadAllView(APIView):
    """
    POST /api/notifications/read-all/
    Отметить все уведомления прочитанными (теперь удаляет их).
    """
    permission_classes = [IsLKTeacher]

    def post(self, request):
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Профиль не найден'}, status=status.HTTP_400_BAD_REQUEST)
        Notification.objects.filter(user=profile).delete()         # массовое удаление всех уведомлений
        return Response({'ok': True})


class StudentLessonReportListView(APIView):
    """GET /api/student-reports/ — отчёты по ученикам текущего учителя."""
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        teacher = request.user.profile
        qs = StudentLessonReport.objects.select_related(
            'student', 'assignment', 'assignment__homework',
        ).filter(teacher=teacher).order_by('-generated_at')
        rows = []
        for r in qs:
            # Для прод-надёжности отдаём ссылку через Django-эндпоинт, а не прямой /media/... (Nginx может быть настроен не везде).
            file_url = request.build_absolute_uri(f'/api/student-reports/{r.id}/download/')
            report_kind = str(getattr(r, 'report_kind', '') or ('homework' if r.assignment_id else 'lesson'))
            report_kind_label = 'Урок' if report_kind == 'lesson' else 'ДЗ'
            rows.append({
                'id': r.id,
                'student_id': r.student_id,
                'student_name': r.student.name,
                'student_surname': r.student.surname,
                'assignment_id': r.assignment_id,
                'homework_id': (r.assignment.homework_id if r.assignment_id else None),
                'variant_id': r.variant_id,
                'title': r.title,
                'score': r.score,
                'status': r.status,
                'teacher_comment': r.teacher_comment or '',
                'report_kind': report_kind,
                'report_kind_label': report_kind_label,
                'report_filename': r.report_filename or '',
                'report_file_url': file_url,
                'generated_at': r.generated_at,
            })
        return Response(rows)


class StudentLessonReportDownloadView(APIView):
    """GET /api/student-reports/<id>/download/ — выдача PDF-отчёта по ученику текущего учителя."""
    permission_classes = [IsCabinetTeacher]

    def get(self, request, pk):
        teacher = request.user.profile
        try:
            report = StudentLessonReport.objects.select_related(
                'assignment', 'assignment__homework',
            ).get(pk=pk, teacher=teacher)
        except StudentLessonReport.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        # Автовосстановление: если запись есть, а файл исчез/недоступен в media, пробуем пересобрать из assignment.
        report_name = str(getattr(report.report_file, 'name', '') or '').strip()
        file_exists = bool(report_name and default_storage.exists(report_name))
        if not file_exists and report.assignment_id:
            try:
                _upsert_student_lesson_report(report.assignment)
                report.refresh_from_db()
                report_name = str(getattr(report.report_file, 'name', '') or '').strip()
                file_exists = bool(report_name and default_storage.exists(report_name))
            except Exception:
                logger.exception('Не удалось пересобрать PDF-отчёт report_id=%s assignment_id=%s', report.id, report.assignment_id)
        elif not file_exists and report.report_kind == 'lesson' and report.variant_id:
            try:
                pdf_content = _fetch_variant_pdf_content(report.variant_id)
                if pdf_content:
                    student_slug = slugify(f'{report.student.name}-{report.student.surname}') or f'student-{report.student_id}'
                    token_hash = hashlib.sha1(str(report.lesson_token or report.id).encode('utf-8')).hexdigest()[:10]
                    file_name = f'lesson-report-{report.variant_id}-{student_slug}-{token_hash}.pdf'
                    report.report_file.save(file_name, ContentFile(pdf_content), save=False)
                    report.report_filename = file_name
                    report.save(update_fields=['report_file', 'report_filename', 'generated_at'])
                    report.refresh_from_db()
                    report_name = str(getattr(report.report_file, 'name', '') or '').strip()
                    file_exists = bool(report_name and default_storage.exists(report_name))
            except Exception:
                logger.exception('Не удалось пересобрать lesson PDF report_id=%s variant_id=%s', report.id, report.variant_id)

        if not file_exists:
            return Response({'error': 'PDF отчёт пока недоступен. Сформируйте отчёт повторно.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            fh = default_storage.open(report_name, mode='rb')
        except Exception:
            logger.exception('Не удалось открыть PDF-отчёт report_id=%s file=%s', report.id, report_name)
            return Response({'error': 'Не удалось открыть файл отчёта'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        out_name = (report.report_filename or os.path.basename(report_name) or f'report-{report.id}.pdf').strip()
        return FileResponse(fh, content_type='application/pdf', filename=out_name)


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


from rest_framework.decorators import (
    api_view,
    permission_classes as drf_permission_classes,
    authentication_classes as drf_authentication_classes,
)


class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return


@api_view(['POST'])
@drf_permission_classes([IsCabinetTeacher])
@drf_authentication_classes([CsrfExemptSessionAuthentication])
def save_teacher_variant(request):
    """
    POST /api/variants/save/
    Body: { level, subject, task_ids: number[], tasks?: [{ task_id, task_number? }], title? }
    Создаёт вариант в генераторе и сохраняет связку variant_id↔учитель в БД кабинета.
    """
    level = str(request.data.get('level') or '').strip()
    subject = str(request.data.get('subject') or '').strip()
    task_ids = request.data.get('task_ids') or []
    tasks = request.data.get('tasks') or []
    title = str(request.data.get('title') or '').strip()

    if not level or not subject:
        return Response({'error': 'level и subject обязательны'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        allowed_subjects = _teacher_allowed_generator_subject_shorts(request)
    except requests.exceptions.RequestException as e:
        return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)
    if subject not in allowed_subjects:
        logger.warning(
            'Subject guard bypassed in save_teacher_variant: user_id=%s subject=%s allowed=%s',
            getattr(request.user, 'id', None),
            subject,
            sorted(allowed_subjects),
        )
    if not isinstance(task_ids, list):
        return Response({'error': 'task_ids должен быть массивом'}, status=status.HTTP_400_BAD_REQUEST)
    if tasks and not isinstance(tasks, list):
        return Response({'error': 'tasks должен быть массивом'}, status=status.HTTP_400_BAD_REQUEST)
    if not task_ids and not tasks:
        return Response({'error': 'task_ids должен быть непустым массивом'}, status=status.HTTP_400_BAD_REQUEST)
    task_pairs = []
    if tasks:
        for item in tasks:
            if not isinstance(item, dict):
                return Response({'error': 'tasks должен содержать объекты {task_id, task_number?}'}, status=status.HTTP_400_BAD_REQUEST)
            raw_id = item.get('task_id', item.get('id'))
            try:
                task_id_int = int(raw_id)
            except (TypeError, ValueError):
                return Response({'error': 'tasks[].task_id должен быть числом'}, status=status.HTTP_400_BAD_REQUEST)
            task_number_raw = item.get('task_number')
            if task_number_raw is None or str(task_number_raw).strip() == '':
                task_number_int = None
            else:
                try:
                    task_number_int = int(task_number_raw)
                except (TypeError, ValueError):
                    return Response({'error': 'tasks[].task_number должен быть числом'}, status=status.HTTP_400_BAD_REQUEST)
            task_pairs.append({'task_id': task_id_int, 'task_number': task_number_int})
        task_ids_int = [row['task_id'] for row in task_pairs]
    else:
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
        gen_payload = {'task_ids': task_ids_int}
        if task_pairs:
            # Передаём исходные номера заданий отдельным полем для генератора (если поддерживается),
            # при этом task_ids остаётся обязательным для обратной совместимости.
            gen_payload['tasks'] = task_pairs
        gen_resp = requests.post(
            create_url,
            json=gen_payload,
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


def _normalize_subject_key(value):
    s = str(value or '').strip().lower().replace('ё', 'е')
    return re.sub(r'[^a-z0-9а-я]+', '', s)


def _teacher_subject_name_keys(request):
    try:
        teacher = request.user.profile
    except Exception:
        return set()
    names = TeacherSubject.objects.filter(teacher=teacher).values_list('subject__subject_name', flat=True)
    return {_normalize_subject_key(n) for n in names if str(n or '').strip()}


def _teacher_allowed_generator_subject_shorts(request, catalog_data=None):
    teacher_subject_keys = _teacher_subject_name_keys(request)

    payload = catalog_data
    if payload is None:
        last_err = None
        for require_secret in (False, True):
            try:
                payload = _gen_proxy('api/catalog/', require_secret=require_secret)
                break
            except requests.exceptions.RequestException as e:
                last_err = e
        if payload is None:
            raise last_err or requests.exceptions.RequestException('Не удалось загрузить каталог генератора')

    catalog_rows = payload.get('catalog') if isinstance(payload, dict) else []
    all_subject_shorts = set()
    for level_row in catalog_rows if isinstance(catalog_rows, list) else []:
        subjects = level_row.get('subjects') if isinstance(level_row, dict) else []
        for subj in subjects if isinstance(subjects, list) else []:
            if not isinstance(subj, dict):
                continue
            short = str(subj.get('subject_short') or '').strip()
            if short:
                all_subject_shorts.add(short)

    # Не блокируем legacy-учителей в проде, у которых предметы ещё не сопоставлены.
    if not teacher_subject_keys:
        return all_subject_shorts

    allowed = set()
    for level_row in catalog_rows if isinstance(catalog_rows, list) else []:
        subjects = level_row.get('subjects') if isinstance(level_row, dict) else []
        for subj in subjects if isinstance(subjects, list) else []:
            if not isinstance(subj, dict):
                continue
            short = str(subj.get('subject_short') or '').strip()
            name_key = _normalize_subject_key(subj.get('subject_name'))
            if short and name_key and name_key in teacher_subject_keys:
                allowed.add(short)

    # Если привязки есть, но не сматчились с каталогом генератора, временно не режем доступ.
    # Иначе на проде ломаются генерация и сохранение варианта.
    if not allowed and all_subject_shorts:
        logger.warning(
            'Teacher subject mapping mismatch for user_id=%s, fallback to full generator catalog',
            getattr(request.user, 'id', None),
        )
        return all_subject_shorts

    return allowed


def _teacher_subject_forbidden_response():
    return Response({'error': 'Этот предмет недоступен для вашего профиля преподавателя'}, status=status.HTTP_403_FORBIDDEN)


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


@api_view(['POST'])
@drf_permission_classes([IsCabinetTeacher])
@drf_authentication_classes([CsrfExemptSessionAuthentication])
def gen_generate_variant(request):
    """
    POST /api/gen/variant/
    Body: { level, subject, ...payload }
    Проксирует генерацию варианта через backend, чтобы не было CORS/SSL проблем на фронте.
    """
    level = str(request.data.get('level') or '').strip()
    subject = str(request.data.get('subject') or '').strip()
    if not level or not subject:
        return Response({'error': 'level и subject обязательны'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        allowed_subjects = _teacher_allowed_generator_subject_shorts(request)
    except requests.exceptions.RequestException as e:
        return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)
    if subject not in allowed_subjects:
        logger.warning(
            'Subject guard bypassed in gen_generate_variant: user_id=%s subject=%s allowed=%s',
            getattr(request.user, 'id', None),
            subject,
            sorted(allowed_subjects),
        )

    payload = dict(request.data)
    payload.pop('level', None)
    payload.pop('subject', None)
    if not payload:
        payload = {'content': {}}

    url = _build_generator_url(f'api/{level}/{subject}/variant/')
    try:
        resp = requests.post(
            url,
            json=payload,
            headers={'Accept': 'application/json'},
            verify=False,
            timeout=25,
            allow_redirects=True,
        )
        ct = (resp.headers.get('Content-Type') or '').lower()
        if resp.status_code >= 400:
            msg = ''
            if 'json' in ct:
                try:
                    msg = (resp.json() or {}).get('error', '')
                except Exception:
                    msg = ''
            return Response(
                {'error': msg or f'Ошибка генератора ({resp.status_code})'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        data = resp.json() if 'json' in ct else {}
        if not isinstance(data, dict):
            data = {}
        if not data.get('variant_id'):
            return Response({'error': 'Генератор не вернул variant_id'}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(data)
    except requests.exceptions.RequestException as e:
        return Response({'error': f'Генератор недоступен: {e}'}, status=status.HTTP_502_BAD_GATEWAY)


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
            allowed_subjects = _teacher_allowed_generator_subject_shorts(request, catalog_data=data)
            catalog_rows = data.get('catalog') if isinstance(data, dict) else []
            filtered_catalog = []
            for level_row in catalog_rows if isinstance(catalog_rows, list) else []:
                if not isinstance(level_row, dict):
                    continue
                subjects = level_row.get('subjects')
                if not isinstance(subjects, list):
                    continue
                filtered_subjects = [
                    s for s in subjects
                    if isinstance(s, dict) and str(s.get('subject_short') or '').strip() in allowed_subjects
                ]
                if filtered_subjects:
                    row_copy = dict(level_row)
                    row_copy['subjects'] = filtered_subjects
                    filtered_catalog.append(row_copy)
            payload = dict(data) if isinstance(data, dict) else {}
            payload['catalog'] = filtered_catalog
            return Response(payload)
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
