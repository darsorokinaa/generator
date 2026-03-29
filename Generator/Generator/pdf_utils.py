"""PDF generation helpers."""
import base64
import hashlib
import os
import re
import tempfile
from pathlib import Path
from django.conf import settings as django_settings
from django.contrib.staticfiles import finders
from django.utils.safestring import mark_safe

from .latex_utils import process_latex, batch_render_mathjax, extract_latex_formulas
from .models import TaskPreview


def get_pdf_css():
    css_path = finders.find('css/pdf.css')
    if not css_path:
        css_path = os.path.join(django_settings.STATIC_ROOT or '', 'css', 'pdf.css')
    if css_path and os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f:
            return f.read()
    return ''


def scrub_task_tables_for_pdf(html: str) -> str:
    """
    CKEditor часто задаёт table/td width:100%, table-layout:fixed и col width —
    колонки сжимаются, «275/55» переносится по слэшу. Убираем sizing из разметки.
    """
    if not html:
        return html

    _re_sizing_in_style = re.compile(
        r"(?:^|;)\s*(?:(?:min-|max-)?width|table-layout)\s*:\s*[^;]+",
        re.IGNORECASE,
    )

    def _scrub_style_val(style: str) -> str:
        s = style
        for _ in range(8):
            n = _re_sizing_in_style.sub("", s)
            if n == s:
                break
            s = n
        s = re.sub(r";+", ";", s).strip("; \t\n\r")
        return s

    def _repl_style_dq(m):
        open_tag, before, style_val, after = m.group(1), m.group(2), m.group(3), m.group(4)
        new = _scrub_style_val(style_val)
        if new:
            return f'{open_tag}{before}style="{new}"{after}>'
        merged = f"{before.rstrip()}{after}".strip()
        return f"{open_tag} {merged}>" if merged else f"{open_tag}>"

    def _repl_style_sq(m):
        open_tag, before, style_val, after = m.group(1), m.group(2), m.group(3), m.group(4)
        new = _scrub_style_val(style_val)
        if new:
            return f"{open_tag}{before}style='{new}'{after}>"
        merged = f"{before.rstrip()}{after}".strip()
        return f"{open_tag} {merged}>" if merged else f"{open_tag}>"

    for _pat, _repl in (
        (
            r'(?is)(<(?:table|td|th|col)\b)([^>]*?)\sstyle="([^"]*)"([^>]*)>',
            _repl_style_dq,
        ),
        (
            r"(?is)(<(?:table|td|th|col)\b)([^>]*?)\sstyle='([^']*)'([^>]*)>",
            _repl_style_sq,
        ),
    ):
        html = re.sub(_pat, _repl, html)

    # HTML-атрибут width (без CSS)
    html = re.sub(
        r'(?is)(<(?:table|td|th|col)\b[^>]*?)\s+width\s*=\s*"[^"]*"',
        r"\1",
        html,
    )
    html = re.sub(
        r"(?is)(<(?:table|td|th|col)\b[^>]*?)\s+width\s*=\s*'[^']*'",
        r"\1",
        html,
    )
    html = re.sub(
        r"(?is)(<(?:table|td|th|col)\b[^>]*?)\s+width\s*=\s*\d+",
        r"\1",
        html,
    )
    return html


def sanitize_html_for_weasyprint(html: str) -> str:
    """
    Снижает риск падений WeasyPrint (IndexError в layout/inline.py) из‑за пустых
    inline-боксов и пустых math-inline рядом с SVG.
    """
    if not html:
        return html
    html = re.sub(
        r'<div class="task-body">\s*</div>',
        '<div class="task-body"><p>&nbsp;</p></div>',
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'<span class="answer-field">\s*</span>',
        '<span class="answer-field">&nbsp;</span>',
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'<span([^>]*\bclass="[^"]*math-inline[^"]*"[^>]*)>\s*</span>',
        lambda m: '<span{}>\xa0</span>'.format(m.group(1)),
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'<div([^>]*\bclass="[^"]*math-display[^"]*"[^>]*)>\s*</div>',
        r'<div\1><span>&nbsp;</span></div>',
        html,
        flags=re.IGNORECASE,
    )
    return html


def sanitize_html_for_weasyprint_aggressive(html: str) -> str:
    """
    Вторая попытка: после </svg> добавляется zero-width space — у раскладки inline
    появляется «текстовый» узел, и не срабатывает баг в skip_first_whitespace.
    """
    html = sanitize_html_for_weasyprint(html)
    zwsp = '\u200b'
    html = re.sub(r'</svg>', lambda m: m.group(0) + zwsp, html, flags=re.IGNORECASE)
    return html


def sanitize_html_for_weasyprint_last_resort(html: str) -> str:
    """
    Третья попытка: убрать SVG только из таблиц answers-table (лист «Ответы»).
    Условия задач выше по HTML остаются с формулами; в ячейках ответов может
    остаться текст или пусто — лучше, чем 500 от WeasyPrint.
    """
    html = sanitize_html_for_weasyprint_aggressive(html)

    def strip_svg_from_table(m: re.Match) -> str:
        fragment = m.group(0)
        return re.sub(
            r'<svg\b[^>]*>.*?</svg>',
            '',
            fragment,
            flags=re.DOTALL | re.IGNORECASE,
        )

    return re.sub(
        r'<table\b[^>]*\bclass="[^"]*answers-table[^"]*"[^>]*>.*?</table>',
        strip_svg_from_table,
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )


MATH_CSS = mark_safe("""<style>
/* SVG после Node MathJax (tex-svg); размер через ex + PDF_MATH_SCALE в latex_utils */
.math-display {
    display: block;
    text-align: center;
    margin: 0.4em 0;
    color: #000;
    page-break-inside: avoid;
    line-height: 1.15;
}
.math-display svg {
    display: inline-block;
    vertical-align: middle;
    max-width: 100%;
    height: auto;
    overflow: visible;
}
.math-inline {
    display: inline-block;
    max-width: 100%;
    color: #000;
    line-height: 1;
    vertical-align: middle;
    overflow: visible;
}
.math-inline svg {
    display: inline-block;
    vertical-align: -0.2ex;
    max-width: 100%;
    height: auto;
    overflow: visible;
    box-sizing: content-box;
}
/* MathJax 3 full: обёртка вокруг SVG (не путать с браузерным рантаймом) */
.math-inline mjx-container,
span.math-inline > mjx-container {
    display: inline-block !important;
    vertical-align: middle;
    margin: 0;
    padding: 0;
    line-height: 1;
    max-width: 100%;
}
.math-display mjx-container,
div.math-display > mjx-container {
    display: block !important;
    margin-left: auto;
    margin-right: auto;
    max-width: 100%;
    line-height: 1.15;
}
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


def build_pdf_context(request, variant, subject, author_filter=None):
    contents = list(
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )
    author_trimmed = (author_filter or "").strip()
    if author_trimmed:
        contents = [c for c in contents if (c.task.author or "").strip() == author_trimmed]

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
        html = html.replace("&\u0430mp;", "&amp;").replace("&amp;amp;", "&amp;")
        html = scrub_task_tables_for_pdf(html)
        return html

    for item in contents:
        raw_text = str(item.task.task_template or "").strip()
        if not raw_text:
            rendered_text = mark_safe("<p>&nbsp;</p>")
        else:
            html = process_latex(raw_text, for_pdf=True)
            html = fix_pdf_html(html)
            html = rewrite_content_image_urls(html, request)
            rendered_text = mark_safe(html)
        part_obj = item.task.task.part
        part = part_obj.part_title if part_obj else None
        part_id = part_obj.pk if part_obj else None

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
            # Всегда используем HTTP(S) URL для ссылок в PDF — file:// не работает при просмотре PDF на другом устройстве
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

        tl = item.task.task
        subdivision = (getattr(tl, "subdivision", None) or "").strip() if tl else ""

        entry = {
            "type": "task",
            "order": item.order,
            "text": rendered_text,
            "answer": rendered_answer,
            "part": part,
            "part_id": part_id,
            "subject": subject,
            "subdivision": subdivision,
            "file_url": file_url,
        }
        processed_contents.append(entry)
        answers_by_part.setdefault(part or "Без части", []).append(entry)

    # Получаем TaskPreview для subject/level и вставляем перед соответствующими частями
    previews = TaskPreview.objects.filter(
        subject=variant.var_subject,
        level=variant.level,
    ).select_related("part", "preview_type")

    previews_by_part = {}
    instruction_previews = []
    for pv in previews:
        raw_html = str(pv.task_preview_text or "").strip()
        if not raw_html:
            continue
        html = process_latex(raw_html, for_pdf=True)
        html = fix_pdf_html(html)
        html = rewrite_content_image_urls(html, request)
        preview_html = mark_safe(html)
        pt = pv.preview_type
        pt_text = (pt.preview_type_text or "").lower()
        is_instruction = pt and "инструк" in pt_text
        is_reminder = pt and "напоминание" in pt_text
        block = {
            "type": "preview",
            "preview_html": preview_html,
            "part_title": pv.part.part_title if pv.part else None,
            "part_id": pv.part_id,
            "is_instruction": is_instruction,
            "is_reminder": is_reminder,
        }
        if pv.part_id is None:
            instruction_previews.append(block)
        else:
            previews_by_part.setdefault(pv.part_id, []).append(block)

    # Объединяем: инструкции в начале, затем задачи с превью перед каждой новой частью
    merged_contents = []
    last_part_id = object()  # sentinel
    part_2_seen = False

    def _is_part_2(item):
        title = (item.get("part_title") or item.get("part") or "").lower()
        return "часть" in title and "2" in title and "12" not in title and "21" not in title

    for block in instruction_previews:
        merged_contents.append(block)
    for entry in processed_contents:
        part_id = entry.get("part_id")
        if part_id != last_part_id and part_id is not None:
            for block in previews_by_part.get(part_id, []):
                if _is_part_2(block) and not part_2_seen:
                    block = dict(block)
                    block["start_new_page"] = True
                    part_2_seen = True
                merged_contents.append(block)
            last_part_id = part_id
        elif part_id != last_part_id and part_id is None:
            last_part_id = part_id
        if entry.get("type") == "task" and _is_part_2(entry) and not part_2_seen:
            entry = dict(entry)
            entry["start_new_page"] = True
            part_2_seen = True
        merged_contents.append(entry)

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

    # Инструкции — отдельно (одна колонка сверху), остальное — задачи и напоминания
    instruction_blocks = [b for b in merged_contents if b.get("type") == "preview" and b.get("is_instruction")]
    tasks_content = [b for b in merged_contents if b.get("type") != "preview" or not b.get("is_instruction")]

    return {
        "variant": variant,
        "instruction_blocks": instruction_blocks,
        "tasks_content": tasks_content,
        "contents": merged_contents,
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


def get_pdf_cache_path(variant_id, theme, author_filter=None):
    safe_theme = theme or "default"
    base_dir = django_settings.MEDIA_ROOT or os.path.join(django_settings.BASE_DIR, "media")
    cache_dir = os.path.join(base_dir, "pdfs")
    os.makedirs(cache_dir, exist_ok=True)
    suffix = f"variant_{variant_id}_{safe_theme}"
    if author_filter:
        author_slug = hashlib.md5(author_filter.encode("utf-8")).hexdigest()[:12]
        suffix = f"{suffix}_author_{author_slug}"
    return os.path.join(cache_dir, f"{suffix}.pdf")
