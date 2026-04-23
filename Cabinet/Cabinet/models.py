from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta

def tomorrow():
    return timezone.now() + timedelta(days=1)

ROLE_CHOICES = [
        ('teacher', 'Учитель'),
        ('admin', 'Администратор'),
        ('student', 'Ученик'),
        ('editor', 'Редактор'),
    ]

class FunnyWord(models.Model):
    word = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.word

    class Meta:
        verbose_name = "Смешное слово"
        verbose_name_plural = "Смешные слова"


class Tariff(models.Model):
    tariff_name = models.CharField(max_length=50)

    def __str__(self):
        return f"{self.tariff_name}"

    class Meta:
        verbose_name = "Тариф"
        verbose_name_plural = "Тарифы"


class Subject(models.Model):
    subject_name = models.CharField(max_length=50)

    def __str__(self):
        return f"{self.subject_name}"

    class Meta:
        verbose_name = "Предмет"
        verbose_name_plural = "Предметы"



class Level(models.Model):
    level = models.CharField(max_length=50)

    def __str__(self):
        return f"{self.level}"

    class Meta:
        verbose_name = "Уровень"
        verbose_name_plural = "Уровни"



class UserProfile(models.Model):
    GENDER_CHOICES = [
        ('female', 'Женский'),
        ('male',   'Мужской'),
        ('other',  'Не указан'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, null=True, blank=True, related_name='profile')
    role = models.CharField(max_length=50, choices=ROLE_CHOICES, default='teacher')

    username   = models.CharField(max_length=150)
    name       = models.CharField(max_length=100)
    surname    = models.CharField(max_length=100)
    email      = models.EmailField(null=False, blank=False)
    phone      = models.CharField(null=True, blank=True)
    gender     = models.CharField(max_length=10, choices=GENDER_CHOICES, default='other')
    birth_date = models.DateField(null=True, blank=True)

    avatar = models.ImageField(null=True, blank=True)
    avatar_emoji = models.CharField(max_length=16, null=True, blank=True, default='')
    avatar_bg = models.CharField(max_length=32, null=True, blank=True, default='')

    last_activity = models.DateTimeField(null=True, blank=True)

    vk_user_id = models.CharField(
        max_length=32, null=True, blank=True, unique=True, db_index=True,
        verbose_name='VK ID',
    )

    tariff = models.ForeignKey(Tariff, on_delete=models.SET_NULL, null=True, blank=True)


    def __str__(self):
        return f"{self.name} {self.surname}"

    class Meta:
        verbose_name = "Пользователь"
        verbose_name_plural = "Пользователи"

class TeacherSubject(models.Model):
    teacher = models.ForeignKey(UserProfile, on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)

    class Meta:
        verbose_name = "Предмет учителя"
        verbose_name_plural = "Предметы учителей"

class TeachersStudent(models.Model):
    GRADE_CHOICES = [
        ('7', '7 класс'),
        ('8', '8 класс'),
        ('9', '9 класс'),
        ('10', '10 класс'),
        ('11', '11 класс'),
    ]

    STUDENTS_STATUS_CHOICES = [
        ('1', 'Активный'),
        ('2', 'На паузе'),
        ('3', 'Завершил обучение'),
        ('4', 'Пробный урок'),
    ]

    LESSON_TYPE_CHOICES = [
        ('individual', 'Индивидуальное'),
        ('group', 'Групповое'),
    ]

    teacher = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='my_students')
    student = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='my_teachers')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    level = models.ForeignKey(Level, on_delete=models.CASCADE)
    grade = models.CharField(max_length=50, choices=GRADE_CHOICES)
    goal = models.TextField(max_length=200, null=True, blank=True)
    status = models.CharField(max_length=100, choices=STUDENTS_STATUS_CHOICES)
    lesson_type = models.CharField(max_length=20, choices=LESSON_TYPE_CHOICES, default='individual')
    group = models.ForeignKey('Group', on_delete=models.SET_NULL, null=True, blank=True, related_name='students')

    def __str__(self):
        return f"{self.student}"

    class Meta:
        verbose_name = "Ученики"
        verbose_name_plural = "Ученики"

class Group(models.Model):
    group_name = models.CharField(max_length=100)

    teacher = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='teachers_groups')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    level = models.ForeignKey(Level, on_delete=models.CASCADE)

    def __str__(self):
        return self.group_name

    class Meta:
        verbose_name = "Группа"
        verbose_name_plural = "Все руппы"

class TeachersGroup(models.Model):
    group = models.ForeignKey(Group, on_delete=models.CASCADE)
    student = models.ForeignKey(UserProfile, on_delete=models.CASCADE)

    def __str__(self):
        return self.group

    class Meta:
        verbose_name = "Группа"
        verbose_name_plural = "Ученики в группе"


FILE_TYPE_CHOICES = [
    ('image', 'Изображение'),
    ('video', 'Видео'),
    ('audio', 'Аудио'),
    ('file',  'Файл'),
]


class Homework(models.Model):
    variant_id = models.IntegerField()
    title      = models.CharField(max_length=200, blank=True)
    text       = models.TextField(null=True, blank=True)
    subject    = models.CharField(max_length=100, blank=True)
    teacher    = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='homeworks')
    created_at = models.DateTimeField(auto_now_add=True)
    deadline   = models.DateTimeField(default=tomorrow)

    def __str__(self):
        label = self.title or (self.text[:20] if self.text else '')
        return f'{self.id}: {label} (вариант {self.variant_id})'

    class Meta:
        verbose_name = "Домашнее задание"
        verbose_name_plural = "Домашние задания"
        ordering = ['-created_at']


class HomeworkAttachment(models.Model):
    """Файлы учителя, прикреплённые к ДЗ (дополнительные материалы)."""
    homework  = models.ForeignKey(Homework, on_delete=models.CASCADE, related_name='attachments')
    file      = models.FileField(upload_to='homework_attachments/')
    filename  = models.CharField(max_length=255)
    file_type = models.CharField(max_length=10, choices=FILE_TYPE_CHOICES, default='file')

    def __str__(self):
        return self.filename

    class Meta:
        verbose_name = "Вложение к ДЗ"
        verbose_name_plural = "Вложения к ДЗ"


ASSIGNMENT_STATUS_CHOICES = [
    ('sent',      'Задано'),
    ('submitted', 'Сдано на проверку'),
    ('reviewing', 'На проверке'),
    ('reviewed',  'Проверено'),
    ('revision',  'На доработке'),
    ('overdue',   'Просрочено'),
    ('cancelled', 'Отменено'),
]


class HomeworkAssignment(models.Model):
    """Назначение ДЗ конкретному ученику + статус выполнения."""
    homework        = models.ForeignKey(Homework, on_delete=models.CASCADE, related_name='assignments')
    student         = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='hw_assignments')
    status          = models.CharField(max_length=20, choices=ASSIGNMENT_STATUS_CHOICES, default='sent')
    teacher_comment = models.TextField(blank=True)
    submitted_at    = models.DateTimeField(null=True, blank=True)
    reviewed_at     = models.DateTimeField(null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    # Результаты выполнения варианта: {task_number: {answer, state, score}}
    result          = models.JSONField(default=dict, blank=True)
    # Набранный балл за часть 1 (подсчитывается на фронте и сохраняется при сдаче)
    score           = models.IntegerField(null=True, blank=True)
    # Комментарии учителя к отдельным заданиям: {"13": "текст", ...}
    task_teacher_comments = models.JSONField(default=dict, blank=True)
    # Общая доска к варианту: [{ "type": "path", "color": "#000", "width": 2, "points": [[x,y],...] }, ...]
    whiteboard_strokes = models.JSONField(default=list, blank=True)
    # JWT и slug «комнаты» на сайте генератора (как урок; тема «домашка» — query cabinet_session=homework).
    homework_room_token = models.TextField(blank=True, default='')
    homework_room_id = models.CharField(max_length=200, blank=True, default='')
    # Номера заданий (строки), которые ученик должен переделать; пустой список = доработка всей работы.
    revision_task_ids = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f'ДЗ #{self.homework_id} → {self.student} [{self.status}]'

    class Meta:
        verbose_name = "Назначение ДЗ"
        verbose_name_plural = "Назначения ДЗ"
        unique_together = [('homework', 'student')]
        ordering = ['-created_at']


class HomeworkAnswerFile(models.Model):
    """Файлы ответа ученика на ДЗ (с опциональными аннотациями учителя)."""
    assignment  = models.ForeignKey(HomeworkAssignment, on_delete=models.CASCADE, related_name='answer_files')
    file        = models.FileField(upload_to='homework_answers/')
    filename    = models.CharField(max_length=255)
    file_type   = models.CharField(max_length=10, choices=FILE_TYPE_CHOICES, default='file')
    # Номер задания в варианте (к какому пункту прикреплён файл); null — общий файл ответа
    task_number = models.IntegerField(null=True, blank=True)
    annotations = models.JSONField(default=list, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.filename

    class Meta:
        verbose_name = "Файл ответа на ДЗ"
        verbose_name_plural = "Файлы ответов на ДЗ"
        ordering = ['uploaded_at']


class HomeworkTeacherFeedbackFile(models.Model):
    """Файлы учителя к проверке (комментарий к работе: разметка на фото, вложения)."""
    assignment = models.ForeignKey(
        HomeworkAssignment, on_delete=models.CASCADE, related_name='teacher_feedback_files',
    )
    file       = models.FileField(upload_to='homework_teacher_feedback/')
    filename   = models.CharField(max_length=255)
    file_type  = models.CharField(max_length=10, choices=FILE_TYPE_CHOICES, default='file')
    source_answer_file = models.ForeignKey(
        HomeworkAnswerFile, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='teacher_feedback_exports',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.filename

    class Meta:
        verbose_name = "Вложение учителя к проверке ДЗ"
        verbose_name_plural = "Вложения учителя к проверке ДЗ"
        ordering = ['created_at']


class TeacherVariant(models.Model):
    """Сохранённый вариант учителя (ссылка на variant_id в генераторе)."""
    teacher = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='saved_variants')
    variant_id = models.IntegerField()
    level = models.CharField(max_length=50)
    subject = models.CharField(max_length=50)
    title = models.CharField(max_length=255, blank=True)
    task_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


    def __str__(self):
        label = self.title or f'Вариант {self.variant_id}'
        return f'{label} [{self.level}/{self.subject}]'

    class Meta:
        verbose_name = "Вариант учителя"
        verbose_name_plural = "Варианты учителей"
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['teacher', 'variant_id'], name='uniq_teacher_variant_pair'),
        ]


class Notification(models.Model):
    NOTIFICATION_TYPES = [
        ('submitted',          'Сдал на проверку'),
        ('check_deadline_soon','Подходит срок проверки'),
        ('low_result_alert',   'Низкие результаты'),
        ('missed',             'Не сдал в срок'),
        ('homework_assigned',  'Новое домашнее задание'),
        ('reviewed',           'ДЗ проверено'),
        ('revision_requested', 'ДЗ направлено на доработку'),
        ('teacher_comment',    'Комментарий учителя к ДЗ'),
    ]
    text                = models.CharField(max_length=500)
    user                = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='notifications')
    notification_type   = models.CharField(max_length=25, choices=NOTIFICATION_TYPES)
    read                = models.BooleanField(default=False)
    homework_assignment = models.ForeignKey(
        HomeworkAssignment, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='notifications',
    )
    created_at = models.DateTimeField(auto_now_add=True)





class LessonInvite(models.Model):
    TARGET_TYPE = [
        ('ind',   'Индивидуальный'),
        ('group', 'Групповой'),
    ]

    STATUS_CHOICES = [
        ('scheduled', 'Учитель ещё не в комнате'),  # звонок ученику не отправляем
        ('pending',   'Ожидает'),
        ('accepted',  'Принято'),
        ('expired',   'Истекло'),
        ('cancelled', 'Отменено'),
    ]

    teacher     = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='lesson_invites')
    target_type = models.CharField(max_length=10, choices=TARGET_TYPE)
    target_id   = models.IntegerField()          # id ученика или группы
    target_name = models.CharField(max_length=150)

    token       = models.CharField(max_length=2048, unique=True, editable=False)
    expires_at  = models.DateTimeField()
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    lesson_link = models.CharField(max_length=2048, blank=True)
    lesson      = models.ForeignKey('Lesson', on_delete=models.SET_NULL, null=True, blank=True, related_name='invites')

    created_at  = models.DateTimeField(auto_now_add=True)

    def is_valid(self):
        return self.status == 'pending' and timezone.now() < self.expires_at

    def __str__(self):
        return f'Приглашение {self.token} → {self.target_name} [{self.status}]'

    class Meta:
        verbose_name = "Приглашение на урок"
        verbose_name_plural = "Приглашения на уроки"
        ordering = ['-created_at']

class Lesson(models.Model):
    lesson_token = models.CharField(max_length=1000)
    room_id = models.CharField(max_length=100)
    teacher = models.ForeignKey(UserProfile, on_delete=models.CASCADE)
    variant = models.ForeignKey(TeacherVariant, on_delete=models.PROTECT)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(auto_now_add=True)


    class Meta:
        verbose_name = "Проведённый урок"
        verbose_name_plural ="Проведённые уроки"


    