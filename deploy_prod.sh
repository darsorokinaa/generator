#!/usr/bin/env bash
# Деплой ЛК на сервере. Перед первым запуском: chmod +x deploy_prod.sh
# Подставьте свои значения в переменные ниже.

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/opt/lk_generator_test}"
VENV_BIN="${PROJECT_ROOT}/venv/bin"
CABINET_DIR="${PROJECT_ROOT}/Cabinet"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-daphne}"

cd "$PROJECT_ROOT"

echo ">>> git pull"
git pull origin "${GIT_BRANCH:-cabinet}"

echo ">>> venv + pip"
# shellcheck source=/dev/null
source "${VENV_BIN}/activate"
pip install --upgrade pip
pip install -r "${CABINET_DIR}/requirements.txt"

cd "$CABINET_DIR"

echo ">>> migrate"
python manage.py migrate --noinput

echo ">>> collectstatic"
python manage.py collectstatic --noinput

echo ">>> restart ${SYSTEMD_SERVICE}"
sudo systemctl restart "$SYSTEMD_SERVICE"

echo ">>> nginx (если меняли конфиг вручную — раскомментируйте)"
# sudo nginx -t && sudo systemctl reload nginx

echo "Готово."
