from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from Generator import views
from django.views.generic import TemplateView

urlpatterns = [
    # CKEDITOR + ADMIN
    path("ckeditor5/", include("django_ckeditor_5.urls")),
    path("admin/", admin.site.urls),

    # API
    path("api/csrf/", views.api_csrf, name="api_csrf"),
    path("api/<str:level>/<str:subject>/tasks/", views.api_tasks),
    path("api/<str:level>/<str:subject>/variant/", views.api_generate_variant),
    path("api/<str:level>/<str:subject>/variant/<int:variant_id>/",
         views.api_variant_detail),

    # PDF (серверный рендеринг)
    path("<str:level>/<str:subject>/variant/<int:variant_id>/pdf/spring",
         views.variant_pdfSpring),
    path("<str:level>/<str:subject>/variant/<int:variant_id>/pdf/",
         views.variant_pdf),

    # Board
    path("board/", include("Board.urls")),
    re_path(r"^(?!api/).*$", TemplateView.as_view(template_name="index.html")),
]

if settings.DEBUG:
     urlpatterns += static(settings.MEDIA_URL,
                           document_root=settings.MEDIA_ROOT)
