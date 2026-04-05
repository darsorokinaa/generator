from django.db import migrations

SUBJECTS = [
    'Математика', 'Алгебра', 'Геометрия',
    'Физика', 'Химия', 'Биология',
    'Информатика', 'История', 'Обществознание',
    'Русский язык', 'Литература', 'Английский язык',
    'География', 'Экономика',
]


def populate(apps, schema_editor):
    Subject = apps.get_model('Cabinet', 'Subject')
    Subject.objects.bulk_create(
        [Subject(subject_name=s) for s in SUBJECTS],
        ignore_conflicts=True,
    )


def depopulate(apps, schema_editor):
    Subject = apps.get_model('Cabinet', 'Subject')
    Subject.objects.filter(subject_name__in=SUBJECTS).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0004_populate_funny_words'),
    ]

    operations = [
        migrations.RunPython(populate, depopulate),
    ]
