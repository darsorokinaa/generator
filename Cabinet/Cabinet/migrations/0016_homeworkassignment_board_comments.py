from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0015_homeworkteacherfeedbackfile'),
    ]

    operations = [
        migrations.AddField(
            model_name='homeworkassignment',
            name='task_teacher_comments',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='homeworkassignment',
            name='whiteboard_strokes',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
