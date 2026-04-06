#!/bin/bash
# Обновление приложения на сервере (после изменений в коде)
# bash /opt/generator_test/deploy/update.sh
set -e

APP_DIR="/opt/generator_test"

echo "=== Обновление кода из git ==="
cd $APP_DIR
git pull origin generator_test

echo "=== Обновление фронтенда ==="
cd $APP_DIR/frontend
npm install
npm run build

echo "=== Обновление Python зависимостей ==="
# Используем venv, который реально запускает сервис (шебанг gunicorn указывает на /opt/generator/venv)
/opt/generator/venv/bin/pip install PyJWT --quiet

echo "=== Миграции и статика ==="
cd $APP_DIR/Generator
/opt/generator/venv/bin/python manage.py migrate --noinput
/opt/generator/venv/bin/python manage.py collectstatic --noinput

echo "=== Перезапуск Gunicorn ==="
systemctl restart generator_test

echo "Готово! Приложение обновлено."
