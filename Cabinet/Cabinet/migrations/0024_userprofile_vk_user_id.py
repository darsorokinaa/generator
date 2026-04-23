from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0023_homeworkassignment_room_revision'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='vk_user_id',
            field=models.CharField(
                blank=True,
                db_index=True,
                max_length=32,
                null=True,
                unique=True,
                verbose_name='VK ID',
            ),
        ),
    ]
