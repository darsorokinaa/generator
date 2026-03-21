"""API and PDF views — React SPA."""
import json
import logging
import os
import re
import secrets
from datetime import datetime

from django.conf import settings as django_settings
from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from weasyprint import HTML as WeasyHTML

from .models import (
    Level,
    LinkedTaskGroup,
    Mark,
    Subject,
    SubTopic,
    SupportInfo,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    Update,
    Variant,
    VariantContent,
)
from .latex_utils import process_latex
from . import pdf_utils
from . import telegram_utils

logger = logging.getLogger(__name__)

ERROR_TYPE_LABELS = {
    "typo": "Опечатка",
    "wrong_condition": "Неверное условие",
    "wrong_answer": "Не сходится ответ",
    "other": "Другое",
}

FAVICON_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
    b'<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">'
    b'<feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.18"/>'
    b'</filter></defs>'
    b'<rect width="1024" height="1024" fill="#2F6FFF"/>'
    b'<rect x="200" y="200" width="624" height="624" rx="140" fill="#5F8FFF" filter="url(#shadow)"/>'
    b'<path d="M660 340H420L560 512L420 684H660" fill="none" stroke="#FFFFFF" stroke-width="88" '
    b'stroke-linecap="round" stroke-linejoin="round"/></svg>'
)


def _subtopics_for_groups(subject_instance, level_instance, task_numbers):
    """Подтемы для групп: TaskGroup.subtopic + Task.subtopic + все SubTopic предмета/уровня."""
    if not task_numbers:
        return []
    matching_ids = (
        TaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
            taskgroupmember__task_number__in=task_numbers,
        )
        .annotate(mcnt=Count("taskgroupmember"))
        .filter(mcnt=len(task_numbers))
        .values_list("id", flat=True)
        .distinct()
    )
    group_ids = list(matching_ids)
    from django.db.models import Count as DbCount

    by_sid = {}

    # 1) По TaskGroup.subtopic (пропускаем sid=None) — только если есть группы
    if group_ids:
        for row in (
            TaskGroup.objects.filter(id__in=group_ids)
            .values("subtopic_id")
            .annotate(cnt=DbCount("id"))
        ):
            sid = row["subtopic_id"]
            if sid is None:
                continue
            cnt = row["cnt"]
            st = SubTopic.objects.filter(id=sid).values_list("title", flat=True).first()
            by_sid[sid] = {"id": sid, "title": st or f"Подтема {sid}", "group_count": cnt, "display_count": cnt}

    # 2) Подтемы из Task.subtopic в группах (только если есть группы)
    if group_ids:
        for row in (
            TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__subtopic_id__isnull=False,
            )
            .values("task__subtopic_id")
            .annotate(cnt=DbCount("task_group_id", distinct=True))
        ):
            sid = row["task__subtopic_id"]
            if not sid:
                continue
            cnt = row["cnt"]
            if sid not in by_sid:
                st = SubTopic.objects.filter(id=sid).values_list("title", flat=True).first()
                by_sid[sid] = {"id": sid, "title": st or f"Подтема {sid}", "group_count": cnt, "display_count": cnt}
            else:
                by_sid[sid]["group_count"] = max(by_sid[sid]["group_count"], cnt)
                by_sid[sid]["display_count"] = max(by_sid[sid]["display_count"], cnt)

    # 3) Все SubTopic предмета/уровня — TaskList для наших номеров
    tasklist_ids = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
            task_number__in=task_numbers,
        ).values_list("id", flat=True)
    )
    for st in SubTopic.objects.filter(task_list_id__in=tasklist_ids).order_by("order", "title"):
        if st.id not in by_sid:
            cnt = TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__subtopic_id=st.id,
            ).values("task_group_id").distinct().count()
            task_cnt = Task.objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                task__task_number__in=task_numbers,
                subtopic_id=st.id,
            ).count()
            display_count = cnt if cnt > 0 else max(0, task_cnt // len(task_numbers))
            by_sid[st.id] = {"id": st.id, "title": st.title, "group_count": cnt, "display_count": display_count}

    # 4) Если всё ещё пусто — все SubTopic предмета/уровня (на случай разных частей)
    if not by_sid:
        all_tls = TaskList.objects.filter(
            subject=subject_instance, level=level_instance
        ).values_list("id", flat=True)
        for st in SubTopic.objects.filter(task_list_id__in=all_tls).order_by("order", "title")[:20]:
            cnt = TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__subtopic_id=st.id,
            ).values("task_group_id").distinct().count()
            task_cnt = Task.objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                subtopic_id=st.id,
            ).count()
            n_per_group = len(task_numbers)
            display_count = cnt if cnt > 0 else max(0, task_cnt // n_per_group)
            by_sid[st.id] = {"id": st.id, "title": st.title, "group_count": cnt, "display_count": display_count}

    return sorted(by_sid.values(), key=lambda x: (-x["group_count"], x["title"]))


def _normalize_content(data):
    if not isinstance(data, dict):
        return {}
    result = {}
    for k, v in data.items():
        if isinstance(v, dict):
            continue
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n > 0:
            result[str(k)] = n
    return result


def favicon(request):
    return HttpResponse(FAVICON_SVG, content_type='image/svg+xml')


def react_app(request):
    frontend_dir = getattr(django_settings, 'FRONTEND_DIR', django_settings.BASE_DIR.parent / 'frontend' / 'dist')
    index_path = frontend_dir / 'index.html'
    if index_path.exists():
        with open(index_path, 'r', encoding='utf-8') as f:
            return HttpResponse(f.read(), content_type='text/html')
    return HttpResponse(
        "<div><h1>Frontend не собран</h1><p>Запусти <code>npm run build</code> в frontend/</p></div>",
        status=500,
    )


# Фильтр ФИПИ: автор пустой, 'ФИПИ' или содержит любое из этих слов (без учёта регистра)
_FIPI_AUTHOR_KEYWORDS = [
    "фипи", "fipi", "егкр", "егэ", "апробация", "открытый вариант", "открытый",
    "демоверсия", "демо", "досрочный",
]


def _get_fipi_q():
    """Единый фильтр ФИПИ: автор пустой, или 'ФИПИ', или содержит любое ключевое слово из списка."""
    return (
        Q(author__isnull=True)
        | Q(author__exact="")
        | Q(author__iexact="ФИПИ")
        | Q(author__icontains="фипи")
        | Q(author__icontains="fipi")
        | Q(author__icontains="ЕГКР")
        | Q(author__icontains="егэ")
        | Q(author__icontains="ЕГЭ")
        | Q(author__icontains="Апробация")
        | Q(author__icontains="Открытый вариант")
        | Q(author__icontains="Открытый")
        | Q(author__icontains="демоверсия")
        | Q(author__icontains="Демоверсия")
        | Q(author__icontains="демо")
        | Q(author__icontains="Досрочный")
    )


def _create_variant(subject_short, level_str, body_bytes, create=True):
    subject_instance = get_object_or_404(Subject, subject_short=subject_short)
    level_instance = get_object_or_404(Level, level=level_str)
    data = json.loads(body_bytes)

    # Глобальный флаг "только ФИПИ" (для варианта/теста)
    only_fipi = False
    if isinstance(data, dict):
        only_fipi = bool(data.get("only_fipi"))

    # Унифицированное извлечение content: либо из поля "content", либо из корневого словаря
    if isinstance(data, dict) and "content" in data:
        content = _normalize_content(data["content"])
    else:
        content = _normalize_content(data)
    # Дополнительно: для linked-групп из tasks обеспечиваем нужное кол-во ГРУПП по каждому слоту
    group_subtopic_config = {}  # key: tuple(task_numbers) -> {subtopic_ids, subtopic_counts}
    if isinstance(data, dict) and data.get("tasks"):
        content = dict(content)
        for t in data["tasks"]:
            if isinstance(t, dict):
                nums = tuple(t.get("task_numbers") or [])
                cnt = t.get("count")
                try:
                    cnt = int(cnt) if cnt is not None else 0
                except (TypeError, ValueError):
                    cnt = 0
                if nums and cnt > 0:
                    for n in nums:
                        tl = TaskList.objects.filter(
                            subject=subject_instance,
                            level=level_instance,
                            task_number=n,
                        ).values_list("id", flat=True).first()
                        if tl:
                            key = str(tl)
                            content[key] = max(content.get(key, 0), cnt)
                    # Подтемы для группы: subtopic_ids, subtopic_counts в самом элементе tasks
                    st_ids = t.get("subtopic_ids")
                    st_counts = t.get("subtopic_counts")
                    if st_ids is not None or (st_counts and isinstance(st_counts, dict)):
                        cfg = {}
                        if isinstance(st_ids, list):
                            cfg["subtopic_ids"] = [int(x) for x in st_ids if x is not None and str(x) not in ("", "all")]
                        else:
                            cfg["subtopic_ids"] = []
                        if isinstance(st_counts, dict):
                            cfg["subtopic_counts"] = {}
                            for k, v in st_counts.items():
                                if str(k) == "all":
                                    cfg["subtopic_counts"]["all"] = int(v) if v else 0
                                else:
                                    try:
                                        ki = int(k)
                                        n = int(v) if v else 0
                                        if n > 0:
                                            cfg["subtopic_counts"][ki] = n
                                    except (TypeError, ValueError):
                                        pass
                        else:
                            cfg["subtopic_counts"] = {}
                        if cfg["subtopic_ids"] or cfg["subtopic_counts"]:
                            group_subtopic_config[nums] = cfg
    tasklist_ids = [int(k) for k in content.keys()]
    subtopic_ids = None
    subtopic_counts = None
    if isinstance(data, dict) and data.get("subtopic_ids"):
        raw = data["subtopic_ids"]
        subtopic_ids = [int(x) for x in raw if x is not None and str(x).strip() != ""]
        if not subtopic_ids:
            subtopic_ids = None
    if isinstance(data, dict) and data.get("subtopic_counts") and isinstance(data["subtopic_counts"], dict):
        subtopic_counts = {}
        for k, v in data["subtopic_counts"].items():
            if isinstance(v, dict):
                continue
            try:
                n = int(v)
            except (TypeError, ValueError):
                continue
            if n > 0:
                try:
                    subtopic_counts[int(k)] = n
                except (TypeError, ValueError):
                    pass
        if not subtopic_counts:
            subtopic_counts = None
    if not content:
        raise ValueError("Не выбрано ни одного задания")

    # Тот же фильтр ФИПИ, что и в тренажёре (без учёта подтем)
    fipi_q = _get_fipi_q() if only_fipi else Q()

    tasklist_ids = [int(k) for k in content.keys()]
    # При «Только ФИПИ» дополняем content всеми слотaми предмета/уровня (по 1 задаче), чтобы не терять номера
    if only_fipi:
        all_tls = TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        ).values_list("id", flat=True)
        content = dict(content)
        for tl_id in all_tls:
            if tl_id not in content or content.get(str(tl_id), 0) <= 0:
                content[str(tl_id)] = 1
        tasklist_ids = [int(k) for k in content.keys()]

    ordered_tasklists = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
            id__in=tasklist_ids,
        ).order_by("task_number")
    )
    if not ordered_tasklists:
        raise ValueError("Указанные задания не найдены для этого предмета и уровня")

    id_by_number = {tl.task_number: tl.id for tl in ordered_tasklists}
    selected_tasks = []
    handled_tasklist_ids = set()


    def take_linked_groups(linked):
        """Берём ровно num_groups записей из TaskGroup (группа заданий) для выбранного предмета и уровня."""
        task_numbers = linked.task_numbers or []
        if not task_numbers:
            return None, None
        ids_for_group = [id_by_number.get(n) for n in task_numbers]
        if any(i is None for i in ids_for_group):
            return None, None
        nums_key = tuple(task_numbers)
        cfg = group_subtopic_config.get(nums_key, {})
        st_counts = cfg.get("subtopic_counts") or {}
        st_ids = cfg.get("subtopic_ids") or []

        if st_counts or st_ids:
            # Фильтр по подтемам: собираем группы по каждой подтеме
            base_qs = (
                TaskGroup.objects.filter(
                    subject=subject_instance,
                    level=level_instance,
                    taskgroupmember__task_number__in=task_numbers,
                )
                .annotate(mcnt=Count("taskgroupmember"))
                .filter(mcnt=len(task_numbers))
            )
            all_tasks = []
            required_nums = set(task_numbers)
            if st_counts:
                for sid, cnt in st_counts.items():
                    cnt = int(cnt) if cnt else 0
                    if cnt <= 0:
                        continue
                    if sid == "all":
                        qs = base_qs  # Все типы — без фильтра
                    elif sid is None or str(sid) == "null":
                        qs = base_qs.filter(subtopic__isnull=True)  # Без подтемы
                    else:
                        # TaskGroup.subtopic или Task.subtopic у любого задания в группе
                        qs = base_qs.filter(
                            Q(subtopic_id=sid)
                            | Q(taskgroupmember__task__subtopic_id=sid)
                        ).distinct()
                    limit = max(cnt * 10, 50)
                    added = 0
                    for group in qs.order_by("?")[:limit]:
                        if added >= cnt:
                            break
                        members = list(
                            TaskGroupMember.objects.filter(task_group=group).order_by("task_number")
                        )
                        if len(members) != len(task_numbers) or {m.task_number for m in members} != required_nums:
                            continue
                        all_tasks.extend(m.task for m in members)
                        added += 1
            elif st_ids:
                num_groups = min(content.get(str(i), 0) for i in ids_for_group)
                num_groups = int(num_groups)
                if num_groups > 0:
                    qs = base_qs.filter(
                        Q(subtopic_id__in=st_ids)
                        | Q(taskgroupmember__task__subtopic_id__in=st_ids)
                    ).distinct().order_by("?")[:max(num_groups * 10, 50)]
                    for group in qs:
                        if len(all_tasks) >= num_groups * len(task_numbers):
                            break
                        members = list(
                            TaskGroupMember.objects.filter(task_group=group).order_by("task_number")
                        )
                        if len(members) != len(task_numbers) or {m.task_number for m in members} != required_nums:
                            continue
                        all_tasks.extend(m.task for m in members)
            if all_tasks:
                return all_tasks, ids_for_group
            # Fallback: групп нет, но есть отдельные задачи с подтемой — собираем из Task
            if st_counts:
                from random import shuffle
                fallback_tasks = []
                for sid, cnt in st_counts.items():
                    cnt = int(cnt) if cnt else 0
                    if cnt <= 0 or sid in ("all", None) or str(sid) == "null":
                        continue
                    # По каждому task_number — cnt задач с subtopic_id
                    tasks_per_num = []
                    for i, tn in enumerate(task_numbers):
                        tl_id = ids_for_group[i] if i < len(ids_for_group) else None
                        if not tl_id:
                            tasks_per_num.append([])
                            continue
                        pool = list(
                            Task.objects.filter(
                                task_id=tl_id,
                                subtopic_id=sid,
                            ).values_list("id", flat=True)
                        )
                        shuffle(pool)
                        tasks_per_num.append(pool[:cnt])
                    # Собираем группы: группа j = tasks_per_num[0][j], tasks_per_num[1][j], ...
                    min_len = min(len(p) for p in tasks_per_num) if tasks_per_num else 0
                    if min_len > 0:
                        ordered_ids = []
                        for j in range(min_len):
                            for pool in tasks_per_num:
                                if j < len(pool):
                                    ordered_ids.append(pool[j])
                        task_by_id = {t.id: t for t in Task.objects.filter(id__in=ordered_ids)}
                        fallback_tasks.extend(task_by_id[i] for i in ordered_ids if i in task_by_id)
                if fallback_tasks:
                    return fallback_tasks, ids_for_group
            return None, None
        # Без фильтра по подтемам
        num_groups = min(content.get(str(i), 0) for i in ids_for_group)
        num_groups = int(num_groups)
        if num_groups <= 0:
            return None, None
        limit = max(num_groups * 10, 50)
        groups_qs = (
            TaskGroup.objects.filter(
                subject=subject_instance,
                level=level_instance,
                taskgroupmember__task_number__in=task_numbers,
            )
            .annotate(mcnt=Count("taskgroupmember"))
            .filter(mcnt=len(task_numbers))
            .order_by("?")[:limit]
        )
        all_tasks = []
        required_nums = set(task_numbers)
        for group in groups_qs:
            if len(all_tasks) >= num_groups * len(task_numbers):
                break
            members = list(
                TaskGroupMember.objects.filter(task_group=group).order_by("task_number")
            )
            if len(members) != len(task_numbers):
                continue
            member_nums = {m.task_number for m in members}
            if member_nums != required_nums:
                continue
            all_tasks.extend(m.task for m in members)
            if len(all_tasks) >= num_groups * len(task_numbers):
                break
        if len(all_tasks) < num_groups * len(task_numbers):
            return None, None
        return all_tasks, ids_for_group

    linked_defs = list(
        LinkedTaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
    )

    for tasklist in ordered_tasklists:
        tasklist_id = tasklist.id
        if tasklist_id in handled_tasklist_ids:
            continue
        count = content.get(str(tasklist_id), 0)
        if count <= 0:
            continue
        group_tasks, group_ids = None, None
        linked_for_slot = None
        for linked in linked_defs:
            nums = linked.task_numbers or []
            if nums and nums[0] == tasklist.task_number:
                linked_for_slot = linked
                group_tasks, group_ids = take_linked_groups(linked)
                break
        if linked_for_slot and group_tasks is None and group_ids is None:
            ids_for_linked = [id_by_number.get(n) for n in (linked_for_slot.task_numbers or [])]
            if all(i is not None for i in ids_for_linked):
                handled_tasklist_ids.update(ids_for_linked)
            continue
        if group_tasks is not None and group_ids is not None:
            # Для связанных групп: подтемы не используются, показываем все задачи по группам
            if only_fipi and fipi_q:
                task_numbers = []
                for linked in linked_defs:
                    nums = linked.task_numbers or []
                    if nums and nums[0] == tasklist.task_number:
                        task_numbers = nums
                        break
                n_per_group = len(task_numbers) if task_numbers else len(group_ids)
                fipi_ids = set(
                    Task.objects.filter(id__in=[t.id for t in group_tasks]).filter(fipi_q).values_list("id", flat=True)
                )
                for i in range(0, len(group_tasks), n_per_group):
                    chunk = group_tasks[i : i + n_per_group]
                    if len(chunk) == n_per_group and all(t.id in fipi_ids for t in chunk):
                        selected_tasks.extend(chunk)
            else:
                selected_tasks.extend(group_tasks)
            handled_tasklist_ids.update(group_ids)
            continue
        # Одиночные задания: берём случайные задачи (фильтр по подтемам только для групп)
        qs = Task.objects.filter(task_id=tasklist_id)
        if only_fipi and fipi_q:
            qs = qs.filter(fipi_q)
        tasks_for_slot = list(qs.order_by("?")[: int(count)])
        selected_tasks.extend(tasks_for_slot)

    if create:
        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by="ADMIN",
            share_token=secrets.token_urlsafe(12),
            content=content or {},
        )
        VariantContent.objects.bulk_create([
            VariantContent(variant=new_variant, task=task, order=index)
            for index, task in enumerate(selected_tasks, start=1)
        ])
        return new_variant
    return selected_tasks


@ensure_csrf_cookie
def api_csrf(request):
    return JsonResponse({"detail": "CSRF cookie set"})


def api_tasks(request, level, subject):
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)

    subtopic_ids = None
    if request.GET.get("subtopic_ids"):
        raw = request.GET.get("subtopic_ids", "").strip().split(",")
        subtopic_ids = [int(x) for x in raw if x.strip().isdigit()]
        if not subtopic_ids:
            subtopic_ids = None

    tasks_qs = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        ).annotate(count_task=Count("task")).order_by('task_number')
    )
    if subtopic_ids:
        id_to_count = dict(
            Task.objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                subtopic_id__in=subtopic_ids,
            )
            .values("task_id")
            .annotate(c=Count("id"))
            .values_list("task_id", "c")
        )
        for t in tasks_qs:
            t.count_task = id_to_count.get(t.id, 0)
    id_by_number = {tl.task_number: tl.id for tl in tasks_qs}
    tl_by_id = {tl.id: tl for tl in tasks_qs}

    linked_defs = list(
        LinkedTaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
    )

    # Collect all task_numbers from linked groups to batch-count in one query
    linked_number_sets = []
    for linked in linked_defs:
        task_numbers = linked.task_numbers or []
        if not task_numbers:
            continue
        ids_for_group = [id_by_number.get(n) for n in task_numbers]
        if any(i is None for i in ids_for_group):
            continue
        linked_number_sets.append((linked, task_numbers, ids_for_group))

    # Batch count available groups for all linked defs in one query per unique set
    linked_counts = {}
    for linked, task_numbers, ids_for_group in linked_number_sets:
        key = tuple(task_numbers)
        if key not in linked_counts:
            matching_ids = (
                TaskGroup.objects.filter(
                    subject=subject_instance,
                    level=level_instance,
                    taskgroupmember__task_number__in=task_numbers,
                )
                .annotate(mcnt=Count("taskgroupmember"))
                .filter(mcnt=len(task_numbers))
                .values_list("id", flat=True)
                .distinct()
            )
            linked_counts[key] = matching_ids.count()

    linked_tasklist_ids = set()
    linked_group_items = []

    for linked, task_numbers, ids_for_group in linked_number_sets:
        key = tuple(task_numbers)
        groups_count = linked_counts.get(key, 0)
        subtopics = _subtopics_for_groups(subject_instance, level_instance, task_numbers)
        # Показываем linked_group, если есть группы ИЛИ подтемы с задачами (display_count > 0)
        has_subtopics_with_tasks = any((s.get("display_count") or 0) > 0 for s in subtopics)
        if groups_count == 0 and not has_subtopics_with_tasks:
            continue
        linked_tasklist_ids.update(ids_for_group)
        # Reuse already-loaded tasklist data instead of a new DB query
        tasklists = sorted(
            [tl_by_id[i] for i in ids_for_group if i in tl_by_id],
            key=lambda tl: tl.task_number,
        )
        linked_group_items.append({
            "type": "linked_group",
            "linked_key": "_".join(str(n) for n in task_numbers),
            "task_numbers": task_numbers,
            "tasks": [
                {
                    "tasklist_id": tl.id,
                    "task_number": tl.task_number,
                    "task_title": tl.task_title,
                    "part": tl.part_id,
                }
                for tl in tasklists
            ],
            "count_available": groups_count,
            "subtopics": subtopics,
        })

    groups = TaskGroup.objects.filter(
        subject=subject_instance,
        level=level_instance,
    )
    group_members = TaskGroupMember.objects.filter(
        task_group__in=groups
    ).select_related("task_group", "task", "task__task")

    group_dict = {}
    grouped_tasklist_ids = set(linked_tasklist_ids)

    group_tasklist_ids = [m.task.task_id for m in group_members if m.task.task_id]
    tasklist_counts = dict(
        TaskList.objects.filter(id__in=group_tasklist_ids)
        .annotate(count_task=Count("task"))
        .values_list("id", "count_task")
    ) if group_tasklist_ids else {}

    for member in group_members:
        group_id = member.task_group_id
        tl_id = member.task.task_id
        if tl_id and tl_id in linked_tasklist_ids:
            continue
        if group_id not in group_dict:
            group_dict[group_id] = {
                "type": "group",
                "group_id": group_id,
                "tasks": [],
            }
        tl = member.task.task
        group_dict[group_id]["tasks"].append({
            "id": member.task.id,
            "tasklist_id": tl_id,
            "task_number": member.task_number,
            "task_title": tl.task_title if tl else "",
            "part": tl.part_id if tl else None,
            "count_task": tasklist_counts.get(tl_id, 0),
        })
        if tl_id:
            grouped_tasklist_ids.add(tl_id)

    # Добавляем подтемы для каждой группы
    for group_id, gd in group_dict.items():
        task_nums = sorted({t["task_number"] for t in gd["tasks"]})
        gd["subtopics"] = _subtopics_for_groups(subject_instance, level_instance, task_nums)
        gd["task_numbers"] = task_nums

    result = []
    for t in tasks_qs:
        if t.id in grouped_tasklist_ids:
            continue
        if subtopic_ids and (t.count_task or 0) <= 0:
            continue
        result.append({
            "type": "single",
            "id": t.id,
            "task_number": t.task_number,
            "task_title": t.task_title,
            "part": t.part_id,
            "count_task": t.count_task,
        })

    linked_task_number_sets = {frozenset(item["task_numbers"]) for item in linked_group_items}
    for gd in group_dict.values():
        gd_nums = frozenset(gd.get("task_numbers") or [])
        if gd_nums not in linked_task_number_sets:
            result.append(gd)
    # Дедупликация linked_group по task_numbers (на случай дублей в БД или разных TaskList для одних номеров)
    seen_task_nums = set()
    deduped_linked = []
    for item in linked_group_items:
        key = frozenset(item.get("task_numbers") or [])
        if key in seen_task_nums:
            continue
        seen_task_nums.add(key)
        deduped_linked.append(item)
    result.extend(deduped_linked)

    def sort_key(item):
        if item["type"] == "single":
            return item["task_number"]
        if item["type"] == "linked_group":
            return min(item["task_numbers"])
        return min(task["task_number"] for task in item["tasks"])

    result = sorted(result, key=sort_key)

    resp = {
        "subject_name": subject_instance.subject_name,
        "tasks": result
    }
    # Диагностика: при ?debug=1 показывать, почему linked_group может не отображаться
    if request.GET.get("debug") == "1":
        debug_linked = []
        for linked in LinkedTaskGroup.objects.filter(
            subject=subject_instance, level=level_instance
        ):
            tn = linked.task_numbers or []
            ids_for = [id_by_number.get(n) for n in tn] if tn else []
            missing = [n for n, i in zip(tn, ids_for) if i is None]
            key = tuple(tn) if tn else ()
            cnt = linked_counts.get(key, 0)
            debug_linked.append({
                "task_numbers_in_db": tn,
                "missing_in_tasklist": missing if missing else None,
                "groups_count": cnt,
                "skipped_reason": (
                    "empty_task_numbers" if not tn else
                    "tasklist_missing" if missing else
                    "no_groups" if cnt == 0 else None
                ),
            })
        resp["_debug_linked"] = debug_linked
    return JsonResponse(resp)


def api_subtopics(request, level, subject):
    """GET: список подтем по номерам заданий и связанным группам для тренажёра."""
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)
 
    # --- Одиночные задания (старая логика) ---
    task_lists = (
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
        .filter(subtopics__isnull=False)
        .distinct()
        .order_by("task_number")
    )
 
    fipi_q = _get_fipi_q()
    out = []
 
    for tl in task_lists:
        subtopics = list(
            SubTopic.objects.filter(task_list=tl).order_by("order", "title").values("id", "title", "order")
        )
        if not subtopics:
            continue
        for st in subtopics:
            title = st["title"]
            base_qs = Task.objects.filter(task_id=tl.id, subtopic__title=title)
            st["task_count"] = base_qs.count()
            st["fipi_task_count"] = base_qs.filter(fipi_q).count()
        out.append({
            "task_list_id": tl.id,
            "task_number": tl.task_number,
            "task_title": tl.task_title,
            "subtopics": subtopics,
        })

    return JsonResponse({
        "subtopics_by_task": out,
    })

@csrf_exempt
@require_http_methods(["POST"])
def api_generate_variant(request, level, subject):
    try:
        new_variant = _create_variant(subject, level, request.body)
        return JsonResponse({'variant_id': new_variant.id})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


def api_variant_lookup(request, variant_id):
    variant = get_object_or_404(Variant.objects.select_related('level', 'var_subject'), id=variant_id)
    return JsonResponse({
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
    })


def api_variant_detail(request, level, subject, variant_id):
    variant = get_object_or_404(Variant.objects.select_related('level', 'var_subject'), id=variant_id)

    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related('task', 'task__task')
        .order_by('order')
    )

    tasks_data = []
    for item in contents:
        task_list = item.task.task
        file_url = None
        if item.task.files:
            f = item.task.files
            try:
                url = f.url
                if url:
                    file_url = request.build_absolute_uri(url)
            except Exception:
                pass
            if not file_url and f.name:
                # Fallback: build URL from file name (when .url fails)
                media_url = getattr(django_settings, "MEDIA_URL", "/media/") or "/media/"
                rel = (media_url.rstrip("/") + "/" + f.name.lstrip("/")).replace("//", "/")
                file_url = request.build_absolute_uri(rel)

        # Приоритет: TaskList.max_score (задаёт слот задания), иначе Task.max_score
        if task_list:
            max_score = getattr(task_list, "max_score", 1)
        else:
            max_score = getattr(item.task, "max_score", None)
            if max_score is None:
                max_score = 1

        tasks_data.append({
            "id": item.task.id,
            "number": task_list.task_number if task_list else item.order,
            "task_title": task_list.task_title if task_list else "",
            "text": process_latex(str(item.task.task_template or ""), for_browser=True),
            "answer": process_latex(str(item.task.answer or ""), for_browser=True),
            "part": task_list.part_id if task_list else None,
            "file": file_url,
            "author": (item.task.author or "").strip() or None,
            "max_score": max_score,
        })

    return JsonResponse({
        "id": variant.id,
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
        "tasks": tasks_data,
    })


@require_http_methods(["GET"])
def api_score_conversion(request, level, subject):
    """Конвертация первичных баллов в вторичные по таблице Mark. Работает для всех предметов (subject_short в Mark)."""
    score = request.GET.get("score", "0")
    try:
        total = int(score)
    except ValueError:
        total = 0
    level_norm = (level or "").strip().lower()
    subject_norm = (subject or "").strip().lower()
    # Строки Mark по предмету и уровню (точный уровень или level=null для любого)
    qs = (
        Mark.objects
        .filter(subject__subject_short__iexact=subject_norm)
        .filter(Q(level__level__iexact=level_norm) | Q(level__isnull=True))
        .filter(score__lte=total)
        .select_related("comment")
    )
    # Сначала берём запись с подходящим уровнем, затем с максимальным score <= total
    qs = qs.annotate(
        level_match=Case(
            When(level__level__iexact=level_norm, then=Value(1)),
            default=Value(0),
            output_field=IntegerField(),
        )
    ).order_by("-level_match", "-score")
    mark_row = qs.first()
    if mark_row is None:
        return JsonResponse({"score_exam": None, "comment": None, "mark_level": None})
    score_exam = mark_row.score_exam
    comment = mark_row.comment.comment_text if mark_row.comment else None
    mark_level = mark_row.comment.mark_level if (mark_row.comment and mark_row.comment.mark_level) else None
    return JsonResponse({"score_exam": score_exam, "comment": comment, "mark_level": mark_level})


@require_http_methods(["GET"])
def api_support_info(request, level, subject):
    """Справочная информация по предмету и уровню — все записи."""
    from django.db.models import Q

    items = list(
        SupportInfo.objects
        .filter(subject__subject_short=subject)
        .filter(Q(level__level=level) | Q(level__isnull=True))
        .select_related("subject", "level")
        .order_by("-level_id")
    )
    result = [
        {"html": process_latex(str(info.info_text or ""), for_browser=True)}
        for info in items
    ]
    return JsonResponse({"items": result})


@require_http_methods(["GET"])
def api_updates(request):
    """Список обновлений платформы (только с show=True), по убыванию времени добавления."""
    items = list(
        Update.objects.filter(show=True).order_by("-created")[:20].values("id", "title", "description", "created")
    )
    for item in items:
        d = item.get("created")
        if d:
            try:
                item["created_display"] = d.strftime("%d.%m.%Y, %H:%M")
                item["created_iso"] = d.strftime("%Y-%m-%dT%H:%M:%S")
            except (AttributeError, TypeError):
                item["created_display"] = ""
                item["created_iso"] = ""
        else:
            item["created_display"] = ""
            item["created_iso"] = ""
        del item["created"]
    return JsonResponse({"updates": items})


@csrf_exempt
@require_http_methods(["POST"])
def report_pdf(request, level, subject):
    """Генерация PDF-отчёта по результатам выполнения варианта."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"error": "Неверный формат данных"}, status=400)

    variant_id = data.get("variantId")
    if not variant_id:
        return JsonResponse({"error": "Не указан вариант"}, status=400)

    variant = get_object_or_404(
        Variant.objects.select_related("var_subject", "level"),
        id=variant_id,
    )
    if str(variant.var_subject.subject_short) != str(subject) or str(variant.level.level) != str(level):
        return JsonResponse({"error": "Вариант не соответствует уровню/предмету"}, status=400)

    student_name = (data.get("studentName") or "Ученик").strip() or "Ученик"
    start_time_raw = data.get("startTime") or ""
    end_time_raw = data.get("endTime") or ""
    total_time_formatted = data.get("totalTimeFormatted") or ""
    task_times = data.get("taskTimes") or {}
    scores = data.get("scores") or {}
    tasks = data.get("tasks") or []
    total_score = data.get("totalScore", 0)
    max_score = data.get("maxScore", 0)
    score_exam = data.get("scoreExam")
    score_comment = data.get("scoreComment") or ""
    mark_level = data.get("markLevel")

    # Время в отчёте — по компьютеру пользователя (передано с фронта в локальном формате)
    date_solution = (data.get("dateSolutionLocal") or "").strip()
    time_start = (data.get("timeStartLocal") or "").strip()
    time_end = (data.get("timeEndLocal") or "").strip()
    if not date_solution or not time_start:
        try:
            if start_time_raw:
                dt = datetime.fromisoformat(start_time_raw.replace("Z", "+00:00"))
                if not date_solution:
                    date_solution = dt.strftime("%d.%m.%Y")
                if not time_start:
                    time_start = dt.strftime("%H:%M:%S")
            if end_time_raw and not time_end:
                dt_end = datetime.fromisoformat(end_time_raw.replace("Z", "+00:00"))
                time_end = dt_end.strftime("%H:%M:%S")
        except (ValueError, TypeError):
            pass

    subject_label = {
        "inf": "Информатика",
        "math": "Математика",
    }.get(subject, variant.var_subject.subject_name or str(subject))
    level_val = str(level).lower()
    level_label = {"oge": "ОГЭ", "ege": "ЕГЭ"}.get(level_val, level_val.upper())
    if level_val.isdigit():
        level_label = f"{level_val} класс"

    report_rows = []
    for t in tasks:
        tid = str(t.get("id", ""))
        num = t.get("number", tid)
        title = t.get("task_title", "")
        max_s = t.get("max_score", 1)
        sc = scores.get(tid, scores.get(int(tid) if tid.isdigit() else tid, 0))
        sec = task_times.get(tid, task_times.get(int(tid) if tid.isdigit() else tid, 0))
        time_str = f"{sec} сек" if isinstance(sec, (int, float)) else ""
        report_rows.append({
            "number": num,
            "title": title,
            "score": sc,
            "max_score": max_s,
            "time": time_str,
        })

    mid = (len(report_rows) + 1) // 2
    report_col1 = report_rows[:mid]
    report_col2 = report_rows[mid:]

    level_to_class = {1: "insufficient", 2: "threshold", 3: "average", 4: "high"}
    score_comment_class = level_to_class.get(mark_level, "") if mark_level else ""

    base_url = request.build_absolute_uri("/").rstrip("/") or "/"
    favicon_url = base_url + ("favicon.svg" if base_url.endswith("/") else "/favicon.svg")

    context = {
        "base_url": base_url,
        "favicon_url": favicon_url,
        "student_name": student_name,
        "subject_label": subject_label,
        "level_label": level_label,
        "variant_id": variant_id,
        "date_solution": date_solution,
        "time_start": time_start,
        "time_end": time_end,
        "total_time_formatted": total_time_formatted,
        "report_col1": report_col1,
        "report_col2": report_col2,
        "total_score": total_score,
        "max_score": max_score,
        "score_exam": score_exam,
        "score_comment": score_comment,
        "score_comment_class": score_comment_class,
        "pdf_css": pdf_utils.get_pdf_css(),
    }

    html_string = render_to_string("report_template.html", context)
    base_url = request.build_absolute_uri("/")

    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except Exception as e:
        logger.exception("WeasyPrint report PDF failed: %s", e)
        return HttpResponse("Ошибка генерации PDF", status=500, content_type="text/plain; charset=utf-8")

    safe_name = "".join(c if c.isalnum() or c in " -_" else "-" for c in student_name).strip() or "report"
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="report-{safe_name}.pdf"'
    return response


def _render_variant_pdf(request, level, subject, variant_id, background_url="", theme="default"):

    author_filter = (request.GET.get("author") or "").strip() or None
    cache_path = pdf_utils.get_pdf_cache_path(variant_id, theme, author_filter)
    nocache = request.GET.get("nocache", "").lower() in ("1", "true", "yes")
    if django_settings.DEBUG:
        nocache = True  # В режиме разработки всегда перегенерируем PDF
    if os.path.exists(cache_path) and not nocache:
        f = open(cache_path, "rb")
        try:
            return FileResponse(f, content_type="application/pdf")
        except Exception:
            f.close()
            raise

    variant = get_object_or_404(Variant, id=variant_id)
    try:
        context = pdf_utils.build_pdf_context(request, variant, subject, author_filter=author_filter)
    except Exception as e:
        logger.exception("PDF build_pdf_context failed for variant %s: %s", variant_id, e)
        return HttpResponse("Ошибка подготовки PDF", status=500, content_type="text/plain; charset=utf-8")

    context["background_url"] = background_url

    html_string = render_to_string("pdf_template.html", context)
    base_url = request.build_absolute_uri('/')

    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except IndexError:
        html_safe = re.sub(r'<div class="task-body">\s*</div>', '<div class="task-body"><p>&nbsp;</p></div>', html_string)
        html_safe = re.sub(r'<span class="answer-field">\s*</span>', '<span class="answer-field">&nbsp;</span>', html_safe)
        pdf = WeasyHTML(string=html_safe, base_url=base_url).write_pdf()
    except Exception as e:
        logger.exception("WeasyPrint PDF generation failed for variant %s: %s", variant_id, e)
        return HttpResponse("Ошибка генерации PDF", status=500, content_type="text/plain; charset=utf-8")

    try:
        with open(cache_path, "wb") as f:
            f.write(pdf)
    except OSError as e:
        logger.warning("Could not cache PDF to %s: %s", cache_path, e)

    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="variant_{variant_id}.pdf"'
    return response


def variant_pdf(request, level, subject, variant_id):
    theme = request.GET.get("theme", "").lower()
    background_url = ""
    if theme == "spring":
        background_url = pdf_utils.resolve_background_image("img/spring.png", request=request)
    return _render_variant_pdf(
        request,
        level,
        subject,
        variant_id,
        background_url=background_url,
        theme=theme or "default",
    )


def variant_pdfSpring(request, level, subject, variant_id):
    """PDF варианта с весенней темой (алиас для /pdf/spring)."""
    background_url = pdf_utils.resolve_background_image("img/spring.png", request=request)
    return _render_variant_pdf(
        request,
        level,
        subject,
        variant_id,
        background_url=background_url,
        theme="spring",
    )


def search_task(request):
    q = (request.GET.get("q") or "").strip()
    if not q or not q.isdigit():
        return JsonResponse({"tasks": []})

    task = Task.objects.filter(id=int(q)).select_related("task").first()
    if not task or not task.task:
        return JsonResponse({"tasks": []})

    return JsonResponse({
        "tasks": [{
            "id": task.id,
            "task_number": task.task.task_number,
            "task_text": process_latex(str(task.task_template or ""), for_browser=True),
            "answer": task.answer,
        }]
    })


def search_variant(request):
    q = (request.GET.get("q") or "").strip()
    if not q or not q.isdigit():
        return JsonResponse({"variant": None, "tasks": []})

    variant = Variant.objects.filter(id=int(q)).select_related("var_subject", "level").first()
    if not variant:
        return JsonResponse({"variant": None, "tasks": []})

    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related("task")
        .order_by("order")
    )
    tasks = [
        {"number": item.order, "id": item.task.id, "answer": item.task.answer}
        for item in contents
    ]
    return JsonResponse({
        "variant": {
            "id": variant.id,
            "level": variant.level.level,
            "subject": variant.var_subject.subject_short,
            "subject_name": variant.var_subject.subject_name,
        },
        "tasks": tasks,
    })


@csrf_exempt
@require_http_methods(["POST"])
def report_error(request, level, subject):
    """Приём отчёта об ошибке и отправка в Telegram."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"error": "Неверный формат данных"}, status=400)

    task_id = data.get("taskId")
    task_number = data.get("taskNumber")
    error_type = data.get("errorType")
    comment = (data.get("comment") or "").strip()
    variant_id = data.get("variantId")

    if not error_type:
        return JsonResponse({"error": "Не указан тип ошибки"}, status=400)

    type_label = ERROR_TYPE_LABELS.get(error_type, error_type)
    level_label = {"oge": "ОГЭ", "ege": "ЕГЭ"}.get(str(level).lower(), str(level).upper())
    subject_label = {"inf": "Информатика", "math": "Математика"}.get(subject, subject)

    def _esc(s):
        return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    lines = [
        "🐛 <b>Сообщение об ошибке</b>",
        "",
        f"<b>Предмет:</b> {subject_label}",
        f"<b>Уровень:</b> {level_label}",
        f"<b>Задание:</b> №{task_number or '?'} (ID: {task_id or '—'})",
        f"<b>Вариант:</b> {variant_id or '—'}",
        f"<b>Тип:</b> {type_label}",
    ]
    if comment:
        lines.extend(["", "<b>Комментарий:</b>", _esc(comment)])

    text = "\n".join(lines)
    success = telegram_utils.send_telegram_message(text)

    if success:
        return JsonResponse({"ok": True})
    return JsonResponse({"error": "Не удалось отправить в Telegram"}, status=500)
