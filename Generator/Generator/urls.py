from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.static import serve

from . import views


urlpatterns = [

    path("ckeditor5/", include("django_ckeditor_5.urls")),
    # Раньше срабатывал logout админки с LOGOUT_REDIRECT_URL='/' → на localhost при разработке.
    path("admin/logout/", views.admin_logout_to_public_home, name="generator_admin_logout"),
    path('admin/', admin.site.urls),

    path("api/csrf/", views.api_csrf, name="api_csrf"),
    path("api/site-config/", views.api_site_config, name="api_site_config"),
    path("api/lk-nav-unlock/", views.api_lk_nav_unlock, name="api_lk_nav_unlock"),
    path("api/lesson/verify/", views.api_lesson_verify, name="api_lesson_verify"),
    path("api/lesson/teacher-joined/", views.api_lesson_teacher_joined, name="api_lesson_teacher_joined"),
    path("api/lesson/session-close/", views.api_lesson_session_close, name="api_lesson_session_close"),
    path("api/updates/", views.api_updates, name="api_updates"),
    path("api/announcements/", views.api_announcements, name="api_announcements"),
    path("api/search_task/", views.search_task, name="search_task"),
    path("api/search_variant/", views.search_variant, name="search_variant"),
    path("favicon.svg", views.favicon),
    path("yandex_ef13ec5e267d285b.html", views.yandex_webmaster_verification),
    path("api/<str:level>/<str:subject>/tasks/", views.api_tasks),
    path("api/<str:level>/<str:subject>/subtopics/", views.api_subtopics),
    path("api/variant-lookup/<int:variant_id>/", views.api_variant_lookup),
    path("api/lesson/variant/<int:variant_id>/", views.api_lesson_variant_detail, name="api_lesson_variant_detail"),
    path("api/<str:level>/<str:subject>/variant/", views.api_generate_variant),
    path("api/<str:level>/<str:subject>/variant/<int:variant_id>/", views.api_variant_detail),
    path("api/<str:level>/<str:subject>/support-info/", views.api_support_info),
    path("api/<str:level>/<str:subject>/criteria/", views.api_criteria),
    path("api/<str:level>/<str:subject>/score-conversion/", views.api_score_conversion),
    path("api/<str:level>/<str:subject>/report-pdf/", views.report_pdf),
    path("api/<str:level>/<str:subject>/report-error/", views.report_error),
    path("api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/", views.variant_pdf),
    path(
        "api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/cosmos",
        views.variant_pdfCosmos,
    ),
    # Совместимость со старым клиентом: /api/ege/math/ → тот же ответ, что tasks/
    path("api/<str:level>/<str:subject>/", views.api_tasks),

    path("", include("Board.urls")),
    path("lesson/join", views.lesson_join_redirect),
    path("lesson/join/", views.lesson_join, name="lesson-join"),

]

urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]

# PDF без префикса /api/ (старые закладки)
urlpatterns += [
    re_path(
        r"^(?P<level>[^/]+)/(?P<subject>[^/]+)/variant/(?P<variant_id>[0-9]+)/?$",
        views.variant_detail_short_url,
    ),
    re_path(
        r"^(?P<level>[^/]+)/(?P<subject>[^/]+)/variant/(?P<variant_id>[0-9]+)/pdf/cosmos/?$",
        views.variant_pdfCosmos,
    ),
    re_path(
        r"^(?P<level>[^/]+)/(?P<subject>[^/]+)/variant/(?P<variant_id>[0-9]+)/pdf/?$",
        views.variant_pdf,
    ),
]

urlpatterns += [
    re_path(r'^.*$', views.react_app, name='react_app'),
]
