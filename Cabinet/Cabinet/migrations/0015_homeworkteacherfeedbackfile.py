import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0014_homeworkanswerfile_task_number'),
    ]

    operations = [
        migrations.CreateModel(
            name='HomeworkTeacherFeedbackFile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to='homework_teacher_feedback/')),
                ('filename', models.CharField(max_length=255)),
                ('file_type', models.CharField(choices=[('image', 'Изображение'), ('video', 'Видео'), ('audio', 'Аудио'), ('file', 'Файл')], default='file', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('assignment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='teacher_feedback_files', to='Cabinet.homeworkassignment')),
                ('source_answer_file', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='teacher_feedback_exports', to='Cabinet.homeworkanswerfile')),
            ],
            options={
                'verbose_name': 'Вложение учителя к проверке ДЗ',
                'verbose_name_plural': 'Вложения учителя к проверке ДЗ',
                'ordering': ['created_at'],
            },
        ),
    ]
