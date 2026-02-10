from django.contrib import admin
from django.urls import path, include
from Generator import views

urlpatterns = [

    path('', views.index, name='index'),
    path('<level>', views.subject, name='subject'),
    path('<level>/<subject>/variant/', views.variant, name='variant'),
    path('<level>/<subject>', views.tasks, name='tasks'),
    path('admin/', admin.site.urls),

]
