from django.db import migrations

LEVELS = ['ОГЭ', 'ЕГЭ']


def populate(apps, schema_editor):
    Level = apps.get_model('Cabinet', 'Level')
    for name in LEVELS:
        Level.objects.get_or_create(level=name)


def depopulate(apps, schema_editor):
    Level = apps.get_model('Cabinet', 'Level')
    Level.objects.filter(level__in=LEVELS).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0008_userprofile_birth_date_userprofile_gender'),
    ]

    operations = [
        migrations.RunPython(populate, depopulate),
    ]
