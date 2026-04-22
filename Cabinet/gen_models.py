"""
Read-only зеркало моделей из БД Генератора (01 generator / generatordb).
Все модели unmanaged=True — Django не трогает схему этой БД.
Запросы: Model.objects.using('generator').filter(...)
"""
from django.db import models


class GenLevel(models.Model):
    level     = models.CharField(max_length=10)
    level_rus = models.CharField(max_length=50, default='')

    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_level'

    def __str__(self):
        return self.level


class GenSubject(models.Model):
    subject_short = models.CharField(max_length=50)
    subject_name  = models.CharField(max_length=200)

    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_subject'

    def __str__(self):
        return self.subject_short


class GenPart(models.Model):
    """Часть экзамена (Часть 1 / Часть 2)"""
    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_part'


class GenTaskList(models.Model):
    subject      = models.ForeignKey(GenSubject, on_delete=models.DO_NOTHING, db_constraint=False)
    level        = models.ForeignKey(GenLevel,   on_delete=models.DO_NOTHING, db_constraint=False)
    part         = models.ForeignKey(GenPart,    on_delete=models.DO_NOTHING, db_constraint=False, null=True, blank=True)
    task_number  = models.IntegerField()
    task_title   = models.CharField(max_length=100)
    max_score    = models.IntegerField(default=1)
    subdivision  = models.CharField(max_length=20, default='')

    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_tasklist'

    def __str__(self):
        return f'{self.task_number}: {self.task_title}'


class GenSubTopic(models.Model):
    task_list    = models.ForeignKey(GenTaskList, on_delete=models.DO_NOTHING, db_constraint=False)
    title        = models.CharField(max_length=100)
    order        = models.IntegerField(default=0)

    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_subtopic'

    def __str__(self):
        return self.title


class GenTask(models.Model):
    task          = models.ForeignKey(GenTaskList,  on_delete=models.DO_NOTHING, db_constraint=False, null=True, blank=True)
    subtopic      = models.ForeignKey(GenSubTopic,  on_delete=models.DO_NOTHING, db_constraint=False, null=True, blank=True)
    task_template = models.TextField()
    answer        = models.TextField(blank=True)
    max_score     = models.IntegerField(default=1)
    added_at      = models.DateTimeField(null=True)
    created_by    = models.CharField(max_length=100, default='ADMIN')

    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_task'

    def __str__(self):
        return f'Task #{self.id}'


class GenVariant(models.Model):
    var_subject = models.ForeignKey(GenSubject, on_delete=models.DO_NOTHING, db_constraint=False)
    level       = models.ForeignKey(GenLevel,   on_delete=models.DO_NOTHING, db_constraint=False)
    created_at  = models.DateTimeField(null=True)
    created_by  = models.CharField(max_length=100, default='ADMIN')
    share_token = models.CharField(max_length=20, null=True, blank=True)
    content     = models.JSONField(null=True, blank=True)

    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_variant'

    def __str__(self):
        return f'Variant #{self.id}'


class GenVariantContent(models.Model):
    variant = models.ForeignKey(GenVariant, on_delete=models.DO_NOTHING, db_constraint=False)
    task    = models.ForeignKey(GenTask,    on_delete=models.DO_NOTHING, db_constraint=False)
    order   = models.IntegerField()

    class Meta:
        managed   = False
        app_label = 'Cabinet'
        db_table  = 'Generator_variantcontent'
        ordering  = ['order']
