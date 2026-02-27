from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from Generator import views

urlpatterns = [
    # CKEDITOR + ADMIN
    path("ckeditor5/", include("django_ckeditor_5.urls")),
    path("admin/", admin.site.urls),

    path("favicon.svg", views.favicon),
    path("api/csrf/", views.api_csrf, name="api_csrf"),
    path("api/search_task/", views.search_task),
    path("api/search_variant/", views.search_variant),
    path("api/variant-lookup/<int:variant_id>/", views.api_variant_lookup),
     path("api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/spring", views.variant_pdfSpring),
     path("api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/", views.variant_pdf),
     path("api/<str:level>/<str:subject>/variant/<int:variant_id>/", views.api_variant_detail),
     path("api/<str:level>/<str:subject>/variant/", views.api_generate_variant),
     path("api/<str:level>/<str:subject>/tasks/", views.api_tasks),   # ← добавить или переименовать
     path("api/<str:level>/<str:subject>/", views.api_tasks),         # оставить для совместимости

    # PDF (legacy without api prefix)
    path("<str:level>/<str:subject>/variant/<int:variant_id>/pdf/spring",
         views.variant_pdfSpring),
    path("<str:level>/<str:subject>/variant/<int:variant_id>/pdf/",
         views.variant_pdf),

    # Board
    path("board/", include("Board.urls")),
    re_path(r"^(?!api/|ckeditor5/|admin/|board/|media/|static/).*$", views.react_app),
]

if settings.DEBUG:
     urlpatterns += static(settings.MEDIA_URL,
                           document_root=settings.MEDIA_ROOT)
