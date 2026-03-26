from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.static import serve

from . import views


urlpatterns = [

    path("ckeditor5/", include("django_ckeditor_5.urls")),
    path('admin/', admin.site.urls),

    path("api/csrf/", views.api_csrf, name="api_csrf"),
    path("api/updates/", views.api_updates, name="api_updates"),
    path("api/search_task/", views.search_task, name="search_task"),
    path("api/search_variant/", views.search_variant, name="search_variant"),
    path("favicon.svg", views.favicon),
    path("api/<str:level>/<str:subject>/tasks/", views.api_tasks),
    path("api/<str:level>/<str:subject>/subtopics/", views.api_subtopics),
    path("api/variant-lookup/<int:variant_id>/", views.api_variant_lookup),
    path("api/<str:level>/<str:subject>/variant/", views.api_generate_variant),
    path("api/<str:level>/<str:subject>/variant/<int:variant_id>/", views.api_variant_detail),
    path("api/<str:level>/<str:subject>/support-info/", views.api_support_info),
    path("api/<str:level>/<str:subject>/criteria/", views.api_criteria),
    path("api/<str:level>/<str:subject>/score-conversion/", views.api_score_conversion),
    path("api/<str:level>/<str:subject>/report-pdf/", views.report_pdf),
    path("api/<str:level>/<str:subject>/report-error/", views.report_error),
    path('api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/', views.variant_pdf),
    # path('api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/spring', views.variant_pdfSpring),

    path("", include("Board.urls")),
    path("cabinet/", include("Cabinet.urls")),

]

urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]

urlpatterns += [
    re_path(r'^.*$', views.react_app, name='react_app'),
]
