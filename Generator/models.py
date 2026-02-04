from django.db import models
from django.db.models import DO_NOTHING


class Subject(models.Model):
    subject_short = models.CharField(max_length=50)
    subject_name = models.CharField(max_length=200)

    def __str__(self):
        return self.subject_short


class TaskList(models.Model):
    subject = models.ForeignKey(Subject, on_delete=DO_NOTHING)
    task_number = models.IntegerField()
    task_title = models.CharField(max_length=100)

    def __str__(self):
        return f'{self.subject}: {self.task_number} - {self.task_title}'


class Task(models.Model):
    task = models.ForeignKey(TaskList, on_delete=DO_NOTHING)
    task_text = models.TextField(max_length=4000)

    def __str__(self):
        return f'{self.id}: {self.task_text[:100]}'