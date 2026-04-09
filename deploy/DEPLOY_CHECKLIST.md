# Деплой генератора в продакшен

Краткий чеклист и порядок действий на сервере.

## Перед выкладкой (локально или в CI)

1. **Фронтенд** (из корня репозитория):

   ```bash
   cd frontend && npm ci && npm run build
   ```

   Убедитесь, что `frontend/dist` попадает в релиз (Django отдаёт SPA из этой папки).

2. **Миграции БД** — на сервере после обновления кода:

   ```bash
   cd /opt/generator_test/Generator   # ваш путь к проекту
   source ../venv/bin/activate
   python manage.py migrate --noinput
   ```

   Важно: есть миграция `LessonRoom.lesson_ended_at` (завершение урока / запрет повторного входа по комнате).

3. **Статика**:

   ```bash
   python manage.py collectstatic --noinput
   ```

## Переменные окружения (systemd / `.env`)

| Переменная | Назначение |
|------------|------------|
| `DJANGO_SETTINGS_MODULE` | `Generator.settings` |
| `SECRET_KEY` | Случайная длинная строка (не коммитить) |
| `DEBUG` | `false` |
| `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT` | PostgreSQL |
| `LESSON_SECRET` | **Тот же**, что в ЛК — иначе `/lesson/join/` не откроется |
| `LK_PUBLIC_URL` | Базовый URL ЛК (домен), например `https://lk.example.com` — для обратных вызовов к API ЛК |
| `LK_DASHBOARD_URL` | **Опционально.** Полный URL дашборда после входа, куда ведёт кнопка «Личный кабинет», например `https://lk.example.com/dashboard`. Если не задан, открывается корень `LK_PUBLIC_URL` (часто это не дашборд, а лендинг или логин) |
| `LK_NAVIGATION_PASSWORD` | Пароль для кнопки «Личный кабинет» на сайте генератора. Не задан — по умолчанию `100326`. Пустое значение `LK_NAVIGATION_PASSWORD=` — **отключить** запрос пароля |
| `CSRF_TRUSTED_ORIGINS` | Список через запятую: `https://ваш-домен.ru` |
| `CHANNEL_LAYER_BACKEND` | `inmemory` — один процесс Daphne. Для нескольких воркеров — Redis (см. ниже) |

Пример фрагмента unit-файла см. `deploy/gunicorn.service`.

## WebSocket и уроки

- HTTP + WebSocket обрабатывает **Daphne** (ASGI), не Gunicorn WSGI.
- Nginx должен проксировать и обычные запросы, и `Upgrade` для `/ws/` на тот же порт ASGI (в чеклисте ниже — 8002).
- При **нескольких** процессах Daphne/Gunicorn для каналов нужен **Redis**: уберите `CHANNEL_LAYER_BACKEND=inmemory`, задайте `REDIS_HOST` / `REDIS_PORT` (см. `Generator/Generator/settings.py`).

## Команды на сервере (по порядку)

```bash
cd /opt/generator_test
git pull origin <ваша-ветка>

sudo cp deploy/gunicorn.service /etc/systemd/system/generator_test.service
sudo systemctl daemon-reload

# при изменении nginx:
sudo cp deploy/nginx.conf /etc/nginx/sites-available/genurok
sudo nginx -t && sudo systemctl reload nginx

source venv/bin/activate
cd Generator
python manage.py migrate --noinput
python manage.py collectstatic --noinput

sudo systemctl restart generator_test
sudo systemctl status generator_test
```

## Проверки после деплоя

1. `GET /api/site-config/` — в ответе `lk_public_url`, `lk_nav_password_required`, `lk_nav_unlocked`.
2. Кнопка «Личный кабинет» — при включённом пароле открывается только после `POST /api/lk-nav-unlock/` с верным паролем.
3. `GET /api/lesson/verify/?token=…` — `ok: true` для валидного JWT.
4. `GET /lesson/join/?token=…` — HTML комнаты урока, не пустая SPA-ошибка.
5. WebSocket: `wss://домен/ws/lesson/<room_id>/` подключается без ошибки.

## Типичные проблемы

- **Разный `LESSON_SECRET`** в генераторе и ЛК — проверка токена падает.
- **`ROOT_URLCONF`** должен включать маршруты приложения (в актуальной конфигурации — `Generator.urls` внутри пакета `Generator`).
- **Кнопка ЛК ведёт на главную генератора** — не задан или неверен `LK_PUBLIC_URL` на сервере.
