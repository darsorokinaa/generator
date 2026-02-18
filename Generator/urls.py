from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

from Generator import views


urlpatterns = [

    # =========================
    # ADMIN
    # =========================
    path("ckeditor5/", include("django_ckeditor_5.urls")),

    path('admin/', admin.site.urls),


    # =========================
    # API ROUTES (ВСЕ API ВЫШЕ!)
    # =========================

    # Получить список задач
    path("api/csrf/", views.api_csrf, name="api_csrf"),
     path("api/<str:level>/<str:subject>/tasks/", views.api_tasks),
     path("api/<str:level>/<str:subject>/variant/", views.api_generate_variant),
     path("api/<str:level>/<str:subject>/variant/<int:variant_id>/", views.api_variant_detail),
     path('<str:level>/<str:subject>/variant/<int:variant_id>/pdf/', views.variant_pdf),
     path('<str:level>/<str:subject>/variant/<int:variant_id>/pdf/spring', views.variant_pdfSpring),




    # =========================
    # HTML ROUTES (старые шаблоны)
    # =========================

    path('', views.index, name='index'),

    path("", include("Board.urls")),

    # Страница варианта (HTML)
    path(
        '<str:level>/<str:subject>/variant/<int:variant_id>/',
        views.variant_detail,
        name='variant_detail'
    ),

    # Генерация варианта (HTML POST)
    path(
        '<str:level>/<str:subject>/variant/',
        views.generate_variant,
        name='variant'
    ),

    # Список задач (HTML)
    path(
        '<str:level>/<str:subject>/',
        views.tasks,
        name='tasks'
    ),

    # Выбор предмета
    path(
        '<str:level>/',
        views.subject,
        name='subject'
    ),

]


if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
