# ЛК ↔ Генератор: отладка API домашки

Общий секрет подписи JWT комнаты ДЗ: `LESSON_SECRET` в ЛК и тот же секрет на стороне генератора.

## Чтение назначения (браузер или генератор)

`GET /api/homework/assignment/<id>/`

- Сессия ЛК: ученик-владелец или учитель этого ДЗ.
- Без сессии: JWT в одном из вариантов:
  - query `?token=<jwt>`
  - заголовок `Authorization: Bearer <jwt>`
  - заголовок `X-Lesson-Token: <jwt>`

В payload JWT: `iss=cabinet`, `homework_assignment_id` равен `<id>`, `session_kind` или `lesson_format` = `homework`, подпись `HS256` ключом `LESSON_SECRET`.

## Серверные POST от генератора (без cookie ученика)

Эндпоинты:

- `POST /api/homework/assignment/<id>/save-draft/`
- `POST /api/homework/assignment/<id>/submit/`
- `POST /api/homework/assignment/<id>/upload-answer/` (multipart)
- `POST /api/homework/assignment/fetch-by-token/` (тело: `token`, `assignment_id`)

Правила:

1. JWT — как у GET (`?token=` на POST обычно не используется; предпочтительно `Authorization: Bearer` или `X-Lesson-Token`).
2. Заголовок **`X-Lesson-Webhook-Secret`** обязателен, если в ЛК задан `LESSON_WEBHOOK_SECRET` (в проде должен совпадать с секретом генератора). Если секрет в ЛК не задан и `DEBUG=False` — ответ **503**.
3. При `DEBUG=True` и пустом `LESSON_WEBHOOK_SECRET` вебхук можно не слать (локальная отладка).

Запросы **csrf_exempt** — авторизация по JWT + webhook, не CSRF-cookie.

## Сессия ученика в браузере

Если запрос идёт с cookie сессии ученика-владельца назначения, `X-Lesson-Webhook-Secret` для save-draft / submit / upload не требуется.
