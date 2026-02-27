from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static

from Generator import views


urlpatterns = [

    path("ckeditor5/", include("django_ckeditor_5.urls")),
    path('admin/', admin.site.urls),

    path("api/csrf/", views.api_csrf, name="api_csrf"),
    path("api/search_task/", views.search_task, name="search_task"),
    path("api/search_variant/", views.search_variant, name="search_variant"),
    path("favicon.svg", views.favicon),
    path("api/<str:level>/<str:subject>/tasks/", views.api_tasks),
    path("api/variant-lookup/<int:variant_id>/", views.api_variant_lookup),
    path("api/<str:level>/<str:subject>/variant/", views.api_generate_variant),
    path("api/<str:level>/<str:subject>/variant/<int:variant_id>/", views.api_variant_detail),
    path('api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/', views.variant_pdf),
    # path('api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/spring', views.variant_pdfSpring),

    path("", include("Board.urls")),

]

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

urlpatterns += [
    re_path(r'^.*$', views.react_app, name='react_app'),
]
