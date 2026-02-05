from django.http import JsonResponse
from django.shortcuts import render
from .models import *
import json


def index(request):
    return render(request, 'index.html')

def tasks(request, subject):
    subject_instance = Subject.objects.get(subject_short=subject)
    task_list = TaskList.objects.filter(subject=subject_instance)
    return render(request, 'tasks.html', {
        'subject_short': subject_instance.subject_short,
        'subject_name': subject_instance.subject_name,
        'task_list': task_list,
    })

def variant(request, subject):
    if request.method == 'POST':
        request.session['variant_data'] = json.loads(request.body)
        return JsonResponse({'status': 'ok'})

    # # GET
    # data = request.session.get('variant_data')
    # print(data)
    # tasks = Task.objects.filter(
    #     task__subject__subject_short=subject,
    #     ).values('task_text')
    # for text in tasks:
    #     print (text)

    return render(request, 'var.html', {'data': data})
