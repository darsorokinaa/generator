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

# Полноширинный блок PDF (вне двух колонок) — только для этой пары: подтема + номер из банка (TaskList)
PDF_FULL_WIDTH_SUBTOPIC_ID = 222
PDF_FULL_WIDTH_TASKLIST_ID = 67


def get_pdf_css():
    """
    Весь pdf.css встраивается в HTML (<style>{{ pdf_css }}</style>), чтобы WeasyPrint
    не ходил по HTTP за /static/... (на сервере это часто недоступно из процесса PDF).

    Ищем файл в нескольких местах: staticfiles finders → STATIC_ROOT после collectstatic
    → прямой путь Generator/static/css (деплой без полного collectstatic).
    """
    root = Path(django_settings.BASE_DIR)
    static_root = django_settings.STATIC_ROOT
    candidates = [
        finders.find("css/pdf.css"),
        Path(static_root) / "css" / "pdf.css" if static_root else None,
        root / "static" / "css" / "pdf.css",
    ]
    for p in candidates:
        if not p:
            continue
        path = Path(p) if not isinstance(p, Path) else p
        if path.is_file():
            return path.read_text(encoding="utf-8")
    return ""


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


_RE_FIGURE_TABLE_DQ = re.compile(
    r'<figure\b[^>]*\bclass="[^"]*\btable\b[^"]*"[^>]*>', re.I
)
_RE_FIGURE_TABLE_SQ = re.compile(
    r"<figure\b[^>]*\bclass='[^']*\btable\b[^']*'[^>]*>", re.I
)
_RE_TABLE_OPEN = re.compile(r"<table\b", re.I)


def _span_balanced(html: str, open_start: int, tag: str) -> int | None:
    """Индекс сразу после закрывающего </tag>, соответствующего открывающему на open_start."""
    open_re = re.compile(rf"<{re.escape(tag)}\b", re.I)
    close_re = re.compile(rf"</{re.escape(tag)}\s*>", re.I)
    m0 = open_re.match(html, open_start)
    if not m0:
        return None
    depth = 1
    pos = m0.end()
    while pos < len(html) and depth > 0:
        mo = open_re.search(html, pos)
        mc = close_re.search(html, pos)
        if mc and (not mo or mc.start() < mo.start()):
            depth -= 1
            pos = mc.end()
            if depth == 0:
                return pos
        elif mo:
            depth += 1
            pos = mo.end()
        else:
            return None
    return None


def _next_followup_block(html: str, i: int) -> tuple[str, int] | None:
    """Следующий блок текста вопроса после таблицы: p, ul, ol, blockquote, div.formula."""
    m = re.match(r"\s*", html[i:])
    if m:
        i += m.end()
    patterns: list[tuple[str, str]] = [
        ("p", r"<p\b"),
        ("ul", r"<ul\b"),
        ("ol", r"<ol\b"),
        ("blockquote", r"<blockquote\b"),
        ("div", r'<div\b[^>]*\bclass="[^"]*\bformula\b[^"]*"'),
        ("div", r"<div\b[^>]*\bclass='[^']*\bformula\b[^']*'"),
    ]
    for tag, pat in patterns:
        if re.match(pat, html[i:], re.I):
            return tag, i
    return None


def _collect_followup_after_table(html: str, table_end: int, max_blocks: int = 14) -> int:
    """Конец HTML, включающий таблицу/figure и следующие абзацы до следующей таблицы."""
    i = table_end
    end_collect = table_end
    for _ in range(max_blocks):
        nxt = _next_followup_block(html, i)
        if not nxt:
            break
        tag, idx = nxt
        end = _span_balanced(html, idx, tag)
        if end is None:
            break
        end_collect = end
        i = end
    return end_collect


def _find_next_table_block(html: str, start: int) -> tuple[str, int] | None:
    """Следующий блок: figure.table (CKEditor) или «голая» table."""
    sub = html[start:]
    cand: list[tuple[int, str]] = []
    mfd = _RE_FIGURE_TABLE_DQ.search(sub)
    if mfd:
        cand.append((mfd.start(), "figure"))
    mfs = _RE_FIGURE_TABLE_SQ.search(sub)
    if mfs:
        cand.append((mfs.start(), "figure"))
    mt = _RE_TABLE_OPEN.search(sub)
    if mt:
        cand.append((mt.start(), "table"))
    if not cand:
        return None
    pos, tag = min(cand, key=lambda x: x[0])
    return tag, start + pos


def wrap_table_task_units_for_pdf(html: str) -> str:
    """
    Оборачивает таблицу условия и следующий за ней текст вопроса в .task-body-table-unit,
    чтобы WeasyPrint не рвал таблицу и формулировку между страницами.

    Не трогаем уже обёрнутый фрагмент (идемпотентность при повторном вызове).
    """
    if not html or "task-body-table-unit" in html:
        return html
    low = html.lower()
    if "<table" not in low and "<figure" not in low:
        return html

    parts: list[str] = []
    cursor = 0
    while True:
        found = _find_next_table_block(html, cursor)
        if not found:
            parts.append(html[cursor:])
            break
        tag, idx = found
        parts.append(html[cursor:idx])
        end = _span_balanced(html, idx, tag)
        if end is None:
            parts.append(html[idx:])
            break
        follow_end = _collect_followup_after_table(html, end)
        parts.append('<div class="task-body-table-unit">')
        parts.append(html[idx:follow_end])
        parts.append("</div>")
        cursor = follow_end
    return "".join(parts)


def task_html_needs_pdf_full_width(html: str) -> bool:
    """
    Большая таблица в условии: в двух колонках PDF нечитаема — выводим задание
    на отдельный лист на всю ширину (вне column-count, см. tasks_segments).

    Эвристика: много строк и/или ≥5 колонок в строке; либо блок task-body-table-unit
    с ≥5 строками (таблица + вопрос после wrap_table_task_units_for_pdf).
    """
    if not html or "<table" not in html.lower():
        return False
    tr_count = len(re.findall(r"<tr\b", html, re.I))
    if tr_count >= 5:
        return True
    if "task-body-table-unit" in html and tr_count >= 4:
        return True
    for m in re.finditer(r"<tr\b[^>]*>.*?</tr>", html, re.I | re.DOTALL):
        cell_count = len(re.findall(r"<t[dh]\b", m.group(0), re.I))
        if cell_count >= 5:
            return True
    return False


def pdf_full_width_allowed_for_task(task, html: str) -> bool:
    """
    Отдельный лист на всю ширину — только для заданий с заданными subtopic и TaskList,
    при этом в условии по-прежнему должна быть «большая» таблица (эвристика по HTML).
    """
    if not task:
        return False
    if getattr(task, "subtopic_id", None) != PDF_FULL_WIDTH_SUBTOPIC_ID:
        return False
    # FK на банк номеров — в БД поле task_id
    if getattr(task, "task_id", None) != PDF_FULL_WIDTH_TASKLIST_ID:
        return False
    return task_html_needs_pdf_full_width(html)


def segment_tasks_for_pdf_layout(tasks_content):
    """
    WeasyPrint часто игнорирует column-span: all — задание рвётся на две колонки.
    Выносим pdf_full_width за пределы .tasks-wrapper (без column-count).
    """
    segments = []
    buffer = []
    for item in tasks_content or []:
        if item.get("type") == "task" and item.get("pdf_full_width"):
            if buffer:
                segments.append({"mode": "columns", "items": buffer})
                buffer = []
            segments.append({"mode": "full", "item": item})
        else:
            buffer.append(item)
    if buffer:
        segments.append({"mode": "columns", "items": buffer})
    return segments


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
.array-table { display: inline-table; border-collapse: collapse; margin: .45em auto; table-layout: auto; font-family: "Montserrat", "DejaVu Sans", Arial, sans-serif; font-size: 10pt; line-height: 1.35; color: #1e293b; background: #fff; }
.array-table th, .array-table td { border: 0.6pt solid #d1d5db; padding: 5pt 7pt; text-align: center; vertical-align: middle; white-space: normal; background: #fff; }
.array-table th { font-weight: 600; }
.array-table td { font-weight: 400; }
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
        html = wrap_table_task_units_for_pdf(html)
        return html

    for item in contents:
        raw_text = str(item.task.task_template or "").strip()
        if not raw_text:
            rendered_text = mark_safe("<p>&nbsp;</p>")
            pdf_full_width = False
        else:
            html = process_latex(raw_text, for_pdf=True)
            html = fix_pdf_html(html)
            html = rewrite_content_image_urls(html, request)
            rendered_text = mark_safe(html)
            pdf_full_width = pdf_full_width_allowed_for_task(item.task, html)
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
            "pdf_full_width": pdf_full_width,
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
    tasks_segments = segment_tasks_for_pdf_layout(tasks_content)

    return {
        "variant": variant,
        "instruction_blocks": instruction_blocks,
        "tasks_content": tasks_content,
        "tasks_segments": tasks_segments,
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
    # v4: полноширинный режим только для subtopic=222 + TaskList=67
    suffix = f"variant_{variant_id}_{safe_theme}_v4"
    if author_filter:
        author_slug = hashlib.md5(author_filter.encode("utf-8")).hexdigest()[:12]
        suffix = f"{suffix}_author_{author_slug}"
    return os.path.join(cache_dir, f"{suffix}.pdf")
