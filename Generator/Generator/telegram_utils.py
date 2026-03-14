"""
Утилита для отправки сообщений в Telegram через Bot API.
"""
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)


def send_telegram_message(
    text: str,
    bot_token: str | None = None,
    chat_id: str | list | None = None,
    message_thread_id: int | None = None,
) -> bool:
    """
    Отправляет сообщение в Telegram одному или нескольким получателям.

    Args:
        text: Текст сообщения (HTML).
        bot_token: Токен бота. Если None — из settings.
        chat_id: ID чата или список ID. Группа — отрицательное число (напр. -1001234567890).
                 Если None — из settings (TELEGRAM_CHAT_ID, через запятую).
        message_thread_id: ID топика в чате (для групп с темами). Если None — из settings.

    Returns:
        True если хотя бы одному доставлено, иначе False.
    """
    from django.conf import settings

    token = bot_token or getattr(settings, "TELEGRAM_BOT_TOKEN", None)
    if not token:
        logger.warning("Telegram: TELEGRAM_BOT_TOKEN не задан")
        return False

    raw = chat_id if chat_id is not None else getattr(settings, "TELEGRAM_CHAT_ID", None)
    if not raw:
        logger.warning("Telegram: TELEGRAM_CHAT_ID не задан")
        return False

    thread_id = message_thread_id
    if thread_id is None:
        raw_thread = (
            getattr(settings, "TELEGRAM_TOPIC_ID", None)
            or os.environ.get("TELEGRAM_TOPIC_ID")
        )
        thread_id = int(raw_thread) if raw_thread else None

    ids = [str(x).strip() for x in (raw.split(",") if isinstance(raw, str) else raw) if str(x).strip()]
    if not ids:
        logger.warning("Telegram: нет получателей")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    success = False
    for cid in ids:
        data = {
            "chat_id": cid,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if thread_id is not None:
            data["message_thread_id"] = thread_id
        try:
            body = urllib.parse.urlencode(data).encode("utf-8")
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode())
                if result.get("ok"):
                    success = True
                else:
                    logger.warning("Telegram API error for %s: %s", cid, result)
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            logger.warning("Telegram send to %s failed: %s", cid, e)
    return success
