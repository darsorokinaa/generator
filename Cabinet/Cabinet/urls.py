from django.contrib import admin
from django.urls import path, include
from django.shortcuts import redirect
from django.conf import settings
from django.views.generic import TemplateView
from django.contrib.staticfiles.views import serve as serve_static
from . import views
from .permissions import user_can_use_lk
from rest_framework.routers import DefaultRouter
from .views import (
    UserProfileViewSet,
    SubjectListView,
    LevelListView,
    StudentsView,
    StudentDetailView,
    MeProfile,
    GroupView,
    LessonTokenView,
    LessonTeacherJoinedView,
    LessonPendingInviteView,
    HomeworkListView,
    HomeworkDetailView,
    HomeworkAssignView,
    HomeworkUploadAttachmentView,
    HomeworkMyView,
    HomeworkAssignmentDetailView,
    HomeworkSubmitView,
    HomeworkUploadAnswerView,
    HomeworkReviewView,
    HomeworkTeacherCommentView,
    HomeworkUploadTeacherFeedbackView,
    HomeworkAnnotateView,
    HomeworkTeacherAssignmentsView,
    HomeworkCancelAssignmentView,
    HomeworkCancelAllView,
    HomeworkVariantProxyView,
    NotificationListView,
    NotificationReadView,
    NotificationReadAllView,
)

router = DefaultRouter()
router.register(r'users', UserProfileViewSet, basename='users')
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
        if user_can_use_lk(request.user):
            # Корень не отдаёт SPA — только /app/ (см. react_app)
            return redirect('react-app')
        return redirect('/admin/')
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
    path('api/lesson/teacher-joined/', LessonTeacherJoinedView.as_view(), name='api-lesson-teacher-joined'),
    path('api/lesson/pending/',        LessonPendingInviteView.as_view(),  name='api-lesson-pending'),

    # Homework
    path('api/homework/',                                        HomeworkListView.as_view(),             name='api-homework-list'),
    path('api/homework/<int:pk>/',                               HomeworkDetailView.as_view(),           name='api-homework-detail'),
    path('api/homework/<int:pk>/assign/',                        HomeworkAssignView.as_view(),           name='api-homework-assign'),
    path('api/homework/<int:pk>/assignments/',                   HomeworkTeacherAssignmentsView.as_view(),name='api-homework-assignments'),
    path('api/homework/<int:pk>/cancel-all/',                    HomeworkCancelAllView.as_view(),         name='api-homework-cancel-all'),
    path('api/homework/upload-attachment/',                      HomeworkUploadAttachmentView.as_view(), name='api-homework-upload-attachment'),
    path('api/homework/variant/<int:variant_id>/',               HomeworkVariantProxyView.as_view(),     name='api-homework-variant'),
    path('api/homework/my/',                                     HomeworkMyView.as_view(),               name='api-homework-my'),
    path('api/homework/assignment/<int:pk>/',                    HomeworkAssignmentDetailView.as_view(), name='api-homework-assignment-detail'),
    path('api/homework/assignment/<int:pk>/submit/',             HomeworkSubmitView.as_view(),           name='api-homework-submit'),
    path('api/homework/assignment/<int:pk>/upload-answer/',      HomeworkUploadAnswerView.as_view(),     name='api-homework-upload-answer'),
    path('api/homework/assignment/<int:pk>/review/',             HomeworkReviewView.as_view(),           name='api-homework-review'),
    path('api/homework/assignment/<int:pk>/teacher-comment/',    HomeworkTeacherCommentView.as_view(),   name='api-homework-teacher-comment'),
    path('api/homework/assignment/<int:pk>/upload-teacher-feedback/', HomeworkUploadTeacherFeedbackView.as_view(), name='api-homework-upload-teacher-feedback'),
    path('api/homework/assignment/<int:pk>/cancel/',             HomeworkCancelAssignmentView.as_view(), name='api-homework-cancel'),
    path('api/homework/answer/<int:file_id>/annotate/',          HomeworkAnnotateView.as_view(),         name='api-homework-annotate'),

    # Notifications
    path('api/notifications/',                                   NotificationListView.as_view(),         name='api-notifications'),
    path('api/notifications/read-all/',                          NotificationReadAllView.as_view(),      name='api-notifications-read-all'),
    path('api/notifications/<int:pk>/read/',                     NotificationReadView.as_view(),         name='api-notification-read'),

    # React SPA (prod) — ловим все остальные пути
    path('app/', react_app, name='react-app'),
]

# В dev-режиме отдаём статику и медиафайлы через Django
if settings.DEBUG:
    from django.conf.urls.static import static
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL,  document_root=settings.MEDIA_ROOT)
