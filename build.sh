#!/bin/bash
set -e

pip install django django-cors-headers django-ckeditor-5 django-ckeditor weasyprint psycopg2-binary channels gunicorn

cd frontend
npm install
npm run build
