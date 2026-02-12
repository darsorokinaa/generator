from django.db import models
from django.db.models import DO_NOTHING, CASCADE
from datetime import datetime
import os
from uuid import uuid4

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


class Task(models.Model):
    task = models.ForeignKey(TaskList, on_delete=CASCADE)
    task_text = models.TextField(max_length=4000)
    added_at = models.DateTimeField(default=datetime.today)

    def __str__(self):
        return f'{self.id}: {self.task_text[:100]}'
    
class TaskImage(models.Model):
    task = models.ForeignKey(Task, on_delete=CASCADE, related_name='images')
    task_img = models.ImageField(upload_to=task_url)

    def __str__(self):
        return f'{self.task.task.subject} {self.task.task.level} {self.task.task.id}'

class Variant(models.Model):
    var_subject = models.ForeignKey(Subject, on_delete=CASCADE)
    created_at = models.DateTimeField(default=datetime.today)
    created_by = models.CharField(default='ADMIN')

    def __str__(self):
        return f'{self.var_subject}: {self.id}'
    

class VariantContent(models.Model):
    var_number = models.ForeignKey(Variant, on_delete=CASCADE)
    task_number = models.ForeignKey(Task, on_delete=CASCADE)
    
    def __str__(self):
        return str(self.id)