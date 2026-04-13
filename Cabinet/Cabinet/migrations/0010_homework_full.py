from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0009_populate_levels'),
    ]

    operations = [
        # 1. Extend Homework
        migrations.AddField(
            model_name='homework',
            name='title',
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name='homework',
            name='subject',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AlterModelOptions(
            name='homework',
            options={'ordering': ['-created_at'], 'verbose_name': 'Домашнее задание', 'verbose_name_plural': 'Домашние задания'},
        ),

        # 2. HomeworkAttachment
        migrations.CreateModel(
            name='HomeworkAttachment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to='homework_attachments/')),
                ('filename', models.CharField(max_length=255)),
                ('file_type', models.CharField(
                    choices=[('image', 'Изображение'), ('video', 'Видео'), ('audio', 'Аудио'), ('file', 'Файл')],
                    default='file', max_length=10,
                )),
                ('homework', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='attachments',
                    to='Cabinet.homework',
                )),
            ],
            options={'verbose_name': 'Вложение к ДЗ', 'verbose_name_plural': 'Вложения к ДЗ'},
        ),

        # 3. HomeworkAssignment
        migrations.CreateModel(
            name='HomeworkAssignment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(
                    choices=[
                        ('sent', 'Задано'), ('submitted', 'Сдано на проверку'),
                        ('reviewing', 'На проверке'), ('reviewed', 'Проверено'),
                        ('revision', 'На доработке'), ('overdue', 'Просрочено'),
                    ],
                    default='sent', max_length=20,
                )),
                ('teacher_comment', models.TextField(blank=True)),
                ('submitted_at', models.DateTimeField(blank=True, null=True)),
                ('reviewed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('homework', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='assignments',
                    to='Cabinet.homework',
                )),
                ('student', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='hw_assignments',
                    to='Cabinet.userprofile',
                )),
            ],
            options={
                'verbose_name': 'Назначение ДЗ',
                'verbose_name_plural': 'Назначения ДЗ',
                'ordering': ['-created_at'],
                'unique_together': {('homework', 'student')},
            },
        ),

        # 4. HomeworkAnswerFile
        migrations.CreateModel(
            name='HomeworkAnswerFile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to='homework_answers/')),
                ('filename', models.CharField(max_length=255)),
                ('file_type', models.CharField(
                    choices=[('image', 'Изображение'), ('video', 'Видео'), ('audio', 'Аудио'), ('file', 'Файл')],
                    default='file', max_length=10,
                )),
                ('annotations', models.JSONField(blank=True, default=list)),
                ('uploaded_at', models.DateTimeField(auto_now_add=True)),
                ('assignment', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='answer_files',
                    to='Cabinet.homeworkassignment',
                )),
            ],
            options={'verbose_name': 'Файл ответа на ДЗ', 'verbose_name_plural': 'Файлы ответов на ДЗ', 'ordering': ['uploaded_at']},
        ),

        # 5. Extend Notification: new types, read default, homework_assignment FK, created_at
        migrations.AlterField(
            model_name='notification',
            name='notification_type',
            field=models.CharField(
                choices=[
                    ('submitted', 'Сдал на проверку'),
                    ('check_deadline_soon', 'Подходит срок проверки'),
                    ('low_result_alert', 'Низкие результаты'),
                    ('missed', 'Не сдал в срок'),
                    ('homework_assigned', 'Новое домашнее задание'),
                    ('reviewed', 'ДЗ проверено'),
                    ('revision_requested', 'ДЗ направлено на доработку'),
                ],
                max_length=25,
            ),
        ),
        migrations.AlterField(
            model_name='notification',
            name='read',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='notification',
            name='text',
            field=models.CharField(max_length=500),
        ),
        migrations.AddField(
            model_name='notification',
            name='homework_assignment',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='notifications',
                to='Cabinet.homeworkassignment',
            ),
        ),
        migrations.AddField(
            model_name='notification',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
    ]
