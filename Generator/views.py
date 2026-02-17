from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt  # добавь csrf_exempt
from .models import Subject, TaskList, Task, Level, Variant, VariantContent

import json
import secrets


# =====================================================
# HTML VIEWS (старый режим)
# =====================================================

def index(request):
    return render(request, 'index.html')


def subject(request, level):
    return render(request, 'subject.html', {'level': level})


@ensure_csrf_cookie
def tasks(request, level, subject):
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)

    task_list = (
        TaskList.objects
        .filter(subject=subject_instance, level=level_instance)
        .order_by('task_number')
    )

    return render(
        request,
        'tasks.html',
        {
            'subject_short': subject_instance.subject_short,
            'subject_name': subject_instance.subject_name,
            'task_list': task_list,
            'level': level_instance,
        }
    )


@require_http_methods(["POST"])
def generate_variant(request, level, subject):
    try:
        subject_instance = get_object_or_404(Subject, subject_short=subject)
        level_instance = get_object_or_404(Level, level=level)

        data = json.loads(request.body)
        selected_tasks = []

        for tasklist_id, count in data.items():
            random_tasks = list(
                Task.objects
                .filter(task_id=tasklist_id)
                .order_by('?')[:int(count)]
            )
            selected_tasks.extend(random_tasks)

        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by="ADMIN",
            share_token=secrets.token_urlsafe(12)
        )

        for index, task in enumerate(selected_tasks, start=1):
            VariantContent.objects.create(
                variant=new_variant,
                task=task,
                order=index,
            )

        return JsonResponse({'variant_id': new_variant.id})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


def variant_detail(request, level, subject, variant_id):
    variant = get_object_or_404(Variant, id=variant_id)

    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related('task')
        .order_by('order')
    )

    tasks = [item.task for item in contents]

    return render(
        request,
        'exam.html',
        {
            'tasks': tasks,
            'variant': variant
        }
    )


def shared_var(request, token):
    variant = get_object_or_404(Variant, share_token=token)
    return variant_detail(
        request,
        level=variant.level.level,
        subject=variant.var_subject.subject_short,
        variant_id=variant.id
    )


# =====================================================
# API VIEWS (SPA режим)
# =====================================================

@ensure_csrf_cookie
def api_csrf(request):
    """Устанавливает CSRF cookie для React"""
    return JsonResponse({"detail": "CSRF cookie set"})


def api_tasks(request, level, subject):
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)

    task_list = (
        TaskList.objects
        .filter(subject=subject_instance, level=level_instance)
        .order_by('task_number')
    )

    data = {
        "subject_name": subject_instance.subject_name,  # ← берём из subject_instance, не task_list
        "tasks": [
            {
                "id": task.id,
                "task_title": task.task_title,
            }
            for task in task_list
        ]
    }

    return JsonResponse(data)

@csrf_exempt
@require_http_methods(["POST"])
def api_generate_variant(request, level, subject):
    try:
        subject_instance = get_object_or_404(Subject, subject_short=subject)
        level_instance = get_object_or_404(Level, level=level)

        data = json.loads(request.body)
        selected_tasks = []

        for tasklist_id, count in data.items():
            random_tasks = list(
                Task.objects
                .filter(task_id=tasklist_id)
                .order_by('?')[:int(count)]
            )
            selected_tasks.extend(random_tasks)

        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by="ADMIN",
            share_token=secrets.token_urlsafe(12)
        )

        for index, task in enumerate(selected_tasks, start=1):
            VariantContent.objects.create(
                variant=new_variant,
                task=task,
                order=index,
            )

        return JsonResponse({'variant_id': new_variant.id})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


def api_variant_detail(request, level, subject, variant_id):
    variant = get_object_or_404(Variant, id=variant_id)

    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related('task', 'task__task')  # если task.task — это TaskList
        .order_by('order')
    )

    data = {
    "id": variant.id,
    "level": variant.level.level,
    "subject": variant.var_subject.subject_short,
    "tasks": [
        {
            "id": item.task.id,
            "number": item.order,
            "text": item.task.task_template,
            "answer": item.task.answer,
            "part": item.task.task.part_id,
            "file": item.task.files.url if item.task.files else None,
        }
        for item in contents
    ]
}


    return JsonResponse(data)

