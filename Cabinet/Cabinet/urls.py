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
    MePlatformConsentView,
    GroupView,
    GroupDetailView,
    LessonTokenView,
    LessonStart,
    LessonTeacherJoinedView,
    LessonTeacherLeftView,
    LessonPendingInviteView,
    LessonStudentJoinedView,
    LessonStudentRejectView,
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
    HomeworkAssignmentMetaPatchView,
    HomeworkSaveDraftView,
    HomeworkAssignmentJoinUrlView,
    HomeworkAssignmentFetchByTokenView,
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

def legacy_app_redirect(request):
    return redirect('/')

def home_view(request):
    if request.user.is_authenticated:
        if user_can_use_lk(request.user):
            # ЛК открывается на корне без префикса /app.
            return react_app(request)
        return redirect('/admin/')
    return redirect('login')


urlpatterns = [
    path('admin/',    admin.site.urls),
    path('',          home_view, name='home'),
    path('login/',    views.login_view,    name='login'),
    path('api/auth/forgot-password/', views.forgot_password_view, name='api-auth-forgot-password'),
    path('api/auth/vkid/', views.vkid_login_view, name='api-auth-vkid'),
    path('register/', views.register_view, name='register'),
    path('register/student/', views.register_student_invite_view, name='register-student-invite'),
    path('logout/',   views.logout_view,   name='logout'),
    path('settings/', views.settings_view, name='settings'),

    # REST API
    path('api/', include(router.urls)),
    path('api/students/',          StudentsView.as_view(),       name='api-students'),
    path('api/students/<int:pk>/', StudentDetailView.as_view(),  name='api-student-detail'),
    path('api/students/invite-link/', views.StudentInviteLinkView.as_view(), name='api-students-invite-link'),
    path('api/subjects/',          SubjectListView.as_view(),    name='api-subjects'),
    path('api/levels/',            LevelListView.as_view(),      name='api-levels'),
    path('api/me/',                MeProfile.as_view(),          name='api-me'),
    path('api/me/consents/',       MePlatformConsentView.as_view(), name='api-me-consents'),
    path('api/groups/',              GroupView.as_view(),        name='api-groups'),
    path('api/groups/<int:pk>/',     GroupDetailView.as_view(),  name='api-group-detail'),
    path('api/lesson/token/',      LessonTokenView.as_view(),    name='api-lesson-token'),
    path('api/lesson/start/',      LessonStart.as_view(),        name='api-lesson-start'),
    path('api/lesson/teacher-joined/', LessonTeacherJoinedView.as_view(), name='api-lesson-teacher-joined'),
    path('api/lesson/teacher-left/',   LessonTeacherLeftView.as_view(),   name='api-lesson-teacher-left'),
    path('api/lesson/pending/',        LessonPendingInviteView.as_view(),  name='api-lesson-pending'),
    path('api/lesson/student-joined/', LessonStudentJoinedView.as_view(),  name='api-lesson-student-joined'),
    path('api/lesson/student-reject/', LessonStudentRejectView.as_view(),  name='api-lesson-student-reject'),

    # Homework
    path('api/homework/',                                        HomeworkListView.as_view(),             name='api-homework-list'),
    path('api/homework/<int:pk>/',                               HomeworkDetailView.as_view(),           name='api-homework-detail'),
    path('api/homework/<int:pk>/assign/',                        HomeworkAssignView.as_view(),           name='api-homework-assign'),
    path('api/homework/<int:pk>/assignments/',                   HomeworkTeacherAssignmentsView.as_view(),name='api-homework-assignments'),
    path('api/homework/<int:pk>/cancel-all/',                    HomeworkCancelAllView.as_view(),         name='api-homework-cancel-all'),
    path('api/homework/upload-attachment/',                      HomeworkUploadAttachmentView.as_view(), name='api-homework-upload-attachment'),
    path('api/homework/variant/<int:variant_id>/',               HomeworkVariantProxyView.as_view(),     name='api-homework-variant'),
    path('api/homework/my/',                                     HomeworkMyView.as_view(),               name='api-homework-my'),
    path('api/homework/assignment/fetch-by-token/',              HomeworkAssignmentFetchByTokenView.as_view(), name='api-homework-assignment-fetch-by-token'),
    path('api/homework/assignment/<int:pk>/',                    HomeworkAssignmentDetailView.as_view(), name='api-homework-assignment-detail'),
    path('api/homework/assignment/<int:pk>/meta/',              HomeworkAssignmentMetaPatchView.as_view(), name='api-homework-assignment-meta'),
    path('api/homework/assignment/<int:pk>/save-draft/',        HomeworkSaveDraftView.as_view(),        name='api-homework-assignment-save-draft'),
    path('api/homework/assignment/<int:pk>/join-url/',          HomeworkAssignmentJoinUrlView.as_view(), name='api-homework-assignment-join-url'),
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

    path('api/get-all-tasks/',        views.get_all_tasks),
    path('api/gen/variant-lookup/<int:variant_id>/', views.gen_variant_lookup),
    path('api/gen/variant/',          views.gen_generate_variant),
    path('api/gen/criteria/',         views.gen_criteria),
    path('api/gen/catalog/',          views.gen_catalog),
    path('api/gen/tasks/',            views.gen_tasks),
    path('api/gen/subtopics/',        views.gen_subtopics),
    path('api/gen/task-bank/',        views.gen_task_bank),
    path('api/gen/group-instances/',  views.gen_group_instances),
    path('api/variants/save/',        views.save_teacher_variant),
    path('api/variants/',             views.teacher_variants),

    # Совместимость с join-ссылками генератора:
    # приводим /lesson/join/ к тому же экрану, что /?variant_play=...
    path('lesson/join/',              views.lesson_join_spa_redirect, name='lesson-join-spa-redirect'),

    # Техмаршрут SPA (без /app/).
    path('lk/', react_app, name='react-dashboard'),
    # Legacy: старые ссылки /app/... больше не используются.
    path('app/', legacy_app_redirect, name='legacy-app-redirect'),
]

# В dev-режиме отдаём статику и медиафайлы через Django
if settings.DEBUG:
    from django.conf.urls.static import static
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL,  document_root=settings.MEDIA_ROOT)
