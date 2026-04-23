from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0026_userprofile_avatar_emoji'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='avatar_bg',
            field=models.CharField(blank=True, default='', max_length=32, null=True),
        ),
    ]
