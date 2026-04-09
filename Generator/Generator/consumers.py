import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.apps import apps


class LessonConsumer(AsyncWebsocketConsumer):
    VARIANT_PAYLOAD_KEY = "_lesson_current_variant"

    async def connect(self):
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.group_name = f"lesson_{self.room_id}"
        if await self._is_lesson_session_closed():
            await self.accept()
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "lesson_ended",
                        "reason": "session_closed",
                        "by_role": "server",
                    }
                )
            )
            await self.close(code=4001)
            return
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        current_variant = await self._get_saved_variant()
        if current_variant:
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "variant",
                        "variant_id": current_variant["variant_id"],
                        "level": current_variant["level"],
                        "subject": current_variant["subject"],
                    }
                )
            )

    async def disconnect(self, close_code):
        # Обычное закрытие вкладки не завершает урок для остальных.
        # Завершение отправляет только учитель вручную (type=lesson_ended).
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return
        normalized_variant = self._normalize_variant_message(data)
        if normalized_variant:
            await self._save_variant(normalized_variant)
        await self.channel_layer.group_send(
            self.group_name,
            {"type": "lesson_message", "payload": data},
        )

    async def lesson_message(self, event):
        await self.send(text_data=json.dumps(event["payload"]))

    def _normalize_variant_message(self, payload):
        if not isinstance(payload, dict):
            return None
        if payload.get("type") != "variant":
            return None
        try:
            variant_id = int(payload.get("variant_id"))
        except (TypeError, ValueError):
            return None
        level = str(payload.get("level") or "").strip().lower()
        subject = str(payload.get("subject") or "").strip().lower()
        if variant_id <= 0 or not level or not subject:
            return None
        return {
            "variant_id": variant_id,
            "level": level,
            "subject": subject,
        }

    @database_sync_to_async
    def _is_lesson_session_closed(self):
        LessonRoom = apps.get_model("Generator", "LessonRoom")
        return LessonRoom.objects.filter(
            room_id=self.room_id, lesson_ended_at__isnull=False
        ).exists()

    @database_sync_to_async
    def _get_saved_variant(self):
        LessonRoom = apps.get_model("Generator", "LessonRoom")
        room = LessonRoom.objects.filter(room_id=self.room_id).only("jwt_payload").first()
        if not room or not isinstance(room.jwt_payload, dict):
            return None
        return self._normalize_variant_message(
            {
                "type": "variant",
                **(room.jwt_payload.get(self.VARIANT_PAYLOAD_KEY) or {}),
            }
        )

    @database_sync_to_async
    def _save_variant(self, variant_payload):
        LessonRoom = apps.get_model("Generator", "LessonRoom")
        room = LessonRoom.objects.filter(room_id=self.room_id).only("id", "jwt_payload").first()
        if not room:
            return
        payload = dict(room.jwt_payload or {})
        payload[self.VARIANT_PAYLOAD_KEY] = variant_payload
        room.jwt_payload = payload
        room.save(update_fields=["jwt_payload", "updated_at"])
