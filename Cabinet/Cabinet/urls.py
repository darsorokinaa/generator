from django.contrib import admin
from django.urls import path, include
from django.shortcuts import redirect
from . import views
from rest_framework.routers import DefaultRouter
from .views import UserProfileViewSet, SubjectListView, LevelListView, StudentsView, StudentDetailView, MeProfile, GroupView

router = DefaultRouter()
router.register(r'users', UserProfileViewSet)

urlpatterns = [
    path('admin/',    admin.site.urls),
    path('',          lambda req: redirect('login'), name='home'),
    path('login/',    views.login_view,    name='login'),
    path('register/', views.register_view, name='register'),
    path('logout/',   views.logout_view,   name='logout'),
    path('settings/', views.settings_view, name='settings'),

    # REST API
    path('api/', include(router.urls)),
    path('api/students/',     StudentsView.as_view(),       name='api-students'),
    path('api/students/<int:pk>/', StudentDetailView.as_view(), name='api-student-detail'),
    path('api/subjects/',  SubjectListView.as_view(), name='api-subjects'),
    path('api/levels/',    LevelListView.as_view(),   name='api-levels'),
    path('api/me/',        MeProfile.as_view(),  name='api-me'),
    path('api/groups/',    GroupView.as_view(),  name='api-groups'),
]
