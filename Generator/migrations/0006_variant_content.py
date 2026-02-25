# Generated manually for Variant.content

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Generator', '0005_alter_task_task_template'),
    ]

    operations = [
        migrations.AddField(
            model_name='variant',
            name='content',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
