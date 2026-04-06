from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/video/(?P<room_id>\w+)/$',  consumers.VideoConsumer.as_asgi()),
    re_path(r'ws/lesson/(?P<room_id>[\w]+)/$', consumers.VideoConsumer.as_asgi()),
]