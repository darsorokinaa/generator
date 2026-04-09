# Связка ЛК (`02_lk_generator`) и генератора (`01 generator`)

## Два репозитория

| Проект | Роль |
|--------|------|
| Соседняя папка `../02_lk_generator` | Кабинет: `POST /api/lesson/token/` выдаёт JWT и URL `GENURОК_URL/lesson/join/?token=…` |
| Этот репозиторий | genurok: проверка JWT, страница урока, API задач |

В Cursor можно открыть оба дерева: файл **`generator_and_lk.code-workspace`** в корне генератора (File → Open Workspace).

## Обязательно одинаково на обоих серверах

- **`LESSON_SECRET`** — как в `02_lk_generator/Cabinet/.env.example` и в `systemctl cat generator_test`.
- **`GENURОК_URL`** в ЛК — точный URL сайта генератора (например `https://genurok.tw1.ru`).

## Типичная причина «join» + «Ошибка загрузки»

React воспринимает путь как `/:level/:subject` → уровень `lesson`, предмет `join`, уходит запрос на `/api/lesson/join/tasks/`. Если бэкенд отвечает **404** (старый `ROOT_URLCONF` без `subtopics/`) или nginx бьёт **не в тот порт**, видна ошибка.

Проверки на сервере генератора:

1. **Один порт у Daphne и у nginx**  
   `ss -tlnp | grep daphne` → например `8002`.  
   В активном `nginx` для genurok все `proxy_pass` на этот порт (в репозитории — `upstream generator_asgi` в `deploy/nginx.conf`; при необходимости замените `8002` на `8001` в одном месте и перезагрузите nginx).

2. **Перезапуск после деплоя**  
   `sudo systemctl restart generator_test`  
   `sudo nginx -t && sudo systemctl reload nginx`

3. **Миграции**  
   `cd /opt/generator_test/Generator && python manage.py migrate`

4. **Статика**  
   `mkdir -p …/staticfiles && python manage.py collectstatic --noinput`  
   (путь из предупреждения Django).

## Документация в ЛК

В `02_lk_generator/GENURОК_INTEGRATION.md` — формат JWT и контракт (совпадает с `LessonTokenView` в `Cabinet/views.py`).

## Кнопка «Личный кабинет» открывает главную генератора

Чаще всего **поддомен `lk` смотрит на тот же nginx `server`, что и генератор** (или в `.env` при сборке указан `VITE_LK_URL=https://genurok...` без `lk.`).

- На сервере генератора задайте **`LK_PUBLIC_URL`** (базовый домен ЛК) и при необходимости **`LK_DASHBOARD_URL`** — полный URL дашборда (кнопка «Личный кабинет» и редирект после урока). SPA читает **`GET /api/site-config/`** (`lk_nav_url` / `lk_public_url`).
- В **nginx** для `lk.genurok.tw1.ru` должен быть **отдельный** `server { ... }` с `proxy_pass` на **бэкенд кабинета**, а не на тот же upstream, что `genurok.tw1.ru`.
