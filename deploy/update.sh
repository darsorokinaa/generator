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
/opt/generator_test/venv/bin/python3 -m pip install PyJWT channels_redis --quiet

echo "=== Миграции и статика ==="
cd $APP_DIR/Generator
$APP_DIR/venv/bin/python3 manage.py migrate --noinput
$APP_DIR/venv/bin/python3 manage.py collectstatic --noinput

echo "=== Обновление конфига Nginx ==="
cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/generator_test
nginx -t && systemctl reload nginx

echo "=== Перезапуск Daphne ==="
systemctl restart generator_test

echo "Готово! Приложение обновлено."
