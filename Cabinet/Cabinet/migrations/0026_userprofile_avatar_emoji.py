from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0025_remove_unused_models'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='avatar_emoji',
            field=models.CharField(blank=True, default='', max_length=16, null=True),
        ),
    ]
