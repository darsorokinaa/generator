from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.contrib import messages
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_date
import os
import random
import string
import time
import re
import json
import urllib.request
import urllib.error
import jwt
from .models import (
    UserProfile,
    FunnyWord,
    Subject,
    Level,
    TeacherSubject,
    TeachersStudent,
    TeachersGroup,
    Group,
    Homework,
    HomeworkAttachment,
    HomeworkAssignment,
    HomeworkAnswerFile,
    HomeworkTeacherFeedbackFile,
    Notification,
)
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from .permissions import IsLKTeacher, IsCabinetTeacher, user_can_use_lk
from .security_utils import safe_redirect_target
from .serializers import (
    UserProfileSerializer, SubjectSerializer,
    LevelSerializer, TeachersStudentSerializer, GroupSerializer,
    HomeworkSerializer, HomeworkAttachmentSerializer,
    HomeworkAssignmentSerializer, HomeworkAssignmentDetailSerializer,
    HomeworkAnswerFileSerializer,
    HomeworkTeacherFeedbackFileSerializer,
    NotificationSerializer,
)
from .serializers_input import (
    StudentCreateSerializer,
    GroupCreateSerializer,
    LessonTokenSerializer,
)


FRONTEND_URL = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
GENUROK_URL = getattr(settings, 'GENUROK_URL', 'https://genurok.tw1.ru')
LESSON_SECRET  = getattr(settings, 'LESSON_SECRET',  settings.SECRET_KEY)
LESSON_TTL     = 60 * 60 * 2  # токен живёт 2 часа

# Кэш: в БД есть колонки миграции 0016 (task_teacher_comments, whiteboard_strokes).
_HOMEWORK_ASSIGNMENT_META_COLUMNS_READY = None


def _homework_assignment_meta_columns_ready():
    """
    Без этих колонок ORM делает SELECT … task_teacher_comments … и падает на проде до migrate.
    """
    global _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY
    if _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY is not None:
        return _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY
    try:
        from django.db import connection

        table = HomeworkAssignment._meta.db_table
        with connection.cursor() as cursor:
            desc = connection.introspection.get_table_description(cursor, table)
        names = {row.name for row in desc}
        _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY = (
            'task_teacher_comments' in names and 'whiteboard_strokes' in names
        )
    except Exception:
        _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY = True
    return _HOMEWORK_ASSIGNMENT_META_COLUMNS_READY


def homework_assignment_select_qs():
    """Менеджер: при отсутствии колонок 0016 — defer, чтобы SELECT не ломался."""
    if _homework_assignment_meta_columns_ready():
        return HomeworkAssignment.objects
    return HomeworkAssignment.objects.defer('task_teacher_comments', 'whiteboard_strokes')


def _make_jitsi_jwt(name: str, room: str, is_moderator: bool, app_id: str, secret: str, hostname: str) -> str:
    """
    Генерирует Jitsi JWT для своего сервера.
    is_moderator=True → учитель становится организатором без входа в Jitsi.
    Формат токена соответствует стандарту Jitsi Meet (prosody token_verification).
    """
    payload = {
        "context": {
            "user": {
                "name": name,
                "moderator": is_moderator,
            }
        },
        "aud": "jitsi",
        "iss": app_id,
        "sub": hostname,
        "room": room,
        "exp": int(time.time()) + LESSON_TTL,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def generate_username():
    """Случайное слово + 4 цифры, гарантированно уникальное."""
    words = list(FunnyWord.objects.values_list('word', flat=True))
    if not words:
        words = ['учитель']
    for _ in range(20):
        username = f"{random.choice(words)}_{random.randint(1000, 9999)}"
        if not User.objects.filter(username=username).exists():
            return username
    return f"user_{random.randint(100000, 999999)}"


def get_user_by_login(login_str):
    """Ищет пользователя по логину или email."""
    user = User.objects.filter(username=login_str).first()
    if user is None and '@' in login_str:
        user = User.objects.filter(email=login_str).first()
    return user


def _dashboard_url(request):
    """
    URL дашборда (React SPA).
    В проде SPA отдаётся Django с path /app/; отдельный CRA — http://localhost:3000.
    """
    fe = (FRONTEND_URL or '').rstrip('/')
    if fe and (':3000' in fe or fe.rstrip('/').endswith('3000')):
        return fe
    return request.build_absolute_uri('/app/')


def _login_rate_limit_key(request):
    return f'cabinet:login_fail:{request.META.get("REMOTE_ADDR", "unknown")}'


def login_view(request):
    if request.user.is_authenticated:
        if user_can_use_lk(request.user):
            return redirect(_dashboard_url(request))
        return redirect('/admin/')

    if request.method == 'POST':
        rl_key = _login_rate_limit_key(request)
        if cache.get(rl_key, 0) >= 25:
            messages.error(
                request,
                'Слишком много неудачных попыток входа с этого адреса. Подождите около 15 минут.',
            )
            return render(request, 'login.html')

        login_str = (request.POST.get('username') or '').strip()[:254]
        password  = (request.POST.get('password') or '')[:128]

        user_obj = get_user_by_login(login_str)
        user = authenticate(request, username=user_obj.username, password=password) if user_obj else None

        if user is not None:
            if not user_can_use_lk(user):
                messages.error(
                    request,
                    'Эта учётная запись только для админ-панели (/admin/). '
                    'В личный кабинет учителя входите под отдельным логином (регистрация в кабинете).',
                )
            else:
                cache.delete(rl_key)
                login(request, user)
                next_raw = request.GET.get('next')
                safe = safe_redirect_target(next_raw, request) if next_raw else None
                return redirect(safe or _dashboard_url(request))
        else:
            try:
                cache.incr(rl_key)
            except ValueError:
                cache.set(rl_key, 1, timeout=900)
            messages.error(request, 'Неверный логин / email или пароль')

    return render(request, 'login.html')


def register_view(request):
    if request.user.is_authenticated:
        if user_can_use_lk(request.user):
            return redirect(_dashboard_url(request))
        return redirect('/admin/')

    subjects = Subject.objects.all().order_by('subject_name')

    if request.method == 'POST':
        name        = (request.POST.get('name') or '').strip()[:100]
        surname     = (request.POST.get('surname') or '').strip()[:100]
        email       = (request.POST.get('email') or '').strip()[:254]
        password1   = (request.POST.get('password1') or '')[:128]
        password2   = (request.POST.get('password2') or '')[:128]
        subject_ids = request.POST.getlist('subjects')

        try:
            subj_ints = [int(x) for x in subject_ids]
        except (TypeError, ValueError):
            messages.error(request, 'Некорректный выбор предметов')
            return render(request, 'register.html', {'subjects': subjects})

        if not all([name, surname, email, password1]):
            messages.error(request, 'Заполните все обязательные поля')
        elif not subj_ints:
            messages.error(request, 'Выберите хотя бы один предмет')
        elif password1 != password2:
            messages.error(request, 'Пароли не совпадают')
        elif len(password1) < 8:
            messages.error(request, 'Пароль должен быть не менее 8 символов')
        elif email and User.objects.filter(email=email).exists():
            messages.error(request, 'Email уже используется')
        else:
            try:
                validate_password(password1, user=User(email=email, username=email[:30]))
            except ValidationError as e:
                for err in e.messages:
                    messages.error(request, err)
                return render(request, 'register.html', {'subjects': subjects})

            valid_subject_ids = set(Subject.objects.filter(id__in=subj_ints).values_list('id', flat=True))
            if valid_subject_ids != set(subj_ints):
                messages.error(request, 'Выбран неизвестный предмет')
                return render(request, 'register.html', {'subjects': subjects})
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
                role='teacher',
            )
            selected = Subject.objects.filter(id__in=subj_ints)
            TeacherSubject.objects.bulk_create([
                TeacherSubject(teacher=profile, subject=s) for s in selected
            ])
            login(request, user)
            return render(request, 'register_success.html', {'username': username})

    return render(request, 'register.html', {'subjects': subjects})


def logout_view(request):
    logout(request)
    return redirect(settings.LOGOUT_REDIRECT_URL)


def settings_view(request):
    if request.user.is_authenticated and not user_can_use_lk(request.user):
        return redirect('/admin/')
    return render(request, 'settings.html')


# ── REST API ──────────────────────────────────────────────────────────────────

class UserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Только чтение собственного профиля (без массового CRUD по чужим записям)."""

    permission_classes = [IsCabinetTeacher]
    serializer_class = UserProfileSerializer

    def get_queryset(self):
        return UserProfile.objects.filter(user_id=self.request.user.id)


class SubjectListView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        try:
            teacher_profile = request.user.profile
            # Только предметы которые ведёт этот учитель
            subject_ids = TeacherSubject.objects.filter(
                teacher=teacher_profile
            ).values_list('subject_id', flat=True)
            subjects = Subject.objects.filter(id__in=subject_ids).order_by('subject_name')
        except Exception:
            # Fallback — все предметы если профиля нет
            subjects = Subject.objects.all().order_by('subject_name')
        return Response(SubjectSerializer(subjects, many=True).data)


class LevelListView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        levels = Level.objects.all()
        return Response(LevelSerializer(levels, many=True).data)


class StudentsView(APIView):
    permission_classes = [IsCabinetTeacher]

    def _get_teacher_profile(self, request):
        try:
            return request.user.profile
        except Exception:
            # Создаём профиль на лету (например, для суперпользователя)
            return UserProfile.objects.create(
                user=request.user,
                username=request.user.username,
                name=request.user.first_name or request.user.username,
                surname=request.user.last_name or '',
                email=request.user.email or '',
                role='teacher',
            )

    def get(self, request):
        teacher_profile = self._get_teacher_profile(request)
        qs = TeachersStudent.objects.filter(teacher=teacher_profile).select_related(
            'student', 'subject', 'level', 'group'
        )
        return Response(TeachersStudentSerializer(qs, many=True).data)

    def post(self, request):
        """Создаёт ученика (UserProfile) и связь с учителем (TeachersStudent)."""
        ser = StudentCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response({'error': ser.errors}, status=status.HTTP_400_BAD_REQUEST)

        vd = ser.validated_data
        name = vd['name']
        surname = vd['surname']
        email = vd['email']
        phone = vd['phone']
        subject_id = vd['subject']
        level_id = vd['level']
        grade = vd['grade']
        goal = vd['goal']
        st_status = vd['status']
        lesson_type = vd['lesson_type']
        group_id = vd.get('group')
        gender = vd['gender']
        birth_date = vd.get('birth_date')

        teacher_profile = self._get_teacher_profile(request)

        try:
            subject = Subject.objects.get(id=subject_id)
            level   = Level.objects.get(id=level_id)
        except (Subject.DoesNotExist, Level.DoesNotExist):
            return Response({'error': 'Предмет или уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)

        group = None
        if lesson_type == 'group' and group_id:
            try:
                group = Group.objects.get(id=group_id, teacher=teacher_profile)
            except Group.DoesNotExist:
                return Response({'error': 'Группа не найдена'}, status=status.HTTP_400_BAD_REQUEST)

        username = generate_username()
        password = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
        user = User.objects.create_user(
            username=username,
            email=email or f"{username}@noemail.local",
            password=password,
            first_name=name,
            last_name=surname,
        )
        student_profile = UserProfile.objects.create(
            user=user,
            username=username,
            name=name,
            surname=surname,
            email=email or '',
            phone=phone or None,
            gender=gender,
            birth_date=birth_date,
            role='student',
        )

        ts = TeachersStudent.objects.create(
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
        data = TeachersStudentSerializer(ts).data
        data['credentials'] = {'login': username, 'password': password, 'gender': gender}
        return Response(data, status=status.HTTP_201_CREATED)


class StudentDetailView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        """Сброс пароля ученика: POST { \"action\": \"reset_password\" }"""
        if request.data.get('action') != 'reset_password':
            return Response(
                {'error': 'Укажите action: reset_password'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        teacher_profile = self._get_teacher_profile(request)
        try:
            ts = TeachersStudent.objects.select_related('student__user').get(
                pk=pk, teacher=teacher_profile
            )
        except TeachersStudent.DoesNotExist:
            return Response({'error': 'Ученик не найден'}, status=status.HTTP_404_NOT_FOUND)

        student_user = ts.student.user
        if not student_user:
            return Response({'error': 'У ученика нет учётной записи'}, status=status.HTTP_400_BAD_REQUEST)

        new_password = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
        student_user.set_password(new_password)
        student_user.save(update_fields=['password'])

        return Response({
            'login': ts.student.username,
            'password': new_password,
        })

    def patch(self, request, pk):
        """
        PATCH полей ученика и связи TeachersStudent.
        Профиль: student_name, student_surname, student_email, student_phone, gender, birth_date
        Обучение: subject, level, grade, goal, status
        Группа: group_id (null — без группы) или lesson_type individual/group
        """
        teacher_profile = self._get_teacher_profile(request)
        try:
            ts = TeachersStudent.objects.select_related(
                'student', 'student__user', 'group', 'subject', 'level',
            ).get(pk=pk, teacher=teacher_profile)
        except TeachersStudent.DoesNotExist:
            return Response({'error': 'Ученик не найден'}, status=status.HTTP_404_NOT_FOUND)

        profile = ts.student
        user = profile.user
        data = request.data

        profile_field_keys = {
            'student_name', 'student_surname', 'student_email', 'student_phone',
            'gender', 'birth_date',
        }
        if profile_field_keys & data.keys():
            if 'student_name' in data:
                profile.name = str(data.get('student_name') or '')[:100]
            if 'student_surname' in data:
                profile.surname = str(data.get('student_surname') or '')[:100]
            if 'student_email' in data:
                em = str(data.get('student_email') or '').strip()[:254]
                if em:
                    profile.email = em
                    if user:
                        user.email = em
            if 'student_phone' in data:
                ph = data.get('student_phone')
                profile.phone = (str(ph).strip() if ph else '') or None
            if 'gender' in data:
                g = data.get('gender')
                if g in ('female', 'male', 'other'):
                    profile.gender = g
            if 'birth_date' in data:
                bd = data.get('birth_date')
                if bd in (None, '', 'null'):
                    profile.birth_date = None
                elif isinstance(bd, str):
                    parsed = parse_date(bd[:10])
                    if parsed is None:
                        return Response({'error': 'Неверная дата рождения'}, status=status.HTTP_400_BAD_REQUEST)
                    profile.birth_date = parsed
                else:
                    profile.birth_date = bd

            profile.save()

            if user and any(k in data for k in ('student_name', 'student_surname', 'student_email')):
                user.first_name = (profile.name or '')[:150]
                user.last_name = (profile.surname or '')[:150]
                user.save(update_fields=['first_name', 'last_name', 'email'])

        ts_fields = []

        if 'subject' in data:
            try:
                ts.subject = Subject.objects.get(id=int(data['subject']))
                ts_fields.append('subject')
            except (Subject.DoesNotExist, ValueError, TypeError):
                return Response({'error': 'Предмет не найден'}, status=status.HTTP_400_BAD_REQUEST)
        if 'level' in data:
            try:
                ts.level = Level.objects.get(id=int(data['level']))
                ts_fields.append('level')
            except (Level.DoesNotExist, ValueError, TypeError):
                return Response({'error': 'Уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)
        if 'grade' in data:
            g = str(data['grade'])
            valid_g = {c[0] for c in TeachersStudent.GRADE_CHOICES}
            if g not in valid_g:
                return Response({'error': 'Неверный класс'}, status=status.HTTP_400_BAD_REQUEST)
            ts.grade = g
            ts_fields.append('grade')
        if 'goal' in data:
            raw = data.get('goal')
            ts.goal = (str(raw)[:200] if raw else '') or None
            ts_fields.append('goal')
        if 'status' in data:
            st = str(data['status'])
            valid_s = {c[0] for c in TeachersStudent.STUDENTS_STATUS_CHOICES}
            if st not in valid_s:
                return Response({'error': 'Неверный статус'}, status=status.HTTP_400_BAD_REQUEST)
            ts.status = st
            ts_fields.append('status')

        if 'group_id' in data:
            group_id = data.get('group_id')
            if group_id:
                try:
                    group = Group.objects.get(id=int(group_id), teacher=teacher_profile)
                except (Group.DoesNotExist, ValueError, TypeError):
                    return Response({'error': 'Группа не найдена'}, status=status.HTTP_404_NOT_FOUND)
                ts.group = group
                ts.lesson_type = 'group'
            else:
                ts.group = None
                ts.lesson_type = 'individual'
            ts_fields.extend(['group', 'lesson_type'])
        elif 'lesson_type' in data:
            lt = str(data.get('lesson_type') or '')
            if lt == 'individual':
                ts.group = None
                ts.lesson_type = 'individual'
                ts_fields.extend(['group', 'lesson_type'])
            elif lt == 'group' and ts.group_id:
                ts.lesson_type = 'group'
                ts_fields.append('lesson_type')

        if ts_fields:
            ts.save(update_fields=list(dict.fromkeys(ts_fields)))

        ts.refresh_from_db()
        return Response(
            TeachersStudentSerializer(
                TeachersStudent.objects.select_related(
                    'student', 'subject', 'level', 'group',
                ).get(pk=ts.pk),
            ).data,
        )

    def delete(self, request, pk):
        teacher_profile = self._get_teacher_profile(request)
        try:
            ts = TeachersStudent.objects.get(pk=pk, teacher=teacher_profile)
        except TeachersStudent.DoesNotExist:
            return Response({'error': 'Ученик не найден'}, status=status.HTTP_404_NOT_FOUND)
        ts.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _get_teacher_profile(self, request):
        try:
            return request.user.profile
        except Exception:
            return UserProfile.objects.get_or_create(
                user=request.user,
                defaults={
                    'username': request.user.username,
                    'name': request.user.first_name or request.user.username,
                    'surname': request.user.last_name or '',
                    'email': request.user.email or '',
                    'role': 'teacher',
                }
            )[0]


class MeProfile(APIView):
    permission_classes = [IsLKTeacher]

    def get(self, request):
        try:
            profile = request.user.profile
            subject_names = list(
                TeacherSubject.objects.filter(teacher=profile)
                .values_list('subject__subject_name', flat=True)
            )
        except Exception:
            return Response({
                'username': request.user.username,
                'name': request.user.first_name or request.user.username,
                'surname': request.user.last_name or '',
                'email': request.user.email or '',
                'role': 'teacher',
                'subjects': [],
            })
        if profile.role == 'student':
            return Response({
                'username': profile.username,
                'name': profile.name,
                'surname': profile.surname,
                'email': profile.email,
                'role': profile.role,
                'subjects': [],
            })
        return Response({
            'username': profile.username,
            'name': profile.name,
            'surname': profile.surname,
            'email': profile.email,
            'role': profile.role,
            'subjects': subject_names,
        })


class GroupView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        teacher_profile = self._teacher(request)
        groups = Group.objects.filter(teacher=teacher_profile).select_related('subject', 'level')
        return Response(GroupSerializer(groups, many=True).data)

    def post(self, request):
        ser = GroupCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response({'error': ser.errors}, status=status.HTTP_400_BAD_REQUEST)
        vd = ser.validated_data
        group_name = vd['group_name']
        try:
            subj  = Subject.objects.get(id=vd['subject'])
            level = Level.objects.get(id=vd['level'])
        except (Subject.DoesNotExist, Level.DoesNotExist):
            return Response({'error': 'Предмет или уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)
        teacher_profile = self._teacher(request)
        group = Group.objects.create(
            group_name=group_name,
            teacher=teacher_profile,
            subject=subj,
            level=level,
        )
        return Response(GroupSerializer(group).data, status=status.HTTP_201_CREATED)

    def _teacher(self, request):
        try:
            return request.user.profile
        except Exception:
            return UserProfile.objects.create(
                user=request.user,
                username=request.user.username,
                name=request.user.first_name or request.user.username,
                surname=request.user.last_name or '',
                email=request.user.email or '',
                role='teacher',
            )


class LessonTokenView(APIView):
    """
    POST /api/lesson/token/
    Тело: { room_id, type: 'student'|'group', target_id, target_name }
    Ответ: { url, token, expires_in }
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        ser = LessonTokenSerializer(data=request.data)
        if not ser.is_valid():
            return Response({'error': ser.errors}, status=status.HTTP_400_BAD_REQUEST)
        vd = ser.validated_data
        room_id     = vd['room_id']
        lesson_type = vd['type']
        target_id   = vd['target_id']
        target_name = vd['target_name']

        try:
            profile = request.user.profile
            teacher_name = f'{profile.name} {profile.surname}'.strip()
        except Exception:
            return Response(
                {'error': 'Профиль учителя не найден'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if lesson_type == 'student':
            if not TeachersStudent.objects.filter(
                id=target_id,
                teacher=profile,
                lesson_type='individual',
            ).exists():
                return Response({'error': 'Ученик не найден'}, status=status.HTTP_404_NOT_FOUND)
        else:
            if not Group.objects.filter(id=target_id, teacher=profile).exists():
                return Response({'error': 'Группа не найдена'}, status=status.HTTP_404_NOT_FOUND)

        from django.conf import settings as dj_settings
        import urllib.parse
        from urllib.parse import urlparse as _urlparse

        genurok_url = GENUROK_URL.rstrip('/')

        now = int(time.time())
        # Jitsi: одна комната на урок, разные ссылки только по display name.
        jitsi_base = getattr(dj_settings, 'JITSI_BASE_URL', 'https://meet.jit.si').rstrip('/')
        room_slug = re.sub(r'[^A-Za-z0-9_-]+', '-', room_id).strip('-') or f"lesson-{now}"
        room_path = urllib.parse.quote(room_slug, safe='-_')

        # JWT-аутентификация для своего сервера Jitsi
        jitsi_app_id     = getattr(dj_settings, 'JITSI_APP_ID', '').strip()
        jitsi_jwt_secret = getattr(dj_settings, 'JITSI_JWT_SECRET', '').strip()
        jitsi_hostname   = _urlparse(jitsi_base).hostname or 'meet.jit.si'

        use_jitsi_jwt = bool(jitsi_app_id and jitsi_jwt_secret)

        if use_jitsi_jwt:
            # Токен учителя: moderator=True → Jitsi выдаёт роль организатора автоматически
            teacher_jitsi_tok = _make_jitsi_jwt(
                teacher_name, room_slug, True, jitsi_app_id, jitsi_jwt_secret, jitsi_hostname
            )
            # Токен ученика: moderator=False → обычный участник
            student_jitsi_tok = _make_jitsi_jwt(
                target_name, room_slug, False, jitsi_app_id, jitsi_jwt_secret, jitsi_hostname
            )
            teacher_video_url = f"{jitsi_base}/{room_path}?jwt={teacher_jitsi_tok}"
            student_video_url = f"{jitsi_base}/{room_path}?jwt={student_jitsi_tok}"
        else:
            # Fallback: meet.jit.si без JWT — только отображаемое имя
            teacher_jitsi_tok = ''
            student_jitsi_tok = ''

            def jitsi_url(display_name):
                safe_display = urllib.parse.quote((display_name or '').strip() or 'Участник', safe='')
                return (
                    f"{jitsi_base}/{room_path}"
                    f"#userInfo.displayName=%22{safe_display}%22"
                    f"&config.prejoinPageEnabled=false"
                    f"&config.prejoinConfig.enabled=false"
                )

            teacher_video_url = jitsi_url(teacher_name)
            student_video_url = jitsi_url(target_name)

        payload = {
            'iss':               'cabinet',
            'iat':               now,
            'exp':               now + LESSON_TTL,
            'room_id':           room_id,
            'teacher_id':        request.user.id,
            'teacher':           teacher_name,
            'lesson_format':     lesson_type,   # 'student'/'group' — тип занятия, НЕ роль
            'target_id':         target_id,
            'target_name':       target_name,
            # Видеозвонок через Jitsi (role-specific URL + room для совместимости).
            'jitsi_room':         room_slug,
            'teacher_jitsi_room': room_slug,
            'student_jitsi_room': room_slug,
            'video_url':          teacher_video_url,   # legacy поле
            'teacher_video_url':  teacher_video_url,
            'student_video_url':  student_video_url,
            # Jitsi JWT-токены (для своего сервера). Генератор добавляет ?jwt= к URL если не задан.
            'jitsi_jwt':         teacher_jitsi_tok,
            'student_jitsi_jwt': student_jitsi_tok,
        }

        token       = jwt.encode(payload, LESSON_SECRET, algorithm='HS256')
        teacher_url = f'{genurok_url}/lesson/join/?token={token}&role=teacher'
        student_url = f'{genurok_url}/lesson/join/?token={token}&role=student'

        return Response({
            'url':         teacher_url,
            'student_url': student_url,
            'token':       token,
            'expires_in':  LESSON_TTL,
        })


class LessonTeacherJoinedView(APIView):
    """
    POST /api/lesson/teacher-joined/
    Тело: { token }
    Вызывается Генератором, когда учитель реально открыл /lesson/join/?...&role=teacher.
    """
    authentication_classes = []
    permission_classes = []
    throttle_classes = []  # вызовы от генератора; лимит — секрет вебхука + проверка JWT

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

        room_id = str(payload.get('room_id') or '').strip()
        target_id = payload.get('target_id')
        teacher_uid = payload.get('teacher_id')
        teacher_name = str(payload.get('teacher') or '').strip() or 'Учитель'
        target_name = str(payload.get('target_name') or '').strip() or 'Ученик'
        lesson_type = str(payload.get('lesson_format') or payload.get('type') or 'student').strip() or 'student'
        genurok_url = GENUROK_URL.rstrip('/')
        student_url = f'{genurok_url}/lesson/join/?token={token}&role=student'

        # Дедупликация отмечается флагом, но не блокирует обновление pending invite.
        already_sent = False
        if room_id:
            cache_key = f'lesson_invite_sent:{room_id}'
            already_sent = not cache.add(cache_key, 1, timeout=LESSON_TTL)

        invite_payload = {
            "event": "incoming_lesson",
            "teacher": teacher_name,
            "target_name": target_name,
            "lesson_type": lesson_type,
            "student_url": student_url,
        }

        # Список Django user_id учеников для WS + pending (индивидуально или вся группа)
        notify_user_ids: list[int] = []
        if target_id is not None and lesson_type == 'student':
            try:
                ts = TeachersStudent.objects.select_related(
                    'student__user', 'teacher__user'
                ).get(pk=target_id)
            except TeachersStudent.DoesNotExist:
                ts = None
            if ts:
                if teacher_uid is not None and int(teacher_uid) != ts.teacher.user_id:
                    return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
                if ts.student and ts.student.user_id:
                    notify_user_ids.append(int(ts.student.user_id))
        elif target_id is not None and lesson_type == 'group':
            try:
                grp = Group.objects.select_related('teacher', 'teacher__user').get(pk=target_id)
            except Group.DoesNotExist:
                grp = None
            if grp:
                if teacher_uid is not None and int(teacher_uid) != grp.teacher.user_id:
                    return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
                for row in TeachersGroup.objects.filter(group_id=target_id).select_related(
                    'student', 'student__user'
                ):
                    uid = getattr(row.student, 'user_id', None)
                    if uid:
                        notify_user_ids.append(int(uid))

        # Резерв: сохраняем pending invite, чтобы ученик получил его даже если WS-сообщение было пропущено.
        for uid in notify_user_ids:
            cache.set(f'lesson_pending_invite:{uid}', invite_payload, timeout=LESSON_TTL)

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

        return Response({
            'ok': True,
            'student_url': student_url,
            'ws_sent': ws_sent,
            'already_sent': already_sent,
        })


class LessonPendingInviteView(APIView):
    """
    GET /api/lesson/pending/
    Возвращает pending invite для текущего пользователя (если есть) и очищает его.
    Нужен ученику (fallback, если WS не доставил).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user_id = getattr(request.user, 'id', None)
        if not user_id:
            return Response({'ok': True, 'invite': None})
        cache_key = f'lesson_pending_invite:{user_id}'
        invite = cache.get(cache_key)
        if invite:
            cache.delete(cache_key)
            return Response({'ok': True, 'invite': invite})
        return Response({'ok': True, 'invite': None})


# ── Homework API ───────────────────────────────────────────────────────────────

def _detect_file_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext in {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'}:
        return 'image'
    if ext in {'.mp4', '.mov', '.avi', '.mkv', '.webm'}:
        return 'video'
    if ext in {'.mp3', '.wav', '.ogg', '.m4a', '.flac'}:
        return 'audio'
    return 'file'


def _notify(user_profile, text, notification_type, assignment=None):
    Notification.objects.create(
        user=user_profile,
        text=text,
        notification_type=notification_type,
        read=False,
        homework_assignment=assignment,
    )


class HomeworkListView(APIView):
    """
    GET  /api/homework/        — список ДЗ учителя
    POST /api/homework/        — создать ДЗ (учитель)
    """
    permission_classes = [IsCabinetTeacher]

    def _teacher(self, request):
        return request.user.profile

    def get(self, request):
        teacher = self._teacher(request)
        qs = Homework.objects.filter(teacher=teacher).prefetch_related('attachments', 'assignments')
        return Response(HomeworkSerializer(qs, many=True, context={'request': request}).data)

    def post(self, request):
        teacher = self._teacher(request)
        variant_id = request.data.get('variant_id')
        if not variant_id:
            return Response({'error': 'variant_id обязателен'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            variant_id = int(variant_id)
        except (TypeError, ValueError):
            return Response({'error': 'variant_id должен быть числом'}, status=status.HTTP_400_BAD_REQUEST)

        hw = Homework.objects.create(
            variant_id=variant_id,
            title=request.data.get('title', ''),
            text=request.data.get('text', ''),
            subject=request.data.get('subject', ''),
            teacher=teacher,
            deadline=request.data.get('deadline') or timezone.now() + timezone.timedelta(days=1),
        )
        return Response(HomeworkSerializer(hw, context={'request': request}).data, status=status.HTTP_201_CREATED)


class HomeworkDetailView(APIView):
    """
    GET    /api/homework/<id>/  — детали ДЗ
    PATCH  /api/homework/<id>/  — обновить
    DELETE /api/homework/<id>/  — удалить
    """
    permission_classes = [IsCabinetTeacher]

    def _get_hw(self, request, pk):
        teacher = request.user.profile
        try:
            return Homework.objects.prefetch_related('attachments', 'assignments').get(pk=pk, teacher=teacher)
        except Homework.DoesNotExist:
            return None

    def get(self, request, pk):
        hw = self._get_hw(request, pk)
        if not hw:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        return Response(HomeworkSerializer(hw, context={'request': request}).data)

    def patch(self, request, pk):
        hw = self._get_hw(request, pk)
        if not hw:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        for field in ('title', 'text', 'subject', 'deadline', 'variant_id'):
            if field in request.data:
                setattr(hw, field, request.data[field])
        hw.save()
        return Response(HomeworkSerializer(hw, context={'request': request}).data)

    def delete(self, request, pk):
        hw = self._get_hw(request, pk)
        if not hw:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        hw.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HomeworkAssignView(APIView):
    """
    POST /api/homework/<id>/assign/
    Тело: { student_ids: [1,2,3] } и/или { group_id: 5 }
    Назначает ДЗ ученикам.
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request, pk):
        teacher = request.user.profile
        try:
            hw = Homework.objects.get(pk=pk, teacher=teacher)
        except Homework.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        student_ids = request.data.get('student_ids') or []
        group_id    = request.data.get('group_id')

        if group_id:
            from .models import TeachersGroup
            group_student_ids = TeachersGroup.objects.filter(
                group_id=group_id, group__teacher=teacher,
            ).values_list('student_id', flat=True)
            student_ids = list(student_ids) + list(group_student_ids)

        if not student_ids:
            return Response({'error': 'Укажите student_ids или group_id'}, status=status.HTTP_400_BAD_REQUEST)

        # Only teacher's students
        valid_ids = set(
            TeachersStudent.objects.filter(
                teacher=teacher, student_id__in=student_ids,
            ).values_list('student_id', flat=True)
        )

        created, skipped = 0, 0
        for sid in set(student_ids):
            if sid not in valid_ids:
                skipped += 1
                continue
            try:
                student = UserProfile.objects.get(pk=sid)
            except UserProfile.DoesNotExist:
                skipped += 1
                continue
            assignment, is_new = HomeworkAssignment.objects.get_or_create(
                homework=hw, student=student,
                defaults={'status': 'sent'},
            )
            if is_new:
                created += 1
                title = hw.title or f'Вариант {hw.variant_id}'
                _notify(
                    student,
                    f'Новое домашнее задание: {title}',
                    'homework_assigned',
                    assignment=assignment,
                )

        return Response({'created': created, 'skipped': skipped})


class HomeworkUploadAttachmentView(APIView):
    """
    POST /api/homework/upload-attachment/
    Тело: multipart { homework_id, file }
    """
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        teacher = request.user.profile
        hw_id   = request.data.get('homework_id')
        f       = request.FILES.get('file')
        if not hw_id or not f:
            return Response({'error': 'homework_id и file обязательны'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            hw = Homework.objects.get(pk=hw_id, teacher=teacher)
        except Homework.DoesNotExist:
            return Response({'error': 'ДЗ не найдено'}, status=status.HTTP_404_NOT_FOUND)
        filename  = f.name
        file_type = _detect_file_type(filename)
        att = HomeworkAttachment.objects.create(
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
    permission_classes = [IsLKTeacher]

    def get(self, request):
        try:
            profile = request.user.profile
        except Exception:
            return Response([], status=status.HTTP_200_OK)
        qs = (
            homework_assignment_select_qs()
            .filter(student=profile)
            .select_related('homework', 'homework__teacher')
            .prefetch_related('answer_files', 'homework__attachments')
        )
        return Response(
            HomeworkAssignmentDetailSerializer(qs, many=True, context={'request': request}).data,
        )


def homework_assignment_accessible(request, pk):
    """Назначение ДЗ, если текущий пользователь (ученик-владелец или учитель ДЗ) имеет к нему доступ."""
    try:
        profile = request.user.profile
    except Exception:
        return None
    qs = (
        homework_assignment_select_qs()
        .select_related('homework', 'homework__teacher', 'student')
        .prefetch_related('answer_files', 'homework__attachments')
    )
    try:
        obj = qs.get(pk=pk)
    except HomeworkAssignment.DoesNotExist:
        return None
    if profile.role == 'student' and obj.student_id != profile.pk:
        return None
    if profile.role != 'student' and obj.homework.teacher_id != profile.pk:
        return None
    return obj


class HomeworkAssignmentDetailView(APIView):
    """
    GET /api/homework/assignment/<id>/
    Детали назначения ДЗ (учитель или ученик-владелец).
    """
    permission_classes = [IsLKTeacher]

    def get(self, request, pk):
        obj = homework_assignment_accessible(request, pk)
        if not obj:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        return Response(HomeworkAssignmentDetailSerializer(obj, context={'request': request}).data)


class HomeworkAssignmentMetaPatchView(APIView):
    """
    PATCH /api/homework/assignment/<id>/meta/
    - whiteboard_strokes: полный список штрихов (ученик или учитель)
    - task_teacher_comments: частичное обновление { "номер задания": "текст" } (только учитель)
    """
    permission_classes = [IsLKTeacher]

    def patch(self, request, pk):
        if not _homework_assignment_meta_columns_ready():
            return Response(
                {'error': 'Обновите сервер: выполните миграции БД (0016_homeworkassignment_board_comments).'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        obj = homework_assignment_accessible(request, pk)
        if not obj:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        profile = request.user.profile
        is_student_owner = profile.role == 'student' and obj.student_id == profile.pk
        is_teacher_owner = profile.role != 'student' and obj.homework.teacher_id == profile.pk

        update_fields = []

        if 'whiteboard_strokes' in request.data:
            if not (is_student_owner or is_teacher_owner):
                return Response({'error': 'Нет прав'}, status=status.HTTP_403_FORBIDDEN)
            strokes = request.data.get('whiteboard_strokes')
            if not isinstance(strokes, list):
                return Response({'error': 'whiteboard_strokes должен быть массивом'}, status=status.HTTP_400_BAD_REQUEST)
            if len(strokes) > 800:
                strokes = strokes[-800:]
            obj.whiteboard_strokes = strokes
            update_fields.append('whiteboard_strokes')

        if 'task_teacher_comments' in request.data:
            if not is_teacher_owner:
                return Response({'error': 'Только учитель может сохранять комментарии к заданиям'}, status=status.HTTP_403_FORBIDDEN)
            tc = request.data.get('task_teacher_comments')
            if not isinstance(tc, dict):
                return Response({'error': 'task_teacher_comments должен быть объектом'}, status=status.HTTP_400_BAD_REQUEST)
            base = dict(obj.task_teacher_comments or {})
            for k, v in tc.items():
                key = str(k).strip()
                if not key:
                    continue
                base[key] = '' if v is None else str(v)
            obj.task_teacher_comments = base
            update_fields.append('task_teacher_comments')

        if not update_fields:
            return Response(
                {'error': 'Укажите whiteboard_strokes и/или task_teacher_comments'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        obj.save(update_fields=update_fields)
        return Response(
            HomeworkAssignmentDetailSerializer(obj, context={'request': request}).data,
        )


def _absolutize_variant_html(html: str, base_url: str) -> str:
    """Картинки/ссылки с путём /... в HTML варианта → абсолютные URL на домен генератора."""
    if not html or not isinstance(html, str):
        return html
    base = base_url.rstrip('/')

    def abs_path(path: str) -> str:
        if not path:
            return path
        p = path.strip()
        if p.startswith(('http://', 'https://', 'data:', 'blob:', 'mailto:')):
            return path
        if p.startswith('//'):
            return path
        if p.startswith('/'):
            return f'{base}{p}'
        return f'{base}/{p.lstrip("/")}'

    def repl_attr(m):
        attr, quote, path = m.group(1), m.group(2), m.group(3)
        return f'{attr}={quote}{abs_path(path)}{quote}'

    out = re.sub(r"(?is)(src|href)\s*=\s*([\"'])(/[^\s\"'>]+)\2", repl_attr, html)
    out = re.sub(
        r'(?is)url\s*\(\s*(["\']?)(/[^)\'"]+)\1\s*\)',
        lambda m: f'url({m.group(1)}{abs_path(m.group(2))}{m.group(1)})',
        out,
    )
    return out


def _rewrite_variant_media_urls(data, base_url: str):
    """Рекурсивно правит HTML в полях заданий (картинки с /media/… на другом хосте)."""
    html_keys = {
        'text', 'task_template', 'hint', 'solution', 'description',
        'condition', 'body', 'content', 'html',
    }
    base = base_url.rstrip('/')
    if isinstance(data, dict):
        for k, v in list(data.items()):
            if k in html_keys and isinstance(v, str):
                data[k] = _absolutize_variant_html(v, base_url)
            elif k == 'file' and isinstance(v, str) and v.startswith('/') and not v.startswith('//'):
                data[k] = f'{base}{v}'
            else:
                _rewrite_variant_media_urls(v, base_url)
    elif isinstance(data, list):
        for item in data:
            _rewrite_variant_media_urls(item, base_url)


class HomeworkVariantProxyView(APIView):
    """
    GET /api/homework/variant/<variant_id>/
    Проксирует JSON варианта из Генератора, чтобы фронтенд ЛК не делал кросс-доменный запрос.
    Доступно и учителям, и ученикам (любой авторизованный пользователь ЛК).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, variant_id):
        genurok_url = GENUROK_URL.rstrip('/')
        url = f'{genurok_url}/api/lesson/variant/{variant_id}/'
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            if isinstance(data, dict):
                _rewrite_variant_media_urls(data, genurok_url)
            return Response(data)
        except urllib.error.HTTPError as e:
            return Response({'error': f'Генератор вернул {e.code}'}, status=e.code)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class HomeworkSubmitView(APIView):
    """
    POST /api/homework/assignment/<id>/submit/
    Ученик сдаёт ДЗ. Тело: { result: {...}, score: N }
    """
    permission_classes = [IsLKTeacher]

    def post(self, request, pk):
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Профиль не найден'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            assignment = HomeworkAssignment.objects.select_related(
                'homework__teacher', 'student',
            ).get(pk=pk, student=profile)
        except HomeworkAssignment.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        if assignment.status not in ('sent', 'revision'):
            return Response({'error': f'Нельзя сдать ДЗ со статусом "{assignment.status}"'}, status=status.HTTP_400_BAD_REQUEST)

        result = request.data.get('result')
        score  = request.data.get('score')

        update_fields = ['status', 'submitted_at']
        assignment.status       = 'submitted'
        assignment.submitted_at = timezone.now()
        if isinstance(result, dict):
            assignment.result = result
            update_fields.append('result')
        if score is not None:
            try:
                assignment.score = int(score)
                update_fields.append('score')
            except (TypeError, ValueError):
                pass
        assignment.save(update_fields=update_fields)

        title        = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        student_name = f'{profile.name} {profile.surname}'.strip()
        score_str    = f' — {assignment.score} б' if assignment.score is not None else ''
        _notify(
            assignment.homework.teacher,
            f'{student_name} сдал(а) ДЗ: {title}{score_str}',
            'submitted',
            assignment=assignment,
        )
        return Response(HomeworkAssignmentSerializer(assignment, context={'request': request}).data)


class HomeworkUploadAnswerView(APIView):
    """
    POST /api/homework/assignment/<id>/upload-answer/
    Ученик загружает файл ответа.
    """
    permission_classes = [IsLKTeacher]

    def post(self, request, pk):
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Профиль не найден'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            assignment = HomeworkAssignment.objects.get(pk=pk, student=profile)
        except HomeworkAssignment.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        f = request.FILES.get('file')
        if not f:
            return Response({'error': 'file обязателен'}, status=status.HTTP_400_BAD_REQUEST)

        task_number = request.POST.get('task_number') or request.data.get('task_number')
        tn = None
        if task_number is not None and str(task_number).strip() != '':
            try:
                tn = int(task_number)
            except (TypeError, ValueError):
                return Response({'error': 'task_number должен быть числом'}, status=status.HTTP_400_BAD_REQUEST)

        filename  = f.name
        file_type = _detect_file_type(filename)
        answer    = HomeworkAnswerFile.objects.create(
            assignment=assignment,
            file=f,
            filename=filename,
            file_type=file_type,
            task_number=tn,
        )
        try:
            title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
            sn = f'{profile.name} {profile.surname}'.strip()
            extra = f' (задание {tn})' if tn is not None else ''
            _notify(
                assignment.homework.teacher,
                f'{sn} добавил(а) вложение{extra} к «{title}»: {filename}',
                'submitted',
                assignment=assignment,
            )
        except Exception:
            pass
        return Response(
            HomeworkAnswerFileSerializer(answer, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class HomeworkReviewView(APIView):
    """
    POST /api/homework/assignment/<id>/review/
    Учитель проверяет ДЗ или отправляет на доработку.
    Тело: { action: 'reviewed'|'revision', comment: '...' }
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

        action  = request.data.get('action', 'reviewed')
        comment = request.data.get('comment', '')

        if action not in ('reviewed', 'revision'):
            return Response({'error': 'action: reviewed или revision'}, status=status.HTTP_400_BAD_REQUEST)

        assignment.status          = action
        assignment.teacher_comment = str(comment) if comment is not None else ''
        assignment.reviewed_at     = timezone.now()
        assignment.save(update_fields=['status', 'teacher_comment', 'reviewed_at'])

        title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        snip = (assignment.teacher_comment or '').strip().replace('\n', ' ')
        if len(snip) > 100:
            snip = snip[:100] + '…'

        if action == 'reviewed':
            msg = f'ДЗ проверено: {title}'
            if snip:
                msg = f'{msg}. {snip}'
            _notify(assignment.student, msg, 'reviewed', assignment=assignment)
        else:
            msg = f'ДЗ направлено на доработку: {title}'
            if snip:
                msg = f'{msg}. {snip}'
            _notify(assignment.student, msg, 'revision_requested', assignment=assignment)

        obj = (
            HomeworkAssignment.objects
            .select_related('homework', 'homework__teacher', 'student')
            .prefetch_related('answer_files', 'homework__attachments')
            .get(pk=assignment.pk)
        )
        return Response(HomeworkAssignmentDetailSerializer(obj, context={'request': request}).data)


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

        if assignment.status not in ('submitted', 'reviewing', 'reviewed', 'revision'):
            return Response(
                {'error': 'Комментарий недоступен для этого статуса задания'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        comment = request.data.get('comment', '')
        if comment is None:
            comment = ''
        assignment.teacher_comment = str(comment)
        assignment.save(update_fields=['teacher_comment'])

        title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        snip = assignment.teacher_comment.strip().replace('\n', ' ')
        if len(snip) > 120:
            snip = snip[:120] + '…'
        msg = f'Комментарий к ДЗ «{title}»'
        if snip:
            msg = f'{msg}: {snip}'
        _notify(assignment.student, msg, 'teacher_comment', assignment=assignment)

        obj = (
            HomeworkAssignment.objects
            .select_related('homework', 'homework__teacher', 'student')
            .prefetch_related('answer_files', 'homework__attachments')
            .get(pk=assignment.pk)
        )
        return Response(HomeworkAssignmentDetailSerializer(obj, context={'request': request}).data)


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

        if assignment.status not in ('submitted', 'reviewing', 'reviewed', 'revision'):
            return Response({'error': 'Вложения недоступны для этого статуса'}, status=status.HTTP_400_BAD_REQUEST)

        f = request.FILES.get('file')
        if not f:
            return Response({'error': 'file обязателен'}, status=status.HTTP_400_BAD_REQUEST)

        src = None
        raw_src = request.POST.get('source_answer_file_id') or request.data.get('source_answer_file_id')
        if raw_src not in (None, ''):
            try:
                sid = int(raw_src)
                src = HomeworkAnswerFile.objects.get(pk=sid, assignment=assignment)
            except (ValueError, TypeError, HomeworkAnswerFile.DoesNotExist):
                return Response({'error': 'Неверный source_answer_file_id'}, status=status.HTTP_400_BAD_REQUEST)

        filename  = f.name
        file_type = _detect_file_type(filename)
        row = HomeworkTeacherFeedbackFile.objects.create(
            assignment=assignment,
            file=f,
            filename=filename,
            file_type=file_type,
            source_answer_file=src,
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
            ).get(pk=file_id, assignment__homework__teacher=teacher)
        except HomeworkAnswerFile.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        annotations = request.data.get('annotations')
        if not isinstance(annotations, list):
            return Response({'error': 'annotations должен быть массивом'}, status=status.HTTP_400_BAD_REQUEST)
        answer.annotations = annotations
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
            return Response([])
        qs = (
            Notification.objects
            .filter(user=profile)
            .select_related('homework_assignment')
            .order_by('-created_at')[:50]
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
            notif = Notification.objects.get(pk=pk, user=profile)
        except Notification.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        notif.read = True
        notif.save(update_fields=['read'])
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
        Notification.objects.filter(user=profile, read=False).update(read=True)
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
            ).get(pk=pk, homework__teacher=teacher)
        except HomeworkAssignment.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        assignment.status = 'cancelled'
        assignment.save(update_fields=['status'])

        title = assignment.homework.title or f'Вариант {assignment.homework.variant_id}'
        _notify(
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
            homework = Homework.objects.get(pk=pk, teacher=teacher)
        except Homework.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)

        assignments = HomeworkAssignment.objects.filter(
            homework=homework,
        ).exclude(status='cancelled').select_related('student')

        title = homework.title or f'Вариант {homework.variant_id}'
        for assignment in assignments:
            assignment.status = 'cancelled'
            assignment.save(update_fields=['status'])
            _notify(
                assignment.student,
                f'ДЗ отменено учителем: {title}',
                'homework_assigned',
                assignment=assignment,
            )

        return Response({'cancelled': assignments.count()})


class HomeworkTeacherAssignmentsView(APIView):
    """
    GET /api/homework/<id>/assignments/
    Учитель: список всех назначений для конкретного ДЗ.
    """
    permission_classes = [IsCabinetTeacher]

    def get(self, request, pk):
        teacher = request.user.profile
        try:
            hw = Homework.objects.get(pk=pk, teacher=teacher)
        except Homework.DoesNotExist:
            return Response({'error': 'Не найдено'}, status=status.HTTP_404_NOT_FOUND)
        qs = (
            homework_assignment_select_qs()
            .filter(homework=hw)
            .select_related('student', 'homework')
            .prefetch_related('answer_files')
        )
        return Response(
            HomeworkAssignmentDetailSerializer(qs, many=True, context={'request': request}).data,
        )
