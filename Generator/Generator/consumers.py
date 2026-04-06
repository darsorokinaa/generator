import json

from channels.generic.websocket import AsyncWebsocketConsumer


class LessonConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.group_name = f"lesson_{self.room_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return
        await self.channel_layer.group_send(
            self.group_name,
            {"type": "lesson_message", "payload": data},
        )

    async def lesson_message(self, event):
        await self.send(text_data=json.dumps(event["payload"]))
