from django.contrib import admin
from django.urls import path, include
from django.shortcuts import redirect
from django.conf import settings
from django.views.generic import TemplateView
from django.contrib.staticfiles.views import serve as serve_static
from . import views
from rest_framework.routers import DefaultRouter
from .views import UserProfileViewSet, SubjectListView, LevelListView, StudentsView, StudentDetailView, MeProfile, GroupView, LessonTokenView

router = DefaultRouter()
router.register(r'users', UserProfileViewSet)

# React SPA — отдаём index.html для всех фронтовых маршрутов в проде
import os
REACT_INDEX = os.path.join(
    settings.BASE_DIR.parent, 'frontend', 'build', 'index.html'
)

def react_app(request):
    from django.http import FileResponse, HttpResponseNotFound
    if os.path.exists(REACT_INDEX):
        return FileResponse(open(REACT_INDEX, 'rb'), content_type='text/html')
    return HttpResponseNotFound('React build not found. Run: cd frontend && npm run build')

def home_view(request):
    if request.user.is_authenticated:
        # В dev-режиме React крутится отдельно на 3000,
        # в проде SPA лежит на /app/ — определяем по DEBUG
        if settings.DEBUG:
            return redirect(settings.FRONTEND_URL)   # http://localhost:3000
        return redirect('react-app')                 # /app/ — SPA в билде
    return redirect('login')


urlpatterns = [
    path('admin/',    admin.site.urls),
    path('',          home_view, name='home'),
    path('login/',    views.login_view,    name='login'),
    path('register/', views.register_view, name='register'),
    path('logout/',   views.logout_view,   name='logout'),
    path('settings/', views.settings_view, name='settings'),

    # REST API
    path('api/', include(router.urls)),
    path('api/students/',          StudentsView.as_view(),       name='api-students'),
    path('api/students/<int:pk>/', StudentDetailView.as_view(),  name='api-student-detail'),
    path('api/subjects/',          SubjectListView.as_view(),    name='api-subjects'),
    path('api/levels/',            LevelListView.as_view(),      name='api-levels'),
    path('api/me/',                MeProfile.as_view(),          name='api-me'),
    path('api/groups/',            GroupView.as_view(),          name='api-groups'),
    path('api/lesson/token/',      LessonTokenView.as_view(),    name='api-lesson-token'),

    # React SPA (prod) — ловим все остальные пути
    path('app/', react_app, name='react-app'),
]
