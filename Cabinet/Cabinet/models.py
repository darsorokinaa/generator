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

    last_activity = models.DateTimeField(null=True, blank=True)

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


class Homework(models.Model):
    variant_id = models.IntegerField()
    text = models.TextField(null=True, blank=True)
    teacher = models.ForeignKey(UserProfile, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    deadline = models.DateTimeField(default=tomorrow)

    def __str__(self):
        return f'{self.id}: {self.text[:20]}... {self.variant_id}'

    class Meta:
        verbose_name = "Домашнее задание"
        verbose_name_plural = "Домашние задания"

class StudentsHomework(models.Model):
    HOMEWORK_STATUS_CHOICES = [
        ('1', 'Проверено'),
        ('2', 'Ждёт проверки'),
        ('3', 'Просрочено'),
    ]
    student = models.ForeignKey(UserProfile, on_delete=models.CASCADE)
    homework = models.ForeignKey(Homework, on_delete=models.CASCADE)
    status = models.CharField(max_length=100, choices=HOMEWORK_STATUS_CHOICES, default='2')
    

    class Meta:
        verbose_name = "ДЗ заданное"
        verbose_name_plural = "ДЗ заданное"

class StudentsAnswerImg(models.Model):
    student = models.ForeignKey(UserProfile, on_delete=models.CASCADE)
    homework = models.ForeignKey(Homework, on_delete=models.CASCADE)
    img = models.ImageField(null=True, blank=True)


class Notification(models.Model):
    NOTIFICATION_TYPES = [
        ('submitted', 'Отправил на проверку'),
        ('check_deadline_soon', 'Подходит срок проверки'),
        ('low_result_alert', 'Низкие результаты'),
        ('missed', 'Не сдал в срок'),
    ]
    text = models.CharField(max_length=200)
    user = models.ForeignKey(UserProfile, on_delete = models.CASCADE)
    notification_type = models.CharField(max_length=20, choices = NOTIFICATION_TYPES)
    read = models.BooleanField()


