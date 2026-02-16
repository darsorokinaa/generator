from django.contrib import admin
from django.urls import path, include
from Generator import views
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path


urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.index, name='index'),
    path("", include("Board.urls")),
    
    
    path('<str:level>/<str:subject>/variant/<int:variant_id>/share/<str:token>',
         views.shared_var,
         name='shared_var'),
    
    # DETAIL ВАРИАНТА (самый конкретный)
    path('<str:level>/<str:subject>/variant/<int:variant_id>/',
         views.variant_detail,
         name='variant_detail'),

    # СОЗДАНИЕ ВАРИАНТА (POST)
    path('<str:level>/<str:subject>/variant/',
         views.generate_variant,
         name='variant'),

    # СПИСОК ЗАДАЧ
    path('<str:level>/<str:subject>/',
         views.tasks,
         name='tasks'),

    # ВЫБОР ПРЕДМЕТА
    path('<str:level>/',
         views.subject,
         name='subject'),

    path('ckeditor/', include('ckeditor_uploader.urls')),

    

]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)