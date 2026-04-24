from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Cabinet', '0029_studentlessonreport'),
    ]

    operations = [
        migrations.AlterField(
            model_name='studentlessonreport',
            name='assignment',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=models.deletion.CASCADE,
                related_name='lesson_report',
                to='Cabinet.homeworkassignment',
            ),
        ),
        migrations.AddField(
            model_name='studentlessonreport',
            name='lesson_token',
            field=models.CharField(blank=True, default='', max_length=2048),
        ),
        migrations.AddField(
            model_name='studentlessonreport',
            name='report_kind',
            field=models.CharField(
                choices=[('homework', 'Домашнее задание'), ('lesson', 'Урок')],
                default='homework',
                max_length=20,
            ),
        ),
    ]
