from django.contrib import admin
from django.urls import path, include
from Generator import views

urlpatterns = [

    path('', views.index, name='index'),
    path('tasks/<subject>', views.tasks, name='tasks'),
    path('admin', admin.site.urls)
]
