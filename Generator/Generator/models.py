from django.db import models
from django.db.models import DO_NOTHING, CASCADE
from django.utils import timezone
import os
from uuid import uuid4
from django_ckeditor_5.fields import CKEditor5Field


def task_url(instance, filename):
    ext = filename.split('.')[-1].lower()

    level = instance.task.task.level.level
    subject = instance.task.task.subject.subject_short
    task_number = instance.task.task.task_number
    task_id = instance.task.id

    return os.path.join(
        'tasks_images',
        level,
        subject,
        f'task_{task_number}',
        f'{task_id}_{uuid4().hex[:10]}.{ext}'
    )



class Level(models.Model):
    level = models.CharField(max_length=10, db_index=True)
    level_rus = models.CharField(max_length=50, default='')
    def __str__(self):
        return self.level


class Subject(models.Model):
    subject_short = models.CharField(max_length=50, db_index=True)
    subject_name = models.CharField(max_length=200)

    def __str__(self):
        return self.subject_short

class Part(models.Model):
    part_title = models.CharField(max_length=35, blank=True, null=True)

    def __str__(self):
        return self.part_title

class TaskList(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    part = models.ForeignKey(Part, on_delete=CASCADE, blank=True, null=True, default=1)
    task_number = models.IntegerField()
    task_title = models.CharField(max_length=100)
    max_score = models.IntegerField(default=1)

    class Meta:
        indexes = [
            models.Index(fields=['subject', 'level'], name='tasklist_subject_level_idx'),
        ]

    def __str__(self):
        return f'{self.subject} {self.level}: {self.task_number} - {self.task_title}'

# Банк задач
class Task(models.Model):
    task = models.ForeignKey(TaskList, on_delete=CASCADE, null=True, db_index=True)
    subtopic = models.ForeignKey(          # ← новое
        'SubTopic',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_index=True
    )
    task_template = CKEditor5Field("Task text", config_name='default')
    files = models.FileField(upload_to='task_files', blank=True, null=True)

    answer = CKEditor5Field("Ответ", config_name='default', blank=True)

    author = models.TextField(max_length=500, blank=True, null=True)

    max_score = models.IntegerField(default=1)

    added_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_by = models.CharField(default='ADMIN', db_index=True)

    def __str__(self):
        return f'{self.id}: {self.task_template[:100]}'

class Tags(models.Model):
    tag = models.CharField(max_length=20, null=True, blank=True, default="Экзамен")

    def __str__(self):
        return self.tag


class LinkedTaskGroup(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    task_numbers = models.JSONField(default=list)

    class Meta:
        unique_together = [("subject", "level")]
        verbose_name = "Связанная группа номеров"

    def __str__(self):
        return f"{self.subject} / {self.level}: {self.task_numbers}"


class TaskGroup(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)

    class Meta:
        verbose_name = "Группа заданий"
        indexes = [
            models.Index(fields=['subject', 'level'], name='taskgroup_subject_level_idx'),
        ]

    def __str__(self):
        return f"Группа {self.id} ({self.subject} / {self.level})"


class TaskGroupMember(models.Model):
    task_group = models.ForeignKey(TaskGroup, on_delete=CASCADE)
    task = models.ForeignKey(Task, on_delete=CASCADE)
    task_number = models.IntegerField()

    class Meta:
        ordering = ["task_number"]
        unique_together = [("task_group", "task_number")]
        verbose_name = "Задание в группе"

    def __str__(self):
        return f"Группа {self.task_group_id}: №{self.task_number}"


class Variant(models.Model):
    var_subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    created_at = models.DateTimeField(default=timezone.now)
    created_by = models.CharField(max_length=100, default='ADMIN')
    share_token = models.CharField(max_length=20, blank=True, null=True)
    content = models.JSONField(default=dict, blank=True, null=True)  # {tasklist_id: count}
    def __str__(self):
        return f'Вариант {self.id} -  {self.var_subject}: {self.level}'


class VariantContent(models.Model):
    variant = models.ForeignKey(Variant, on_delete=CASCADE)
    task = models.ForeignKey(Task, on_delete=CASCADE)
    order = models.IntegerField()

    class Meta:
        ordering = ['order']
        indexes = [
            models.Index(fields=['variant', 'order'], name='vc_variant_order_idx'),
        ]

    def __str__(self):
        return f'Вариант {str(self.variant.id)} задание {self.task_id} ({self.variant.var_subject.subject_name} {self.variant.level})'

class TagsList(models.Model):
    tag = models.CharField(max_length=20)

    def __str__(self):
        return self.tag

class Tag(models.Model):
    task = models.ForeignKey(
        Task,
        on_delete=CASCADE,
        related_name='tags'
    )
    taskTag = models.ForeignKey(
        TagsList,
        on_delete=CASCADE,
        related_name='task_items',
        related_query_name='task_item'
    )

    def __str__(self):
        return f'Task: {self.task.id}: {self.taskTag.tag}'

class MarkComment(models.Model):
    MARK_LEVEL_CHOICES = [
        (1, "Недостаточно"),   # красный
        (2, "Порог"),          # оранжевый
        (3, "Средний балл"),   # жёлтый
        (4, "Высокий"),        # зелёный
    ]
    comment_text = models.TextField()
    mark_level = models.IntegerField(choices=MARK_LEVEL_CHOICES, default=0, blank=True)

    class Meta:
        verbose_name = "Комментарий к баллу"

    def __str__(self):
        return self.comment_text


class Mark(models.Model):
    score = models.IntegerField(default=0)
    score_exam = models.IntegerField(default=0)
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE, blank=True, null=True)
    comment = models.ForeignKey(MarkComment, on_delete=CASCADE, null=True, blank=True)

    class Meta:
        verbose_name = "Баллы тестовые-вторичные"

    def __str__(self):
        return f"{self.subject}: {self.score} → {self.score_exam}"

class SupportInfo(models.Model):
    info_text = CKEditor5Field()
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE, blank=True, null=True)
    
    class Meta:
        verbose_name = "Справочная информация"
    def __str__(self):
        return self.info_text[:50]

class PreviewType(models.Model):
    preview_type_text = models.CharField(max_length=200)

    class Meta:
        verbose_name = "Тип подсказки"
    
    def __str__(self):
        return self.preview_type_text


class TaskPreview(models.Model):
    task_preview_text = CKEditor5Field()
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE, blank=True, null=True)
    part = models.ForeignKey(Part, on_delete=CASCADE, blank=True, null=True)
    preview_type = models.ForeignKey(PreviewType, on_delete=CASCADE, blank=True, null=True)

    class Meta:
        verbose_name = "Текст перед задачами"

# Добавь новую модель SubTopic
class SubTopic(models.Model):
    task_list = models.ForeignKey(
        TaskList,
        on_delete=CASCADE,
        related_name='subtopics'
    )
    title = models.CharField(max_length=100)
    order = models.IntegerField(default=0)

    class Meta:
        verbose_name = "Подтемы"
        ordering = ['order', 'title']
        unique_together = [('task_list', 'title')]

    def __str__(self):
        return self.title


class Update(models.Model):
    """Обновления платформы: заголовок, краткое описание и время добавления."""
    SHOW_CHOICES = [
        (True, "Показывать"),
        (False, "Скрыть"),
    ]
    title = models.CharField(verbose_name="Заголовок", max_length=255)
    description = models.TextField(verbose_name="Краткое описание", blank=True)
    created = models.DateTimeField(
        verbose_name="Время добавления",
        auto_now_add=True,
        editable=False,
    )
    show = models.BooleanField(
        verbose_name="Статус показа",
        default=True,
        choices=SHOW_CHOICES,
        help_text="Показывать это обновление пользователям",
    )

    class Meta:
        verbose_name = "Обновление"
        verbose_name_plural = "Обновления"
        ordering = ["-created"]

    def __str__(self):
        return f"{self.created.strftime('%Y-%m-%d %H:%M')}: {self.title}"