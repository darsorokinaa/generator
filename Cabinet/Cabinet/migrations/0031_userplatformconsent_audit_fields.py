from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0030_studentlessonreport_lesson_support'),
    ]

    operations = [
        migrations.AddField(
            model_name='userplatformconsent',
            name='checkbox_label',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='userplatformconsent',
            name='document_url',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
        migrations.AddField(
            model_name='userplatformconsent',
            name='ip_address',
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='userplatformconsent',
            name='user_agent',
            field=models.TextField(blank=True, default=''),
        ),
    ]
