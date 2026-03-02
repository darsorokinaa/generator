#!/bin/bash
# Обновление приложения на сервере (после изменений в коде)
# bash /opt/generator/deploy/update.sh
set -e

APP_DIR="/opt/generator"

echo "=== Обновление фронтенда ==="
cd $APP_DIR/frontend
npm install
npm run build

echo "=== Миграции и статика ==="
cd $APP_DIR/Generator
source $APP_DIR/venv/bin/activate
python manage.py migrate --noinput
python manage.py collectstatic --noinput

echo "=== Перезапуск Gunicorn ==="
systemctl restart generator

echo "Готово! Приложение обновлено."
