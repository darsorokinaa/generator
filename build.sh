#!/bin/bash
set -e

pip install django django-cors-headers django-ckeditor-5 django-ckeditor weasyprint psycopg2-binary channels gunicorn whitenoise

cd /home/runner/workspace/frontend
npm install
npm run build

cd /home/runner/workspace/Generator
python manage.py migrate --fake --noinput
python manage.py collectstatic --noinput

PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT count(*) FROM \"Generator_level\";" 2>/dev/null | grep -q "^ *0$" && {
  echo "Database is empty, loading data..."
  PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -f /home/runner/workspace/attached_assets/data_dump_1771499076298.sql
  echo "Data loaded successfully"
} || echo "Database already has data, skipping import"
