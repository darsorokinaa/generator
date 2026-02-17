from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404, redirect
from .models import Subject, TaskList, Task, Level, Variant, VariantContent
import json
import re
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
import secrets

def index(request):
    return render(request, 'index.html')

def subject(request, level):
    return render(request, 'subject.html', {'level':level})

@ensure_csrf_cookie
def tasks(request, level, subject):
    subject_instance = Subject.objects.get(subject_short=subject)
    level_instance = Level.objects.get(level=level)

    task_list = (
        TaskList.objects
        .filter(subject=subject_instance, level=level_instance)
        .order_by('task_number')   # или другое поле сортировки
    )

    return render(request, 'tasks.html', {
        'subject_short': subject_instance.subject_short,
        'subject_name': subject_instance.subject_name,
        'task_list': task_list,
        'level': level_instance,
    })




@require_http_methods(["POST"])
def generate_variant(request, level, subject):
    
    try:
        subject_instance = Subject.objects.get(subject_short=subject)
        level_instance = Level.objects.get(level=level)

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
            share_token = secrets.token_urlsafe(12)
        )

        for index, task in enumerate(selected_tasks, start=1):
            VariantContent.objects.create(
                variant=new_variant,
                task=task,
                order=index,
            )

        return JsonResponse({
            'variant_id': new_variant.id
        })
    
    except Exception as e:
        return JsonResponse({
            'error': str(e)
        }, status=400)


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
    variant = get_object_or_404(Variant, share_token = token)
    return variant_detail(
        request,
        level=variant.level.level,
        subject=variant.var_subject.subject_short,
        variant_id=variant.id
    )
