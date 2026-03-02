#!/bin/bash
set -e

pip install django django-cors-headers django-ckeditor-5 django-ckeditor weasyprint psycopg2-binary channels gunicorn whitenoise

cd /home/runner/workspace/frontend
npm install
npm run build

cd /home/runner/workspace/Generator

echo "Checking current production database state..."
TASK_COUNT=$(psql "$DATABASE_URL" -t -c 'SELECT COUNT(*) FROM "Generator_task"' 2>/dev/null | tr -d ' \n' || echo "0")
echo "Current task count: $TASK_COUNT"

if [ "$TASK_COUNT" -gt "0" ]; then
  echo "Backing up production data ($TASK_COUNT tasks)..."
  pg_dump --data-only --no-privileges --no-owner "$DATABASE_URL" \
    | grep -v '\\restrict' | grep -v '\\unrestrict' \
    > /tmp/prod_backup.sql
  echo "Backup created"
fi

echo "Resetting database schema..."
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Running Django migrations to create schema..."
python manage.py migrate --noinput

if [ "$TASK_COUNT" -gt "0" ]; then
  echo "Restoring production data ($TASK_COUNT tasks)..."
  psql "$DATABASE_URL" -f /tmp/prod_backup.sql
  echo "Production data restored successfully"
else
  echo "Loading initial task bank from load_data.sql..."
  psql "$DATABASE_URL" -f /home/runner/workspace/load_data.sql
  echo "Data loaded successfully"
fi

python manage.py collectstatic --noinput

python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Generator.settings')
django.setup()
from django.contrib.auth.models import User
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', '', 'admin')
    print('Superuser created')
else:
    u = User.objects.get(username='admin')
    u.set_password('admin')
    u.save()
    print('Superuser password reset')
"
