from django.http import HttpResponse, JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from .models import Subject, TaskList, Task, Level, Variant, VariantContent
from django.template.loader import render_to_string

import json
import secrets
import subprocess
import re
from latex2mathml.converter import convert as latex_to_mathml

from django.conf import settings
from pathlib import Path

from weasyprint import HTML as WeasyHTML
from weasyprint import HTML

# =====================================================
# HTML VIEWS (старый режим)
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

    return render(
        request,
        'tasks.html',
        {
            'subject_short': subject_instance.subject_short,
            'subject_name': subject_instance.subject_name,
            'task_list': task_list,
            'level': level_instance,
        }
    )


@require_http_methods(["POST"])
def generate_variant(request, level, subject):
    try:
        subject_instance = get_object_or_404(Subject, subject_short=subject)
        level_instance = get_object_or_404(Level, level=level)

        data = json.loads(request.body)
        selected_tasks = []

        for tasklist_id, count in data.items():
            random_tasks = list(
                Task.objects
                .filter(task_id=tasklist_id)
                .order_by('?')[:int(count)]
            )
            selected_tasks.extend(random_tasks)

        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by="ADMIN",
            share_token=secrets.token_urlsafe(12)
        )

        for index, task in enumerate(selected_tasks, start=1):
            VariantContent.objects.create(
                variant=new_variant,
                task=task,
                order=index,
            )

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

    tasks = [item.task for item in contents]

    return render(
        request,
        'pdf_template.html',
        {
            'tasks': tasks,
            'variant': variant
        }
    )


def shared_var(request, token):
    variant = get_object_or_404(Variant, share_token=token)
    return variant_detail(
        request,
        level=variant.level.level,
        subject=variant.var_subject.subject_short,
        variant_id=variant.id
    )


# =====================================================
# API VIEWS (SPA режим)
# =====================================================

@ensure_csrf_cookie
def api_csrf(request):
    """Устанавливает CSRF cookie для React"""
    return JsonResponse({"detail": "CSRF cookie set"})


def api_tasks(request, level, subject):
    subject_instance = get_object_or_404(Subject, subject_short=subject)
    level_instance = get_object_or_404(Level, level=level)

    task_list = (
        TaskList.objects
        .filter(subject=subject_instance, level=level_instance)
        .order_by('task_number')
    )

    data = {
        "subject_name": subject_instance.subject_name,
        "tasks": [
            {
                "id": task.id,
                "task_title": task.task_title,
                'part': task.part_id
            }
            for task in task_list
        ]
    }

    return JsonResponse(data)


@csrf_exempt
@require_http_methods(["POST"])
def api_generate_variant(request, level, subject):
    try:
        subject_instance = get_object_or_404(Subject, subject_short=subject)
        level_instance = get_object_or_404(Level, level=level)

        data = json.loads(request.body)
        selected_tasks = []

        for tasklist_id, count in data.items():
            random_tasks = list(
                Task.objects
                .filter(task_id=tasklist_id)
                .order_by('?')[:int(count)]
            )
            selected_tasks.extend(random_tasks)

        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by="ADMIN",
            share_token=secrets.token_urlsafe(12)
        )

        for index, task in enumerate(selected_tasks, start=1):
            VariantContent.objects.create(
                variant=new_variant,
                task=task,
                order=index,
            )

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

    data = {
        "id": variant.id,
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
        "tasks": [
            {
                "id": item.task.id,
                "number": item.order,
                "text": item.task.task_template,
                "answer": item.task.answer,
                "part": item.task.task.part_id,
                "file": item.task.files.url if item.task.files else None,
            }
            for item in contents
        ]
    }

    return JsonResponse(data)

from django.http import HttpResponse, JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from .models import Subject, TaskList, Task, Level, Variant, VariantContent
from django.template.loader import render_to_string
from django.utils.safestring import mark_safe

import json
import secrets
import re
import logging

from weasyprint import HTML as WeasyHTML

logger = logging.getLogger(__name__)

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
        subject_instance = get_object_or_404(Subject, subject_short=subject)
        level_instance = get_object_or_404(Level, level=level)
        data = json.loads(request.body)
        selected_tasks = []
        for tasklist_id, count in data.items():
            random_tasks = list(
                Task.objects.filter(task_id=tasklist_id).order_by('?')[:int(count)]
            )
            selected_tasks.extend(random_tasks)
        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by="ADMIN",
            share_token=secrets.token_urlsafe(12)
        )
        for index, task in enumerate(selected_tasks, start=1):
            VariantContent.objects.create(variant=new_variant, task=task, order=index)
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
    tasks = [item.task for item in contents]
    return render(request, 'exam.html', {'tasks': tasks, 'variant': variant})


def shared_var(request, token):
    variant = get_object_or_404(Variant, share_token=token)
    return variant_detail(
        request,
        level=variant.level.level,
        subject=variant.var_subject.subject_short,
        variant_id=variant.id
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
    data = {
        "subject_name": subject_instance.subject_name,
        "tasks": [
            {"id": task.id, "task_title": task.task_title, "part": task.part_id}
            for task in task_list
        ]
    }
    return JsonResponse(data)


@csrf_exempt
@require_http_methods(["POST"])
def api_generate_variant(request, level, subject):
    try:
        subject_instance = get_object_or_404(Subject, subject_short=subject)
        level_instance = get_object_or_404(Level, level=level)
        data = json.loads(request.body)
        selected_tasks = []
        for tasklist_id, count in data.items():
            random_tasks = list(
                Task.objects.filter(task_id=tasklist_id).order_by('?')[:int(count)]
            )
            selected_tasks.extend(random_tasks)
        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by="ADMIN",
            share_token=secrets.token_urlsafe(12)
        )
        for index, task in enumerate(selected_tasks, start=1):
            VariantContent.objects.create(variant=new_variant, task=task, order=index)
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
    data = {
        "id": variant.id,
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
        "tasks": [
            {
                "id": item.task.id,
                "number": item.order,
                "text": item.task.task_template,
                "answer": item.task.answer,
                "part": item.task.task.part_id,
                "file": item.task.files.url if item.task.files else None,
            }
            for item in contents
        ]
    }
    return JsonResponse(data)


# =====================================================
# LATEX → HTML конвертер для WeasyPrint
# =====================================================

# Символы операторов
MATH_SYMBOLS = {
    r'\times': '×', r'\div': '÷', r'\pm': '±', r'\mp': '∓',
    r'\cdot': '·', r'\neq': '≠', r'\leq': '≤', r'\geq': '≥',
    r'\approx': '≈', r'\equiv': '≡', r'\infty': '∞',
    r'\partial': '∂', r'\nabla': '∇', r'\exists': '∃',
    r'\forall': '∀', r'\in': '∈', r'\notin': '∉',
    r'\subset': '⊂', r'\supset': '⊃', r'\cup': '∪', r'\cap': '∩',
    r'\emptyset': '∅', r'\rightarrow': '→', r'\leftarrow': '←',
    r'\Rightarrow': '⇒', r'\Leftarrow': '⇐', r'\leftrightarrow': '↔',
    r'\alpha': 'α', r'\beta': 'β', r'\gamma': 'γ', r'\delta': 'δ',
    r'\epsilon': 'ε', r'\zeta': 'ζ', r'\eta': 'η', r'\theta': 'θ',
    r'\lambda': 'λ', r'\mu': 'μ', r'\nu': 'ν', r'\xi': 'ξ',
    r'\pi': 'π', r'\rho': 'ρ', r'\sigma': 'σ', r'\tau': 'τ',
    r'\phi': 'φ', r'\chi': 'χ', r'\psi': 'ψ', r'\omega': 'ω',
    r'\Gamma': 'Γ', r'\Delta': 'Δ', r'\Theta': 'Θ', r'\Lambda': 'Λ',
    r'\Pi': 'Π', r'\Sigma': 'Σ', r'\Phi': 'Φ', r'\Psi': 'Ψ', r'\Omega': 'Ω',
    r'\circ': '∘', r'\bullet': '•', r'\ldots': '…', r'\cdots': '⋯',
    r'\qquad': '  ', r'\quad': ' ', r'\ ': ' ', r'\,': ' ', r'\;': ' ',
}

MATH_FUNCTIONS = [
    'arcsin', 'arccos', 'arctan', 'arccot',
    'sinh', 'cosh', 'tanh', 'coth',
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'ln', 'log', 'lg', 'exp',
    'lim', 'max', 'min', 'sup', 'inf',
    'gcd', 'lcm', 'det', 'dim', 'ker', 'tr',
]

BRACKET_MAP = {
    r'\left(': '(', r'\right)': ')',
    r'\left[': '[', r'\right]': ']',
    r'\left\{': '{', r'\right\}': '}',
    r'\left|': '|', r'\right|': '|',
    r'\lbrace': '{', r'\rbrace': '}',
    r'\langle': '⟨', r'\rangle': '⟩',
}


def _clean_html_from_latex(text: str) -> str:
    """Убирает HTML-мусор из LaTeX (br-теги, &nbsp; и т.д. от CKEditor)"""
    text = re.sub(r'<br\s*/?>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
    text = text.replace('&lt;', '<').replace('&gt;', '>')
    text = re.sub(r'[\r\n]+', ' ', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def _convert_fractions(text: str) -> str:
    """Конвертирует \frac{a}{b} → HTML дробь"""
    pattern = r'\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}'
    def replace(m):
        num, den = m.group(1).strip(), m.group(2).strip()
        return (
            f'<span class="frac">'
            f'<span class="num">{num}</span>'
            f'<span class="den">{den}</span>'
            f'</span>'
        )
    prev = None
    while prev != text:
        prev = text
        text = re.sub(pattern, replace, text)
    return text


def _convert_sqrt(text: str) -> str:
    """Конвертирует \sqrt{x} и \sqrt[n]{x}"""
    # \sqrt[n]{arg}
    text = re.sub(
        r'\\sqrt\[([^\]]+)\]\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}',
        lambda m: f'<sup>{m.group(1)}</sup>√<span class="sqrt-arg">{m.group(2)}</span>',
        text
    )
    # \sqrt{arg}
    text = re.sub(
        r'\\sqrt\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}',
        lambda m: f'√<span class="sqrt-arg">{m.group(1)}</span>',
        text
    )
    return text


def _convert_powers_indexes(text: str) -> str:
    """Конвертирует ^{} и _{}"""
    text = re.sub(r'\^\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', r'<sup>\1</sup>', text)
    text = re.sub(r'_\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', r'<sub>\1</sub>', text)
    text = re.sub(r'\^([0-9a-zA-Zα-ωΑ-Ω])', r'<sup>\1</sup>', text)
    text = re.sub(r'_([0-9a-zA-Zα-ωΑ-Ω])', r'<sub>\1</sub>', text)
    return text


def _convert_text_commands(text: str) -> str:
    """Конвертирует \text{}, \textbf{}, \mathrm{} и т.д."""
    text = re.sub(r'\\textbf\{([^{}]+)\}', r'<b>\1</b>', text)
    text = re.sub(r'\\textit\{([^{}]+)\}', r'<i>\1</i>', text)
    text = re.sub(r'\\text\{([^{}]+)\}', r'\1', text)
    text = re.sub(r'\\mathrm\{([^{}]+)\}', r'\1', text)
    text = re.sub(r'\\mathbf\{([^{}]+)\}', r'<b>\1</b>', text)
    text = re.sub(r'\\mathit\{([^{}]+)\}', r'<i>\1</i>', text)
    text = re.sub(r'\\overline\{([^{}]+)\}', r'<span style="text-decoration:overline">\1</span>', text)
    text = re.sub(r'\\underline\{([^{}]+)\}', r'<u>\1</u>', text)
    return text


def _convert_environments(text: str) -> str:
    """Конвертирует окружения: aligned, cases, matrix и т.д."""
    def replace_env(m):
        env_name = m.group(1)
        content = m.group(2)
        # Заменяем \\ на перевод строки, & на пробел
        rows = re.split(r'\\\\', content)
        html_rows = []
        for row in rows:
            row = row.replace('&', ' ').strip()
            if row:
                html_rows.append(f'<div class="math-row">{row}</div>')
        return '<div class="math-env">' + ''.join(html_rows) + '</div>'

    text = re.sub(
        r'\\begin\{(aligned|align|cases|gather|equation)\*?\}(.*?)\\end\{\1\*?\}',
        replace_env,
        text,
        flags=re.DOTALL
    )
    return text


def _convert_symbols(text: str) -> str:
    """Заменяет LaTeX символы на Unicode"""
    for latex, symbol in MATH_SYMBOLS.items():
        text = text.replace(latex, symbol)
    for func in MATH_FUNCTIONS:
        text = re.sub(rf'\\{func}\b', f'<span class="mf">{func}</span>', text)
    for latex, sym in BRACKET_MAP.items():
        text = text.replace(latex, sym)
    # Убираем оставшиеся известные команды без аргументов
    text = re.sub(r'\\(,|;|!|:|thinspace|medspace|thickspace)', ' ', text)
    text = re.sub(r'\\(displaystyle|textstyle|scriptstyle|limits)', '', text)
    return text


def _convert_math_block(content: str, display: bool = False) -> str:
    """Конвертирует содержимое одного математического блока"""
    content = _clean_html_from_latex(content)
    content = _convert_environments(content)
    content = _convert_text_commands(content)
    content = _convert_fractions(content)
    content = _convert_sqrt(content)
    content = _convert_powers_indexes(content)
    content = _convert_symbols(content)
    # Убираем оставшиеся одиночные backslash-команды
    content = re.sub(r'\\[a-zA-Z]+', '', content)
    content = re.sub(r'[{}]', '', content)
    content = content.strip()

    if display:
        return f'<div class="math-display">{content}</div>'
    return f'<span class="math-inline">{content}</span>'


def process_latex(html_text: str) -> str:
    """
    Главная функция: находит LaTeX-формулы в тексте и конвертирует их в HTML.
    Порядок: \[...\] → \(...\) → $...$
    """
    if not html_text:
        return html_text

    # Блочные формулы \[ ... \]
    html_text = re.sub(
        r'\\\[(.*?)\\\]',
        lambda m: _convert_math_block(m.group(1), display=True),
        html_text, flags=re.DOTALL
    )
    # Inline \( ... \)
    html_text = re.sub(
        r'\\\((.*?)\\\)',
        lambda m: _convert_math_block(m.group(1), display=False),
        html_text, flags=re.DOTALL
    )
    # Inline $ ... $
    html_text = re.sub(
        r'\$(.+?)\$',
        lambda m: _convert_math_block(m.group(1), display=False),
        html_text
    )
    return html_text


# CSS стили для математики в PDF
MATH_CSS = """
<style>
    .math-display {
        display: block;
        text-align: center;
        margin: 0.8em 0;
        font-size: 1.1em;
    }
    .math-inline {
        display: inline;
    }
    .frac {
        display: inline-block;
        vertical-align: middle;
        text-align: center;
        margin: 0 0.15em;
    }
    .num {
        display: block;
        border-bottom: 1px solid #000;
        padding: 0 0.2em 0.1em;
        min-width: 1em;
    }
    .den {
        display: block;
        padding: 0.1em 0.2em 0;
    }
    .sqrt-arg {
        border-top: 1px solid #000;
        padding: 0 0.1em;
    }
    .math-env {
        display: block;
        margin: 0.5em 0 0.5em 1em;
    }
    .math-row {
        display: block;
        margin: 0.2em 0;
    }
    .mf {
        font-style: normal;
    }
    sup { font-size: 0.75em; vertical-align: super; }
    sub { font-size: 0.75em; vertical-align: sub; }
</style>
"""


# =====================================================
# PDF VIEW
# =====================================================

def variant_pdf(request, level, subject, variant_id):
    variant = get_object_or_404(Variant, id=variant_id)

    contents = (
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )

    processed_contents = []
    seen_parts = []  # список частей в порядке появления (без дублей)

    for item in contents:
        raw_text = str(item.task.task_template)
        rendered_text = process_latex(raw_text)
        part = item.task.task.part.part_title if item.task.task.part else None

        # Фиксируем порядок частей без дублей
        if part not in seen_parts:
            seen_parts.append(part)

        processed_contents.append({
            "order": item.order,
            "text": mark_safe(rendered_text),
            "answer": item.task.answer,
            "part": part,
            "file_url": request.build_absolute_uri(item.task.files.url)
                        if item.task.files else None,
        })

    # Группируем ответы по частям для страницы ответов
    answers_by_part = {}
    for item in processed_contents:
        p = item["part"] or "Без части"
        if p not in answers_by_part:
            answers_by_part[p] = []
        answers_by_part[p].append(item)

    # Передаём в шаблон список (часть, задания) в правильном порядке
    answers_parts = [
        {"part": p, "items": answers_by_part[p]}
        for p in seen_parts
        if p in answers_by_part
    ]

    html_string = render_to_string(
        "pdf_template.html",
        {
            "variant": variant,
            "contents": processed_contents,
            "answers_parts": answers_parts,
            "math_styles": mark_safe(MATH_CSS),
        }
    )

    pdf = WeasyHTML(
        string=html_string,
        base_url=request.build_absolute_uri('/')
    ).write_pdf()

    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="variant_{variant_id}.pdf"'
    return response