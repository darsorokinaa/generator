import json
import logging
import os
import re
import secrets

from django.conf import settings as django_settings
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.template.loader import render_to_string
from django.utils.safestring import mark_safe
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from weasyprint import HTML as WeasyHTML

from .models import Level, Subject, Task, TaskList, Variant, VariantContent

logger = logging.getLogger(__name__)


def react_app(request):
    index_path = os.path.join(django_settings.FRONTEND_DIR, 'index.html')
    if os.path.exists(index_path):
        with open(index_path, 'r') as f:
            return HttpResponse(f.read(), content_type='text/html')
    return HttpResponse("Frontend not built", status=500)


# =====================================================
# HELPERS
# =====================================================

def _build_variant_data(variant, request=None):
    """Общая логика сборки данных варианта для API и PDF."""
    contents = (
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )
    return contents


def _create_variant(subject_short, level_str, body_bytes):
    subject_instance = get_object_or_404(Subject, subject_short=subject_short)
    level_instance = get_object_or_404(Level, level=level_str)
    data = json.loads(body_bytes)
    selected_tasks = []
    for tasklist_id, count in data.items():
        selected_tasks.extend(
            Task.objects.filter(task_id=tasklist_id).order_by('?')[:int(count)]
        )
    new_variant = Variant.objects.create(
        var_subject=subject_instance,
        level=level_instance,
        created_by="ADMIN",
        share_token=secrets.token_urlsafe(12),
    )
    VariantContent.objects.bulk_create([
        VariantContent(variant=new_variant, task=task, order=index)
        for index, task in enumerate(selected_tasks, start=1)
    ])
    return new_variant


# =====================================================
# HTML VIEWS
# =====================================================

def index(request):
    return render(request, 'index.html')


def subject(request, level):
    return render(request, 'subject.html', {'level': level})


@ensure_csrf_cookie
def tasks(request, level, subject):
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)
    task_list = (
        TaskList.objects
        .filter(subject=subject_instance, level=level_instance)
        .order_by('task_number')
    )
    return render(request, 'tasks.html', {
        'subject_short': subject_instance.subject_short,
        'subject_name': subject_instance.subject_name,
        'task_list': task_list,
        'level': level_instance,
    })


@require_http_methods(["POST"])
def generate_variant(request, level, subject):
    try:
        new_variant = _create_variant(subject, level, request.body)
        return JsonResponse({'variant_id': new_variant.id})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


def variant_detail(request, level, subject, variant_id):
    variant = get_object_or_404(Variant, id=variant_id)
    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related('task')
        .order_by('order')
    )
    return render(request, 'exam.html', {
        'tasks': [item.task for item in contents],
        'variant': variant,
    })


def shared_var(request, token):
    variant = get_object_or_404(Variant, share_token=token)
    return variant_detail(
        request,
        level=variant.level.level,
        subject=variant.var_subject.subject_short,
        variant_id=variant.id,
    )


# =====================================================
# API VIEWS
# =====================================================

@ensure_csrf_cookie
def api_csrf(request):
    return JsonResponse({"detail": "CSRF cookie set"})


def api_tasks(request, level, subject):
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)
    task_list = (
        TaskList.objects
        .filter(subject=subject_instance, level=level_instance)
        .order_by('task_number')
    )
    return JsonResponse({
        "subject_name": subject_instance.subject_name,
        "tasks": [
            {"id": t.id, "task_title": t.task_title, "part": t.part_id}
            for t in task_list
        ],
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_generate_variant(request, level, subject):
    try:
        new_variant = _create_variant(subject, level, request.body)
        return JsonResponse({'variant_id': new_variant.id})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)

def api_variant_detail(request, level, subject, variant_id):
    variant = get_object_or_404(Variant, id=variant_id)

    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related('task', 'task__task')
        .order_by('order')
    )

    tasks_data = []

    for item in contents:
        raw_html = str(item.task.task_template or "")

        tasks_data.append({
            "id": item.task.id,
            "number": item.order,
            "text": raw_html,  # HTML отдаем как есть (включая <img>)
            "answer": item.task.answer,
            "part": item.task.task.part_id if item.task.task else None,
            "file": request.build_absolute_uri(item.task.files.url)
                    if item.task.files else None,
        })

    return JsonResponse({
        "id": variant.id,
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
        "tasks": tasks_data,
    })

# =====================================================
# LATEX → HTML PARSER
# =====================================================

MATH_SYMBOLS = {
    r'\times': '×', r'\div': '÷', r'\pm': '±', r'\mp': '∓',
    r'\cdot': '·', r'\neq': '≠', r'\leq': '≤', r'\geq': '≥',
    r'\approx': '≈', r'\equiv': '≡', r'\infty': '∞',
    r'\partial': '∂', r'\nabla': '∇', r'\exists': '∃', r'\forall': '∀',
    r'\in': '∈', r'\notin': '∉', r'\subset': '⊂', r'\supset': '⊃',
    r'\cup': '∪', r'\cap': '∩', r'\emptyset': '∅',
    r'\rightarrow': '→', r'\leftarrow': '←',
    r'\Rightarrow': '⇒', r'\Leftarrow': '⇐', r'\leftrightarrow': '↔',
    r'\alpha': 'α', r'\beta': 'β', r'\gamma': 'γ', r'\delta': 'δ',
    r'\epsilon': 'ε', r'\zeta': 'ζ', r'\eta': 'η', r'\theta': 'θ',
    r'\lambda': 'λ', r'\mu': 'μ', r'\nu': 'ν', r'\xi': 'ξ',
    r'\pi': 'π', r'\rho': 'ρ', r'\sigma': 'σ', r'\tau': 'τ',
    r'\phi': 'φ', r'\chi': 'χ', r'\psi': 'ψ', r'\omega': 'ω',
    r'\Gamma': 'Γ', r'\Delta': 'Δ', r'\Theta': 'Θ', r'\Lambda': 'Λ',
    r'\Pi': 'Π', r'\Sigma': 'Σ', r'\Phi': 'Φ', r'\Psi': 'Ψ', r'\Omega': 'Ω',
    r'\circ': '∘', r'\bullet': '•', r'\ldots': '…', r'\cdots': '⋯',
    r'\qquad': '\u00a0\u00a0', r'\quad': '\u00a0',
    r'\ ': ' ', r'\,': '\u2009', r'\;': '\u2004',
}

MATH_FUNCTIONS = (
    'arcsin', 'arccos', 'arctan', 'arccot',
    'sinh', 'cosh', 'tanh', 'coth',
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'ln', 'log', 'lg', 'exp',
    'lim', 'max', 'min', 'sup', 'inf',
    'gcd', 'lcm', 'det', 'dim', 'ker', 'tr',
)

BRACKET_MAP = {
    r'\left(': '(', r'\right)': ')',
    r'\left[': '[', r'\right]': ']',
    r'\left\{': '{', r'\right\}': '}',
    r'\left|': '|', r'\right|': '|',
    r'\lbrace': '{', r'\rbrace': '}',
    r'\langle': '⟨', r'\rangle': '⟩',
}

# Компилируем паттерны один раз
_RE_HTML_TAGS = re.compile(r'<[^>]+>')
_RE_NEWLINES = re.compile(r'[\r\n]+')
_RE_MULTI_SPACE = re.compile(r'  +')
_RE_DISPLAY = re.compile(r'\\\[(.*?)\\\]', re.DOTALL)
_RE_INLINE_PAREN = re.compile(r'\\\((.*?)\\\)', re.DOTALL)
_RE_INLINE_DOLLAR = re.compile(r'\$(.+?)\$')
_RE_ENV = re.compile(
    r'\\begin\{(aligned|align\*?|cases|gather\*?|equation\*?)\}(.*?)\\end\{\1\}',
    re.DOTALL,
)
_RE_POWER_GROUP = re.compile(r'\^\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}')
_RE_INDEX_GROUP = re.compile(r'_\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}')
_RE_POWER_SINGLE = re.compile(r'\^([0-9a-zA-Zα-ωΑ-Ω])')
_RE_INDEX_SINGLE = re.compile(r'_([0-9a-zA-Zα-ωΑ-Ω])')
_RE_TEXTBF = re.compile(r'\\textbf\{([^{}]+)\}')
_RE_TEXTIT = re.compile(r'\\textit\{([^{}]+)\}')
_RE_TEXT = re.compile(r'\\(?:text|mathrm)\{([^{}]+)\}')
_RE_MATHBF = re.compile(r'\\mathbf\{([^{}]+)\}')
_RE_MATHIT = re.compile(r'\\mathit\{([^{}]+)\}')
_RE_OVERLINE = re.compile(r'\\overline\{([^{}]+)\}')
_RE_UNDERLINE = re.compile(r'\\underline\{([^{}]+)\}')
_RE_SPACING = re.compile(r'\\[,;!: ]|\\(?:thinspace|medspace|thickspace)')
_RE_STYLE = re.compile(r'\\(?:displaystyle|textstyle|scriptstyle|limits)\b')
_RE_UNKNOWN_CMD = re.compile(r'\\[a-zA-Z]+')
_RE_BRACES = re.compile(r'[{}]')
_RE_FUNC = re.compile(
    r'\\(' + '|'.join(sorted(MATH_FUNCTIONS, key=len, reverse=True)) + r')\b'
)


def _extract_balanced(text: str, pos: int) -> tuple[str, int]:
    """Извлекает содержимое сбалансированных фигурных скобок начиная с pos (на '{')."""
    assert text[pos] == '{'
    depth = 0
    start = pos + 1
    for i in range(pos, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[start:i], i + 1
    # незакрытая скобка — берём до конца
    return text[start:], len(text)


def _convert_frac(text: str) -> str:
    """Конвертирует \\frac и \\dfrac с корректной обработкой вложенных скобок."""
    result = []
    i = 0
    while i < len(text):
        # Ищем ближайший \frac или \dfrac
        fi = text.find(r'\frac', i)
        di = text.find(r'\dfrac', i)

        if fi == -1 and di == -1:
            result.append(text[i:])
            break

        # Выбираем ближайший; при равенстве позиций предпочитаем \dfrac (длиннее)
        if di != -1 and (fi == -1 or di <= fi):
            m_start, cmd_len = di, len(r'\dfrac')
        else:
            m_start, cmd_len = fi, len(r'\frac')

        result.append(text[i:m_start])
        i = m_start + cmd_len
        while i < len(text) and text[i] == ' ':
            i += 1
        if i >= len(text) or text[i] != '{':
            result.append(text[m_start:i])
            continue
        num, i = _extract_balanced(text, i)
        while i < len(text) and text[i] == ' ':
            i += 1
        if i >= len(text) or text[i] != '{':
            result.append(f'\\frac{{{num}}}')
            continue
        den, i = _extract_balanced(text, i)
        # Рекурсивно обрабатываем числитель и знаменатель
        num_html = _convert_frac(num)
        den_html = _convert_frac(den)
        result.append(
            f'<span class="frac">'
            f'<span class="num">{num_html}</span>'
            f'<span class="den">{den_html}</span>'
            f'</span>'
        )
    return ''.join(result)


def _convert_sqrt(text: str) -> str:
    """Конвертирует \\sqrt[n]{x} и \\sqrt{x} с корректными вложенными скобками."""
    result = []
    i = 0
    while i < len(text):
        m = text.find(r'\sqrt', i)
        if m == -1:
            result.append(text[i:])
            break
        result.append(text[i:m])
        i = m + len(r'\sqrt')
        # необязательный аргумент [n]
        degree = ''
        if i < len(text) and text[i] == '[':
            end = text.find(']', i)
            if end != -1:
                degree = text[i + 1:end]
                i = end + 1
        # обязательный аргумент {x}
        if i < len(text) and text[i] == '{':
            arg, i = _extract_balanced(text, i)
            prefix = f'<sup>{degree}</sup>' if degree else ''
            result.append(f'{prefix}√<span class="sqrt-arg">{arg}</span>')
        else:
            result.append(r'\sqrt')
    return ''.join(result)


def _convert_environments(text: str) -> str:
    def replace_env(m):
        env_name = m.group(1)
        rows = re.split(r'\\\\', m.group(2))
        cleaned_rows = [row.replace('&', ' ').strip() for row in rows if row.strip()]

        if env_name == 'cases':
            # Рисуем большую фигурную скобку через таблицу
            rows_html = ''.join(
                f'<tr><td class="cases-row">{row}</td></tr>'
                for row in cleaned_rows
            )
            return (
                f'<table class="cases-table"><tbody>'
                f'<tr>'
                f'<td class="cases-brace" rowspan="{len(cleaned_rows)}">{{</td>'
                f'<td><table><tbody>{rows_html}</tbody></table></td>'
                f'</tr>'
                f'</tbody></table>'
            )

        html_rows = ''.join(
            f'<div class="math-row">{row}</div>'
            for row in cleaned_rows
        )
        return f'<div class="math-env">{html_rows}</div>'

    return _RE_ENV.sub(replace_env, text)


def _clean_html(text: str) -> str:
    text = text.replace('<br>', ' ').replace('<br/>', ' ').replace('<br />', ' ')
    text = _RE_HTML_TAGS.sub('', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
    text = text.replace('&lt;', '<').replace('&gt;', '>')
    text = _RE_NEWLINES.sub(' ', text)
    return _RE_MULTI_SPACE.sub(' ', text).strip()


def _convert_math_block(content: str, display: bool = False) -> str:
    content = _clean_html(content)

    # 1. Окружения первыми — внутри них тоже будет \dfrac и т.д.,
    #    которые обработаются рекурсивно через те же функции ниже.
    content = _convert_environments(content)

    # Текстовые команды
    content = _RE_TEXTBF.sub(r'<b>\1</b>', content)
    content = _RE_TEXTIT.sub(r'<i>\1</i>', content)
    content = _RE_TEXT.sub(r'\1', content)
    content = _RE_MATHBF.sub(r'<b>\1</b>', content)
    content = _RE_MATHIT.sub(r'<i>\1</i>', content)
    content = _RE_OVERLINE.sub(r'<span style="text-decoration:overline">\1</span>', content)
    content = _RE_UNDERLINE.sub(r'<u>\1</u>', content)

    # 2. Математические структуры
    content = _convert_frac(content)
    content = _convert_sqrt(content)

    # Степени и индексы
    content = _RE_POWER_GROUP.sub(r'<sup>\1</sup>', content)
    content = _RE_INDEX_GROUP.sub(r'<sub>\1</sub>', content)
    content = _RE_POWER_SINGLE.sub(r'<sup>\1</sup>', content)
    content = _RE_INDEX_SINGLE.sub(r'<sub>\1</sub>', content)

    # Символы и функции
    for latex, sym in MATH_SYMBOLS.items():
        content = content.replace(latex, sym)
    content = _RE_FUNC.sub(lambda m: f'<span class="mf">{m.group(1)}</span>', content)
    for latex, sym in BRACKET_MAP.items():
        content = content.replace(latex, sym)

    # Убираем служебные команды
    content = _RE_SPACING.sub('\u2009', content)
    content = _RE_STYLE.sub('', content)
    content = _RE_UNKNOWN_CMD.sub('', content)
    content = _RE_BRACES.sub('', content)
    content = content.strip()

    tag = 'div class="math-display"' if display else 'span class="math-inline"'
    close = tag.split()[0]
    return f'<{tag}>{content}</{close}>'


def process_latex(html_text: str) -> str:
    """
    Конвертирует TipTap HTML в HTML пригодный для WeasyPrint.

    TipTap хранит формулы как:
        <span data-type="math" data-latex="\\frac{x}{y}"></span>

    Картинки и структура (<p>, <strong>, <img>) сохраняются без изменений.
    """
    if not html_text:
        return html_text

    def replace_math_span(m):
        latex = m.group(1)
        # Блочные формулы: cases, align, или формула стоит одна в абзаце
        display = any(cmd in latex for cmd in (
            r'\begin', r'\[', r'\dfrac',
        ))
        return _convert_math_block(latex, display=display)

    # Заменяем <span data-type="math" data-latex="...">...</span>
    html_text = re.sub(
        r'<span[^>]*data-type=["\']math["\'][^>]*data-latex=["\']([^"\']+)["\'][^>]*>.*?</span>',
        replace_math_span,
        html_text,
        flags=re.DOTALL,
    )
    # Поддержка обратной совместимости со старым форматом \[...\] и $...$
    # (если задачи были введены в старом CKEditor)
    html_text = _RE_DISPLAY.sub(lambda m: _convert_math_block(m.group(1), display=True), html_text)
    html_text = _RE_INLINE_PAREN.sub(lambda m: _convert_math_block(m.group(1)), html_text)
    html_text = _RE_INLINE_DOLLAR.sub(lambda m: _convert_math_block(m.group(1)), html_text)

    return html_text


# =====================================================
# PDF VIEW
# =====================================================

MATH_CSS = mark_safe("""<style>
.math-display { display: block; text-align: center; margin: .8em 0; font-size: 1.1em; }
.math-inline  { display: inline; }
.frac         { display: inline-block; vertical-align: middle; text-align: center; margin: 0 .15em; }
.num          { display: block; border-bottom: 1px solid #000; padding: 0 .2em .1em; min-width: 1em; }
.den          { display: block; padding: .1em .2em 0; }
.sqrt-arg     { border-top: 1px solid #000; padding: 0 .1em; }
.math-env     { display: block; margin: .5em 0 .5em 1em; }
.math-row     { display: block; margin: .2em 0; }
.cases-table  { display: inline-table; vertical-align: middle; border-collapse: collapse; margin: .3em 0; }
.cases-brace  { font-size: 2.2em; line-height: 1; padding-right: .15em; vertical-align: middle; font-family: serif; font-weight: 100; }
.cases-row    { padding: .15em 0; }
.mf           { font-style: normal; }
sup { font-size: .75em; vertical-align: super; }
sub { font-size: .75em; vertical-align: sub; }
</style>""")


def variant_pdf(request, level, subject, variant_id):
    variant = get_object_or_404(Variant, id=variant_id)

    contents = (
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )

    processed_contents = []
    seen_parts = []
    answers_by_part = {}

    for item in contents:
        rendered_text = mark_safe(process_latex(str(item.task.task_template)))
        part = item.task.task.part.part_title if item.task.task.part else None

        if part not in seen_parts:
            seen_parts.append(part)

        entry = {
            "order": item.order,
            "text": rendered_text,
            "answer": item.task.answer,
            "part": part,
            "file_url": request.build_absolute_uri(item.task.files.url) if item.task.files else None,
        }
        processed_contents.append(entry)
        answers_by_part.setdefault(part or "Без части", []).append(entry)

    answers_parts = [
        {"part": p, "items": answers_by_part[p]}
        for p in seen_parts
        if (p or "Без части") in answers_by_part
    ]

    html_string = render_to_string("pdf_template.html", {
        "variant": variant,
        "contents": processed_contents,
        "answers_parts": answers_parts,
        "math_styles": MATH_CSS,
    })

    pdf = WeasyHTML(
        string=html_string,
        base_url=request.build_absolute_uri('/'),
    ).write_pdf()

    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="variant_{variant_id}.pdf"'
    return response


def variant_pdfSpring(request, level, subject, variant_id):
    variant = get_object_or_404(Variant, id=variant_id)

    contents = (
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )

    processed_contents = []
    seen_parts = []
    answers_by_part = {}

    for item in contents:
        rendered_text = mark_safe(process_latex(str(item.task.task_template)))
        part = item.task.task.part.part_title if item.task.task.part else None

        if part not in seen_parts:
            seen_parts.append(part)

        entry = {
            "order": item.order,
            "text": rendered_text,
            "answer": item.task.answer,
            "part": part,
            "file_url": request.build_absolute_uri(item.task.files.url) if item.task.files else None,
        }
        processed_contents.append(entry)
        answers_by_part.setdefault(part or "Без части", []).append(entry)

    answers_parts = [
        {"part": p, "items": answers_by_part[p]}
        for p in seen_parts
        if (p or "Без части") in answers_by_part
    ]

    html_string = render_to_string("pdf_templateSpring.html", {
        "variant": variant,
        "contents": processed_contents,
        "answers_parts": answers_parts,
        "math_styles": MATH_CSS,
    })

    pdf = WeasyHTML(
        string=html_string,
        base_url=request.build_absolute_uri('/'),
    ).write_pdf()

    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="variant_{variant_id}.pdf"'
    return response