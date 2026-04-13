from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0010_homework_full'),
    ]

    operations = [
        migrations.AddField(
            model_name='homeworkassignment',
            name='result',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='homeworkassignment',
            name='score',
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
