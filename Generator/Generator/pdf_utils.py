"""PDF generation helpers."""
import base64
import os
import re
import tempfile
from pathlib import Path

from django.conf import settings as django_settings
from django.contrib.staticfiles import finders
from django.utils.safestring import mark_safe

from .latex_utils import process_latex, batch_render_mathjax, extract_latex_formulas


def get_pdf_css():
    css_path = finders.find('css/pdf.css')
    if not css_path:
        css_path = os.path.join(django_settings.STATIC_ROOT or '', 'css', 'pdf.css')
    if css_path and os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f:
            return f.read()
    return ''


MATH_CSS = mark_safe("""<style>
/* MathJax SVG output — color для WeasyPrint (currentColor заменяется в latex_utils) */
.math-display { display: block; text-align: center; margin: .8em 0; font-size: 1.1em; color: #000; }
.math-display svg { display: inline-block; vertical-align: middle; max-width: 100%; }
.math-inline { display: inline; vertical-align: middle; color: #000; }
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
.array-table { display: inline-table; border-collapse: collapse; margin: .3em 0; table-layout: fixed; }
.array-cell { padding: 0 .4em; text-align: center; width: 1%; }
.mf { font-style: normal; }
sup { font-size: .75em; vertical-align: super; }
sub { font-size: .75em; vertical-align: sub; }
/* verbatim (код) — MathJax не поддерживает */
.latex-verbatim { display: block; margin: .5em 0; font-family: monospace; font-size: 0.9em; background: #f5f5f5; padding: .5em; border-radius: 4px; }
</style>""")


_RE_IMG_SRC = re.compile(r'src=["\']([^"\']+)["\']', re.IGNORECASE)
_RE_DATA_IMAGE = re.compile(r'^data:image/(\w+);base64,', re.IGNORECASE)
_MAX_DATA_URL_LEN = 16_000  # Data URL длиннее — во временный файл (WeasyPrint нестабилен с большими base64)


def _resolve_image_url(url: str, request=None) -> str:
    """Преобразует URL изображения в file:// для надёжной загрузки WeasyPrint."""
    if not url:
        return url
    url = url.strip()

    # data:image URL → временный файл (WeasyPrint нестабилен с base64, file:// надёжнее)
    if url.startswith("data:image/") and ";base64," in url[:50]:
        if len(url) > _MAX_DATA_URL_LEN:  # только длинные — короткие иконки оставляем
            try:
                m = _RE_DATA_IMAGE.match(url)
                ext = (m.group(1).lower() if m else "png").replace("jpeg", "jpg")
                data = base64.b64decode(url.split(",", 1)[1])
                fd, path = tempfile.mkstemp(suffix=f".{ext}", prefix="weasy_img_")
                try:
                    os.write(fd, data)
                finally:
                    os.close(fd)
                return Path(path).as_uri()
            except Exception:
                pass
        return url

    if url.startswith("http://") or url.startswith("https://"):
        return url

    # /media/ или media/ — локальный файл
    media_root = django_settings.MEDIA_ROOT
    rel_path = None
    if url.startswith("/media/"):
        rel_path = url[len("/media/"):].lstrip("/")
    elif url.startswith("media/"):
        rel_path = url[len("media/"):].lstrip("/")

    if rel_path and media_root:
        local_path = Path(media_root) / rel_path.replace("/", os.sep)
        if local_path.exists():
            return local_path.as_uri()
        if request and url.startswith("/media/"):
            return request.build_absolute_uri(url)

    # Относительные пути — абсолютный URL
    if request and url and not url.startswith(("http", "data:", "file:")):
        return request.build_absolute_uri(url if url.startswith("/") else "/" + url)

    return url


def rewrite_content_image_urls(html: str, request=None) -> str:
    """Заменяет относительные URL изображений на file:// для PDF."""
    def replacer(m):
        old_url = m.group(1)
        new_url = _resolve_image_url(old_url, request)
        safe_url = new_url.replace('"', "%22")
        return f'src="{safe_url}"'
    return _RE_IMG_SRC.sub(replacer, html)


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
    contents = list(
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )

    # Batch-render all LaTeX formulas (tasks + answers) in one Node.js call before processing
    all_formulas = []
    for item in contents:
        raw = str(item.task.task_template or "").strip()
        if raw:
            all_formulas.extend(extract_latex_formulas(raw))
        raw_ans = str(item.task.answer or "").strip()
        if raw_ans:
            all_formulas.extend(extract_latex_formulas(raw_ans))
    if all_formulas:
        unique_formulas = list(dict.fromkeys(all_formulas))
        batch_render_mathjax(unique_formulas)

    processed_contents = []
    seen_parts = []
    answers_by_part = {}

    def fix_pdf_html(html: str) -> str:
        """Исправление &аmp; (кириллическая а) и двойного escape для PDF."""
        return html.replace("&\u0430mp;", "&amp;").replace("&amp;amp;", "&amp;")

    for item in contents:
        raw_text = str(item.task.task_template or "").strip()
        if not raw_text:
            rendered_text = mark_safe("<p>&nbsp;</p>")
        else:
            html = process_latex(raw_text, for_pdf=True)
            html = fix_pdf_html(html)
            html = rewrite_content_image_urls(html, request)
            rendered_text = mark_safe(html)
        part = item.task.task.part.part_title if item.task.task.part else None

        # Обработка LaTeX и HTML в ответах (часть 2)
        raw_answer = str(item.task.answer or "").strip()
        if raw_answer:
            html = process_latex(raw_answer, for_pdf=True)
            html = fix_pdf_html(html)
            html = rewrite_content_image_urls(html, request)
            rendered_answer = mark_safe(html)
        else:
            rendered_answer = ""

        if part not in seen_parts:
            seen_parts.append(part)

        file_url = None
        if item.task.files:
            f = item.task.files
            try:
                local_path = Path(f.path)
                if local_path.exists():
                    file_url = local_path.as_uri()
            except (ValueError, AttributeError):
                pass
            if not file_url:
                try:
                    url = f.url
                    if url:
                        file_url = request.build_absolute_uri(url)
                except Exception:
                    pass
            if not file_url and f.name:
                media_url = getattr(django_settings, "MEDIA_URL", "/media/") or "/media/"
                rel = (media_url.rstrip("/") + "/" + f.name.lstrip("/")).replace("//", "/")
                file_url = request.build_absolute_uri(rel)

        entry = {
            "order": item.order,
            "text": rendered_text,
            "answer": rendered_answer,
            "part": part,
            "subject": subject,
            "file_url": file_url,
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
    header_logo = ""
    header_variant = f"Вариант № {variant.id}"
    base_url = request.build_absolute_uri("/").rstrip("/") or "/"
    footer_left = mark_safe(f'© <a href="{base_url}" class="pdf-footer-link">Генератор</a>')

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
        "header_variant": header_variant,
        "footer_left": footer_left,
    }


def get_pdf_cache_path(variant_id, theme):
    safe_theme = theme or "default"
    base_dir = django_settings.MEDIA_ROOT or os.path.join(django_settings.BASE_DIR, "media")
    cache_dir = os.path.join(base_dir, "pdfs")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, f"variant_{variant_id}_{safe_theme}.pdf")
