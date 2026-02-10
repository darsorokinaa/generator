from django.http import JsonResponse
from django.shortcuts import render
from .models import Subject, TaskList, Task, Level
import json


def index(request):
    return render(request, 'index.html')

def subject(request, level):
    return render(request, 'subject.html', {'level':level})

def tasks(request, level, subject):
    subject_instance = Subject.objects.get(subject_short=subject)
    level_instance = Level.objects.get(level=level)
    task_list = TaskList.objects.filter(subject=subject_instance).filter(level=level_instance)
    return render(request, 'tasks.html', {
        'subject_short': subject_instance.subject_short,
        'subject_name': subject_instance.subject_name,
        'task_list': task_list,
        'level' : level_instance,
    })


def variant(request, level, subject):
    if request.method == 'POST':
        request.session['variant_data'] = json.loads(request.body)
        return JsonResponse({'status': 'ok'})

    # GET
    data = request.session.get('variant_data')
    tasks = []
    for task_id, task_item in data.items():
        task = Task.objects.filter(task=task_id).first()
        if task:
            tasks.append({
                'task_id': task_id,
                'task_text': task.task_text
            })
    return render(request, f'{level}/{subject}.html', {'tasks': tasks})
