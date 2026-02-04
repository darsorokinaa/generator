from http.client import HTTPResponse

from django.http import HttpResponse
from django.shortcuts import render
from .models import TaskList

def index(request):
    return render(request, 'index.html')

def tasks(request, subject):
    task_list = TaskList.objects.all()
    print (task_list, len(task_list))
    return render(request, 'tasks.html', {'subject': subject, 'tasks:': task_list})