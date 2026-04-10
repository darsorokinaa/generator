import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)

# Per-room state: last offer stored so late joiners get it immediately
_room_offers = {}


class VideoConsumer(AsyncWebsocketConsumer):
    """
    WebRTC signaling relay for 1-on-1 video calls.

    Protocol messages (JSON):
      → { type: "offer",         payload: RTCSessionDescription }
      → { type: "answer",        payload: RTCSessionDescription }
      → { type: "ice-candidate", payload: RTCIceCandidate | null }

    Server-initiated:
      ← { type: "peer_joined" }
      ← { type: "peer_left" }
      ← { type: "offer", payload: ... }   (cached offer for late joiner)
    """

    async def connect(self):
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.room_group = f"video_{self.room_id}"

        await self.channel_layer.group_add(self.room_group, self.channel_name)
        await self.accept()
        logger.info("[sig] +join  room=%s ch=%s", self.room_id, self.channel_name[:12])

        # If there's a cached offer (teacher connected first), send it to the
        # late joiner directly.  In that case we do NOT broadcast peer_joined,
        # because the cached offer already starts negotiation — otherwise the
        # teacher would re-send the offer and the student would produce two
        # answers, causing an InvalidStateError on the teacher's side.
        cached = _room_offers.get(self.room_id)
        if cached:
            logger.info("[sig] sending cached offer to late joiner room=%s", self.room_id)
            await self.send(json.dumps(cached))
        else:
            await self.channel_layer.group_send(
                self.room_group,
                {
                    "type": "relay",
                    "data": {"type": "peer_joined"},
                    "sender": self.channel_name,
                },
            )

    async def disconnect(self, close_code):
        logger.info("[sig] -leave room=%s ch=%s code=%s", self.room_id, self.channel_name[:12], close_code)
        _room_offers.pop(self.room_id, None)
        await self.channel_layer.group_discard(self.room_group, self.channel_name)
        await self.channel_layer.group_send(
            self.room_group,
            {"type": "relay", "data": {"type": "peer_left"}},
        )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return

        msg_type = data.get("type", "")

        if msg_type == "ping":
            await self.send(json.dumps({"type": "pong"}))
            return

        # Cache the latest offer so late joiners get it
        if msg_type == "offer":
            _room_offers[self.room_id] = data
            logger.info("[sig] offer cached room=%s", self.room_id)

        # Answer received → clear cached offer (negotiation complete)
        if msg_type == "answer":
            _room_offers.pop(self.room_id, None)
            logger.info("[sig] offer cache cleared room=%s", self.room_id)

        # Relay to all EXCEPT sender
        await self.channel_layer.group_send(
            self.room_group,
            {
                "type": "relay",
                "data": data,
                "sender": self.channel_name,
            },
        )

    async def relay(self, event):
        if event.get("sender") == self.channel_name:
            return
        await self.send(json.dumps(event["data"]))


class NotificationConsumer(AsyncWebsocketConsumer):
    """Personal notification channel for authenticated users."""

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return
        from Cabinet.permissions import user_can_use_lk
        if not user_can_use_lk(user):
            await self.close()
            return
        self.group_name = f"user_{user.id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        pass

    async def notify_message(self, event):
        await self.send(json.dumps(event["data"]))
