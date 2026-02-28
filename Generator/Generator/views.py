"""API and PDF views — React SPA."""
import json
import os
import re
import secrets

from django.conf import settings as django_settings
from django.db.models import Count, Q
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from weasyprint import HTML as WeasyHTML

from .models import (
    Level,
    LinkedTaskGroup,
    Subject,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    Variant,
    VariantContent,
)
from .latex_utils import process_latex
from . import pdf_utils

FAVICON_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    b'<rect width="32" height="32" rx="8" fill="#3e73ef"/>'
    b'<text x="16" y="24" font-family="Arial,sans-serif" font-size="20" font-weight="bold" '
    b'fill="white" text-anchor="middle">\xe2\x88\x91</text>'
    b'</svg>'
)


def _normalize_content(data):
    return {str(k): int(v) for k, v in data.items() if int(v) > 0}


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


def _create_variant(subject_short, level_str, body_bytes):
    subject_instance = get_object_or_404(Subject, subject_short=subject_short)
    level_instance = get_object_or_404(Level, level=level_str)
    data = json.loads(body_bytes)
    if isinstance(data, dict) and "content" in data and "tasks" in data:
        content = _normalize_content(data["content"])
    else:
        content = _normalize_content(data)
    if not content:
        raise ValueError("Не выбрано ни одного задания")

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
        task_numbers = linked.task_numbers or []
        if not task_numbers:
            return None, None
        ids_for_group = [id_by_number.get(n) for n in task_numbers]
        if any(i is None for i in ids_for_group):
            return None, None
        num_groups = min(content.get(str(i), 0) for i in ids_for_group)
        if num_groups <= 0:
            return None, None
        groups = list(
            TaskGroup.objects.filter(
                subject=subject_instance,
                level=level_instance,
                taskgroupmember__task_number__in=task_numbers,
            )
            .annotate(mcnt=Count("taskgroupmember"))
            .filter(mcnt=len(task_numbers))
            .order_by("?")[: int(num_groups)]
        )
        if len(groups) < int(num_groups):
            return None, None
        all_tasks = []
        for group in groups:
            members = list(
                TaskGroupMember.objects.filter(task_group=group).order_by("task_number")
            )
            all_tasks.extend(m.task for m in members)
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
        for linked in linked_defs:
            nums = linked.task_numbers or []
            if nums and nums[0] == tasklist.task_number:
                group_tasks, group_ids = take_linked_groups(linked)
                break
        if group_tasks is not None and group_ids is not None:
            selected_tasks.extend(group_tasks)
            handled_tasklist_ids.update(group_ids)
            continue
        tasks_for_slot = list(
            Task.objects.filter(task_id=tasklist_id).order_by("?")[: int(count)]
        )
        selected_tasks.extend(tasks_for_slot)

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


@ensure_csrf_cookie
def api_csrf(request):
    return JsonResponse({"detail": "CSRF cookie set"})


def api_tasks(request, level, subject):
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)

    tasks_qs = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        ).annotate(count_task=Count("task")).order_by('task_number')
    )
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
            linked_counts[key] = (
                TaskGroup.objects.filter(
                    subject=subject_instance,
                    level=level_instance,
                    taskgroupmember__task_number__in=task_numbers,
                )
                .annotate(mcnt=Count("taskgroupmember"))
                .filter(mcnt=len(task_numbers))
                .count()
            )

    linked_tasklist_ids = set()
    linked_group_items = []

    for linked, task_numbers, ids_for_group in linked_number_sets:
        key = tuple(task_numbers)
        groups_count = linked_counts.get(key, 0)
        if groups_count == 0:
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

    result = []
    for t in tasks_qs:
        if t.id in grouped_tasklist_ids:
            continue
        result.append({
            "type": "single",
            "id": t.id,
            "task_number": t.task_number,
            "task_title": t.task_title,
            "part": t.part_id,
            "count_task": t.count_task,
        })

    result.extend(group_dict.values())
    result.extend(linked_group_items)

    def sort_key(item):
        if item["type"] == "single":
            return item["task_number"]
        if item["type"] == "linked_group":
            return min(item["task_numbers"])
        return min(task["task_number"] for task in item["tasks"])

    result = sorted(result, key=sort_key)

    return JsonResponse({
        "subject_name": subject_instance.subject_name,
        "tasks": result
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
        tasks_data.append({
            "id": item.task.id,
            "number": item.order,
            "text": process_latex(str(item.task.task_template or ""), for_browser=True),
            "answer": item.task.answer,
            "part": item.task.task.part_id if item.task.task else None,
            "file": request.build_absolute_uri(item.task.files.url)
                    if item.task.files else None,
        })

    return JsonResponse({
        "id": variant.id,
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
        "tasks": tasks_data,
    })


def _render_variant_pdf(request, level, subject, variant_id, background_url="", theme="default"):
    cache_path = pdf_utils.get_pdf_cache_path(variant_id, theme)
    if os.path.exists(cache_path):
        return FileResponse(open(cache_path, "rb"), content_type="application/pdf")

    variant = get_object_or_404(Variant, id=variant_id)
    context = pdf_utils.build_pdf_context(request, variant, subject)
    context["background_url"] = background_url

    html_string = render_to_string("pdf_template.html", context)
    base_url = request.build_absolute_uri('/')

    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except IndexError:
        html_safe = re.sub(r'<div class="task-body">\s*</div>', '<div class="task-body"><p>&nbsp;</p></div>', html_string)
        html_safe = re.sub(r'<span class="answer-field">\s*</span>', '<span class="answer-field">&nbsp;</span>', html_safe)
        pdf = WeasyHTML(string=html_safe, base_url=base_url).write_pdf()

    with open(cache_path, "wb") as f:
        f.write(pdf)

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
