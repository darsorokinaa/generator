from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
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
from .permissions import IsLKTeacher
from .serializers import (
    UserProfileSerializer, SubjectSerializer,
    LevelSerializer, TeachersStudentSerializer, GroupSerializer,
)


FRONTEND_URL   = getattr(settings, 'FRONTEND_URL',   'http://localhost:3000')
GENURОК_URL    = getattr(settings, 'GENURОК_URL',    'https://генурок.рф')
LESSON_SECRET  = getattr(settings, 'LESSON_SECRET',  settings.SECRET_KEY)
LESSON_TTL     = 60 * 60 * 2  # токен живёт 2 часа


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
    """Возвращает URL дашборда — всегда FRONTEND_URL."""
    return FRONTEND_URL


def login_view(request):
    if request.user.is_authenticated:
        if request.user.is_staff or request.user.is_superuser:
            return redirect('/admin/')
        return redirect(_dashboard_url(request))

    if request.method == 'POST':
        login_str = request.POST.get('username', '').strip()
        password  = request.POST.get('password', '')

        user_obj = get_user_by_login(login_str)
        user = authenticate(request, username=user_obj.username, password=password) if user_obj else None

        if user is not None:
            if user.is_staff or user.is_superuser:
                messages.error(
                    request,
                    'Эта учётная запись только для админ-панели (/admin/). '
                    'В личный кабинет учителя входите под отдельным логином (регистрация в кабинете).',
                )
            else:
                login(request, user)
                next_url = request.GET.get('next')
                return redirect(next_url if next_url else _dashboard_url(request))
        else:
            messages.error(request, 'Неверный логин / email или пароль')

    return render(request, 'login.html')


def register_view(request):
    if request.user.is_authenticated:
        if request.user.is_staff or request.user.is_superuser:
            return redirect('/admin/')
        return redirect(FRONTEND_URL)

    subjects = Subject.objects.all().order_by('subject_name')

    if request.method == 'POST':
        name        = request.POST.get('name', '').strip()
        surname     = request.POST.get('surname', '').strip()
        email       = request.POST.get('email', '').strip()
        password1   = request.POST.get('password1', '')
        password2   = request.POST.get('password2', '')
        subject_ids = request.POST.getlist('subjects')

        if not all([name, surname, email, password1]):
            messages.error(request, 'Заполните все обязательные поля')
        elif not subject_ids:
            messages.error(request, 'Выберите хотя бы один предмет')
        elif password1 != password2:
            messages.error(request, 'Пароли не совпадают')
        elif len(password1) < 6:
            messages.error(request, 'Пароль должен быть не менее 6 символов')
        elif email and User.objects.filter(email=email).exists():
            messages.error(request, 'Email уже используется')
        else:
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
            selected = Subject.objects.filter(id__in=subject_ids)
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
    if request.user.is_authenticated and (request.user.is_staff or request.user.is_superuser):
        return redirect('/admin/')
    return render(request, 'settings.html')


# ── REST API ──────────────────────────────────────────────────────────────────

class UserProfileViewSet(viewsets.ModelViewSet):
    permission_classes = [IsLKTeacher]
    queryset = UserProfile.objects.all()
    serializer_class = UserProfileSerializer


class SubjectListView(APIView):
    permission_classes = [IsLKTeacher]

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
    permission_classes = [IsLKTeacher]

    def get(self, request):
        levels = Level.objects.all()
        return Response(LevelSerializer(levels, many=True).data)


class StudentsView(APIView):
    permission_classes = [IsLKTeacher]

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
        data = request.data

        name    = data.get('name', '').strip()
        surname = data.get('surname', '').strip()
        email   = data.get('email', '').strip()
        phone   = data.get('phone', '').strip()

        if not name:
            return Response({'error': 'Имя обязательно'}, status=status.HTTP_400_BAD_REQUEST)

        subject_id   = data.get('subject')
        level_id     = data.get('level')
        grade        = data.get('grade', '')
        goal         = data.get('goal', '')
        st_status    = data.get('status', '1')
        lesson_type  = data.get('lesson_type', 'individual')
        group_id     = data.get('group')
        gender       = data.get('gender', 'other')
        birth_date   = data.get('birth_date') or None

        try:
            subject = Subject.objects.get(id=subject_id)
            level   = Level.objects.get(id=level_id)
        except (Subject.DoesNotExist, Level.DoesNotExist):
            return Response({'error': 'Предмет или уровень не найден'}, status=status.HTTP_400_BAD_REQUEST)

        group = None
        if lesson_type == 'group' and group_id:
            try:
                group = Group.objects.get(id=group_id)
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

        teacher_profile = self._get_teacher_profile(request)
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
    permission_classes = [IsLKTeacher]

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
        return Response({
            'username': profile.username,
            'name': profile.name,
            'surname': profile.surname,
            'email': profile.email,
            'role': profile.role,
            'subjects': subject_names,
        })


class GroupView(APIView):
    permission_classes = [IsLKTeacher]

    def get(self, request):
        teacher_profile = self._teacher(request)
        groups = Group.objects.filter(teacher=teacher_profile).select_related('subject', 'level')
        return Response(GroupSerializer(groups, many=True).data)

    def post(self, request):
        data = request.data
        group_name = data.get('group_name', '').strip()
        if not group_name:
            return Response({'error': 'Введите название группы'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            subj  = Subject.objects.get(id=data.get('subject'))
            level = Level.objects.get(id=data.get('level'))
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
    permission_classes = [IsLKTeacher]

    def post(self, request):
        data        = request.data
        room_id     = data.get('room_id', '').strip()
        lesson_type = data.get('type', 'student')
        target_id   = data.get('target_id')
        target_name = data.get('target_name', '').strip()

        if not room_id or not target_name:
            return Response(
                {'error': 'room_id и target_name обязательны'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            profile      = request.user.profile
            teacher_name = f'{profile.name} {profile.surname}'.strip()
        except Exception:
            teacher_name = request.user.get_full_name() or request.user.username

        from django.conf import settings as dj_settings
        import urllib.parse

        genurок_url  = GENURОК_URL.rstrip('/')

        now = int(time.time())
        # Jitsi: одна комната на урок, разные ссылки только по display name.
        jitsi_base = getattr(dj_settings, 'JITSI_BASE_URL', 'https://meet.jit.si').rstrip('/')
        room_slug = re.sub(r'[^A-Za-z0-9_-]+', '-', room_id).strip('-') or f"lesson-{now}"
        room_path = urllib.parse.quote(room_slug, safe='-_')

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
        }

        token       = jwt.encode(payload, LESSON_SECRET, algorithm='HS256')
        teacher_url = f'{genurок_url}/lesson/join/?token={token}&role=teacher'
        student_url = f'{genurок_url}/lesson/join/?token={token}&role=student'

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

    def post(self, request):
        token = (request.data.get('token') or '').strip()
        if not token:
            return Response({'error': 'token required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = jwt.decode(token, LESSON_SECRET, algorithms=['HS256'])
        except Exception:
            return Response({'error': 'invalid token'}, status=status.HTTP_401_UNAUTHORIZED)

        room_id = str(payload.get('room_id') or '').strip()
        target_id = payload.get('target_id')
        teacher_name = str(payload.get('teacher') or '').strip() or 'Учитель'
        target_name = str(payload.get('target_name') or '').strip() or 'Ученик'
        lesson_type = str(payload.get('lesson_format') or payload.get('type') or 'student').strip() or 'student'
        genurок_url = GENURОК_URL.rstrip('/')
        student_url = f'{genurок_url}/lesson/join/?token={token}&role=student'

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
                ts = TeachersStudent.objects.select_related('student__user').get(pk=target_id)
                if ts.student and ts.student.user_id:
                    student_user_id = ts.student.user_id
            except TeachersStudent.DoesNotExist:
                pass

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
