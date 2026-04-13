from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.contrib import messages
from django.conf import settings
from django.core.cache import cache
import random
import string
import time
import re
import jwt
from .models import UserProfile, FunnyWord, Subject, Level, TeacherSubject, TeachersStudent, Group
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.response import Response
from .permissions import IsLKTeacher, IsCabinetTeacher, user_can_use_lk
from .security_utils import safe_redirect_target
from .serializers import (
    UserProfileSerializer, SubjectSerializer,
    LevelSerializer, TeachersStudentSerializer, GroupSerializer,
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
            student_video_url = (
                f"{jitsi_base}/{room_path}?jwt={student_jitsi_tok}"
                f"#config.prejoinPageEnabled=false&config.prejoinConfig.enabled=false"
            )
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

        student_user_id = None
        if target_id:
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
                    student_user_id = ts.student.user_id

        # Резерв: сохраняем pending invite, чтобы ученик получил его даже если WS-сообщение было пропущено.
        if student_user_id:
            cache.set(f'lesson_pending_invite:{student_user_id}', invite_payload, timeout=LESSON_TTL)

        ws_sent = False
        if target_id:
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                channel_layer = get_channel_layer()
                notify_channel = f"user_{student_user_id}" if student_user_id else f"user_{target_id}"
                async_to_sync(channel_layer.group_send)(
                    notify_channel,
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
    """
    permission_classes = [IsLKTeacher]

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
