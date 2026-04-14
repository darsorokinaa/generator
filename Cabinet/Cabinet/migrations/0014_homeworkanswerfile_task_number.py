from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0013_cancelled_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='homeworkanswerfile',
            name='task_number',
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
