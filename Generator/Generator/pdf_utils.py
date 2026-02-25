"""PDF generation helpers."""
import os

from django.conf import settings as django_settings
from django.contrib.staticfiles import finders
from django.utils.safestring import mark_safe

from .latex_utils import process_latex


def get_pdf_css():
    css_path = finders.find('css/pdf.css')
    if not css_path:
        css_path = os.path.join(django_settings.STATIC_ROOT or '', 'css', 'pdf.css')
    if css_path and os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f:
            return f.read()
    return ''


MATH_CSS = mark_safe("""<style>
/* MathJax SVG output */
.math-display { display: block; text-align: center; margin: .8em 0; font-size: 1.1em; }
.math-display svg { display: inline-block; vertical-align: middle; max-width: 100%; }
.math-inline { display: inline; vertical-align: middle; }
.math-inline svg { display: inline-block; vertical-align: middle; }
/* Fallback: HTML math (frac, sqrt, etc.) when MathJax unavailable */
.frac { display: inline-block; vertical-align: middle; text-align: center; margin: 0 .15em; }
.num { display: block; border-bottom: 1px solid #000; padding: 0 .2em .1em; min-width: 1em; }
.den { display: block; padding: .1em .2em 0; }
.sqrt-arg { border-top: 1px solid #000; padding: 0 .1em; }
.math-env { display: block; margin: .5em 0 .5em 1em; }
.math-row { display: block; margin: .2em 0; }
.cases-table { display: inline-table; vertical-align: middle; border-collapse: collapse; margin: .3em 0; }
.cases-brace { font-size: 2.2em; line-height: 1; padding-right: .15em; vertical-align: middle; font-family: serif; font-weight: 100; }
.cases-row { padding: .15em 0; }
.array-table { display: inline-table; border-collapse: collapse; margin: .3em 0; }
.array-cell { padding: 0 .4em; text-align: center; }
.mf { font-style: normal; }
sup { font-size: .75em; vertical-align: super; }
sub { font-size: .75em; vertical-align: sub; }
</style>""")


def resolve_background_image(filename: str, request=None) -> str:
    if not filename:
        return ""
    img_path = finders.find(filename)
    if not img_path:
        img_path = os.path.join(django_settings.STATIC_ROOT or "", filename)
    if img_path and os.path.exists(img_path):
        return f"file://{img_path}"
    if request:
        base = (django_settings.STATIC_URL or "/").rstrip("/")
        rel = filename.lstrip("/")
        return request.build_absolute_uri(f"{base}/{rel}")
    return ""


def build_pdf_context(request, variant, subject):
    contents = (
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )

    processed_contents = []
    seen_parts = []
    answers_by_part = {}

    for item in contents:
        raw_text = str(item.task.task_template or "").strip()
        if not raw_text:
            rendered_text = mark_safe("<p>&nbsp;</p>")
        else:
            rendered_text = mark_safe(process_latex(raw_text))
        part = item.task.task.part.part_title if item.task.task.part else None

        if part not in seen_parts:
            seen_parts.append(part)

        entry = {
            "order": item.order,
            "text": rendered_text,
            "answer": item.task.answer,
            "part": part,
            "subject": subject,
            "file_url": request.build_absolute_uri(item.task.files.url) if item.task.files else None,
        }
        processed_contents.append(entry)
        answers_by_part.setdefault(part or "Без части", []).append(entry)

    answers_parts = [
        {"part": p, "items": answers_by_part[p]}
        for p in seen_parts
        if (p or "Без части") in answers_by_part
    ]

    subject_label = {
        "inf": "Информатика",
        "math": "Математика",
    }.get(subject, variant.var_subject.subject_name or str(subject))
    level_val = str(variant.level.level).lower()
    level_label = {"oge": "ОГЭ", "ege": "ЕГЭ"}.get(level_val, level_val.upper())
    if level_val.isdigit():
        level_label = f"{level_val} класс"
    header_subject_level = f"{subject_label}, {level_label}"
    header_logo = "Примерная версия экзамена"
    footer_left = "© ∑ Генератор"

    # Разбиваем ответы на блоки по 10 для переноса таблицы на несколько строк
    chunk_size = 10
    answers_chunks = [
        processed_contents[i:i + chunk_size]
        for i in range(0, len(processed_contents), chunk_size)
    ]

    return {
        "variant": variant,
        "contents": processed_contents,
        "answers_chunks": answers_chunks,
        "answers_parts": answers_parts,
        "math_styles": MATH_CSS,
        "pdf_css": get_pdf_css(),
        "subject": subject,
        "header_subject_level": header_subject_level,
        "header_logo": header_logo,
        "footer_left": footer_left,
    }


def get_pdf_cache_path(variant_id, theme):
    safe_theme = theme or "default"
    base_dir = django_settings.MEDIA_ROOT or os.path.join(django_settings.BASE_DIR, "media")
    cache_dir = os.path.join(base_dir, "pdfs")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, f"variant_{variant_id}_{safe_theme}.pdf")
