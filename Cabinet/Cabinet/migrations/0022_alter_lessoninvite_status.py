# Generated manually for scheduled lesson invite status

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0021_alter_lessoninvite_lesson_link'),
    ]

    operations = [
        migrations.AlterField(
            model_name='lessoninvite',
            name='status',
            field=models.CharField(
                choices=[
                    ('scheduled', 'Учитель ещё не в комнате'),
                    ('pending', 'Ожидает'),
                    ('accepted', 'Принято'),
                    ('expired', 'Истекло'),
                    ('cancelled', 'Отменено'),
                ],
                default='pending',
                max_length=20,
            ),
        ),
    ]
