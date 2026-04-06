import json
from channels.generic.websocket import AsyncWebsocketConsumer

class VideoConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f"video_{self.room_id}"
        if self.scope['user'].is_anonymous:
            await self.close()  # закрыть соединение
            return

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
            )
        await self.accept()


    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
            )

    async def receive(self, text_data):
        data = json.loads(text_data)
        await self.channel_layer.group_send(
            self.room_group_name,
            {"type": "video_message", "data": data}
        )
    
    async def video_message(self, event):
         data = event['data']
         await self.send(json.dumps(data))
