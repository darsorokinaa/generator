#!/bin/bash
set -e

pip install django django-cors-headers django-ckeditor-5 django-ckeditor weasyprint psycopg2-binary channels gunicorn whitenoise

cd /home/runner/workspace/frontend
npm install
npm run build

cd /home/runner/workspace/Generator
python manage.py collectstatic --noinput
