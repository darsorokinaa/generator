#!/bin/bash
set -e

pip install django django-cors-headers django-ckeditor-5 django-ckeditor weasyprint psycopg2-binary channels gunicorn whitenoise

cd /home/runner/workspace/frontend
npm install
npm run build

cd /home/runner/workspace/Generator
python manage.py migrate --fake-initial --noinput
python manage.py collectstatic --noinput

echo "Loading data from dump..."
psql "$DATABASE_URL" -f /home/runner/workspace/load_data.sql
echo "Data loaded successfully"

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
