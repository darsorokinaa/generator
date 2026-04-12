# Интеграция genurok.tw1.ru с кабинетом учителя

## Как работает схема

```
Учитель (кабинет)                genurok.tw1.ru
     │                                │
     │── POST /api/lesson/token/ ────→ Django кабинета
     │←── { url, token } ────────────│
     │                                │
     │── window.open(url) ───────────→ /lesson/join/?token=<JWT>
                                       │
                                       ├── верифицирует токен общим секретом
                                       ├── читает room_id, teacher, student
                                       └── запускает видеокомнату
```

## Структура JWT-токена

Алгоритм: **HS256**
Секрет: значение переменной окружения `LESSON_SECRET` (тот же на обоих серверах)

```json
{
  "iss":         "cabinet",
  "iat":         1712345678,
  "exp":         1712352878,
  "room_id":     "student_8_1712345678000",
  "teacher_id":  3,
  "teacher":     "Дарья С",
  "type":        "student",
  "target_id":   8,
  "target_name": "Анна"
}
```

`type` = `"student"` или `"group"`

## Верификация токена на genurok.tw1.ru (Python)

```python
import jwt
from django.conf import settings

LESSON_SECRET = settings.LESSON_SECRET  # та же переменная окружения

def verify_lesson_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            LESSON_SECRET,
            algorithms=['HS256'],
            options={'require': ['exp', 'iss', 'room_id']},
        )
        if payload.get('iss') != 'cabinet':
            raise ValueError('wrong issuer')
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError('Токен истёк')
    except jwt.InvalidTokenError as e:
        raise ValueError(f'Невалидный токен: {e}')
```

## View на genurok.tw1.ru

```python
# views.py
from django.shortcuts import render
from django.http import HttpResponseBadRequest

def lesson_join(request):
    token = request.GET.get('token', '')
    if not token:
        return HttpResponseBadRequest('Токен не передан')

    try:
        payload = verify_lesson_token(token)
    except ValueError as e:
        return HttpResponseBadRequest(str(e))

    # Передаём данные в шаблон / React
    context = {
        'room_id':     payload['room_id'],
        'teacher':     payload['teacher'],
        'target_name': payload['target_name'],
        'type':        payload['type'],
    }
    return render(request, 'lesson_room.html', context)
```

## URL на genurok.tw1.ru

```python
# urls.py
path('lesson/join/', views.lesson_join, name='lesson-join'),
```

## Кнопка «ЛК» на genurok.tw1.ru

Ссылка на кабинет задаётся **на стороне генератора** (шаблон / конфиг / `https://lk...` → замените на **`http://lk.genurok.tw1.ru`**, если ЛК без SSL). Редиректы после входа в кабинете берут `FRONTEND_URL` из `.env` кабинета.

## Переменные окружения (оба сервера должны иметь одинаковый LESSON_SECRET)

```env
# .env на кабинете
LESSON_SECRET=super-secret-shared-key-32-chars

# .env на genurok.tw1.ru
LESSON_SECRET=super-secret-shared-key-32-chars
```

## Верификация на JS (если genurok.tw1.ru — SPA)

```javascript
import { jwtVerify, importSecret } from 'jose';  // npm install jose

async function verifyToken(token) {
  const secret = new TextEncoder().encode(process.env.LESSON_SECRET);
  const { payload } = await jwtVerify(token, secret);
  return payload;
  // { room_id, teacher, target_name, type, exp, ... }
}
```

## Вебхук «учитель зашёл в урок» (`POST /api/lesson/teacher-joined/`)

В проде кабинет ожидает заголовок **`X-Lesson-Webhook-Secret`**, совпадающий с переменной **`LESSON_WEBHOOK_SECRET`** в `.env` кабинета (тот же секрет нужно прописать в конфиге генератора и отправлять при каждом POST). Если секрет не задан и `DEBUG=False`, эндпоинт отвечает **503** (чтобы не оставлять анонимный вызов). При `DEBUG=True` без секрета вызов разрешён для локальной отладки.

В JWT поле **`iss`** должно быть ровно **`cabinet`** — иначе ответ **401**.
