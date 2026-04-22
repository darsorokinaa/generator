from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0022_alter_lessoninvite_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='homeworkassignment',
            name='homework_room_token',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='homeworkassignment',
            name='homework_room_id',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='homeworkassignment',
            name='revision_task_ids',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
