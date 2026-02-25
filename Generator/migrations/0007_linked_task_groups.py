# Linked task groups (e.g. 19-21 EGE Informatics)

from django.db import migrations, models
import django.db.models.deletion


def create_inf_ege_19_21_group(apps, schema_editor):
    """Создаём определение связанной группы 19–21 для ЕГЭ информатика."""
    LinkedTaskGroup = apps.get_model("Generator", "LinkedTaskGroup")
    Subject = apps.get_model("Generator", "Subject")
    Level = apps.get_model("Generator", "Level")
    subject = Subject.objects.filter(subject_short="inf").first()
    level = Level.objects.filter(level="ege").first()
    if subject and level and not LinkedTaskGroup.objects.filter(subject=subject, level=level).exists():
        LinkedTaskGroup.objects.create(subject=subject, level=level, task_numbers=[19, 20, 21])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('Generator', '0006_variant_content'),
    ]

    operations = [
        migrations.CreateModel(
            name='LinkedTaskGroup',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('task_numbers', models.JSONField(default=list)),
                ('level', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='Generator.level')),
                ('subject', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='Generator.subject')),
            ],
            options={
                'verbose_name': 'Связанная группа номеров',
                'unique_together': {('subject', 'level')},
            },
        ),
        migrations.CreateModel(
            name='TaskGroup',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('level', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='Generator.level')),
                ('subject', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='Generator.subject')),
            ],
            options={
                'verbose_name': 'Группа заданий',
            },
        ),
        migrations.CreateModel(
            name='TaskGroupMember',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('task_number', models.IntegerField()),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='Generator.task')),
                ('task_group', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='Generator.taskgroup')),
            ],
            options={
                'verbose_name': 'Задание в группе',
                'ordering': ['task_number'],
                'unique_together': {('task_group', 'task_number')},
            },
        ),
        migrations.RunPython(create_inf_ege_19_21_group, noop),
    ]
