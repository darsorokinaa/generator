"""
Проверка, почему задание 19 ЕГЭ математика не отображается.
Запуск: python manage.py check_task19
"""
from django.core.management.base import BaseCommand
from Generator.models import (
    TaskList, Level, Subject,
    LinkedTaskGroup, TaskGroup, TaskGroupMember, Task
)


class Command(BaseCommand):
    help = "Диагностика задания 19 ЕГЭ математика"

    def handle(self, *args, **options):
        level = Level.objects.filter(level="ege").first()
        subject = Subject.objects.filter(subject_short="math").first()
        if not level or not subject:
            self.stdout.write("ОГЭ/ЕГЭ или математика не найдены в БД")
            return

        # TaskList для задания 19
        t19 = TaskList.objects.filter(
            level=level, subject=subject, task_number=19
        ).first()
        if not t19:
            self.stdout.write(self.style.ERROR(
                "TaskList для задания 19 ЕГЭ математика НЕ НАЙДЕН в БД!"
            ))
            return

        self.stdout.write(f"TaskList 19 найден: id={t19.id}, part={t19.part_id}")

        # Количество задач в банке
        task_count = Task.objects.filter(task=t19).count()
        self.stdout.write(f"Задач в банке для TaskList {t19.id}: {task_count}")

        # LinkedTaskGroup
        linked = LinkedTaskGroup.objects.filter(
            level=level, subject=subject
        ).first()
        if linked:
            self.stdout.write(f"LinkedTaskGroup: task_numbers={linked.task_numbers}")
            id_by_num = {
                tl.task_number: tl.id
                for tl in TaskList.objects.filter(level=level, subject=subject)
            }
            ids_for_group = [id_by_num.get(n) for n in (linked.task_numbers or [])]
            missing = [n for n, i in zip(linked.task_numbers or [], ids_for_group) if i is None]
            if missing:
                self.stdout.write(self.style.WARNING(
                    f"  В LinkedTaskGroup нет TaskList для номеров: {missing}"
                ))
                self.stdout.write(
                    "  → Связанная группа пропускается, задание 19 должно быть одиночным"
                )
        else:
            self.stdout.write("LinkedTaskGroup для ЕГЭ мат: нет")

        # TaskGroup с заданием 19
        groups_with_19 = TaskGroup.objects.filter(
            level=level, subject=subject,
            taskgroupmember__task_number=19
        ).distinct()
        for g in groups_with_19:
            members = TaskGroupMember.objects.filter(task_group=g).order_by("task_number")
            nums = [m.task_number for m in members]
            self.stdout.write(f"TaskGroup {g.id}: номера {nums}")

        self.stdout.write(self.style.SUCCESS("\nПроверка завершена."))
