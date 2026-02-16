from django.db import models
from django.db.models import DO_NOTHING, CASCADE
from datetime import datetime
import os
from uuid import uuid4
from ckeditor.fields import RichTextField


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
    level = models.CharField(max_length=10)
    def __str__(self):
        return self.level
    

class Subject(models.Model):
    subject_short = models.CharField(max_length=50)
    subject_name = models.CharField(max_length=200)

    def __str__(self):
        return self.subject_short


class TaskList(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    task_number = models.IntegerField()
    task_title = models.CharField(max_length=100)

    def __str__(self):
        return f'{self.subject}: {self.task_number} - {self.task_title}'

# Банк задач
class Task(models.Model):
    task = models.ForeignKey(TaskList, on_delete=CASCADE, null=True)
    task_template = RichTextField()

    answer = models.TextField(max_length=500)
    
    added_at = models.DateTimeField(default=datetime.today)
    created_by =models.CharField(default='ADMIN')

    def __str__(self):
        return f'{self.id}: {self.task_template[:100]}'
    

class Variant(models.Model):
    var_subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    created_at = models.DateTimeField(default=datetime.today)
    created_by = models.CharField(default='ADMIN')
    share_token = models.CharField(max_length=20, blank=True, null=True)
    def __str__(self):
        return f'Вариант {self.id} -  {self.var_subject}: {self.level}'
    

class VariantContent(models.Model):
    variant = models.ForeignKey(Variant, on_delete=CASCADE)
    task = models.ForeignKey(Task, on_delete=CASCADE)
    order = models.IntegerField()

    class Meta:
        ordering = ['order']

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

class ExcalidrawBoard(models.Model):
    variant = models.OneToOneField(Variant, on_delete=models.CASCADE, related_name='excalidraw_board')
    elements = models.JSONField(default=list, blank=True)
    app_state = models.JSONField(default=dict, blank=True)
    files = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
