from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0012_alter_studentshomework_options_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='homeworkassignment',
            name='status',
            field=models.CharField(
                choices=[
                    ('sent',      'Задано'),
                    ('submitted', 'Сдано на проверку'),
                    ('reviewing', 'На проверке'),
                    ('reviewed',  'Проверено'),
                    ('revision',  'На доработке'),
                    ('overdue',   'Просрочено'),
                    ('cancelled', 'Отменено'),
                ],
                default='sent',
                max_length=20,
            ),
        ),
    ]
