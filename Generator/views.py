from django.http import JsonResponse
from django.shortcuts import render
from .models import Subject, TaskImage, TaskList, Task, Level
import json
import re


def index(request):
    return render(request, 'index.html')

def subject(request, level):
    return render(request, 'subject.html', {'level':level})

def tasks(request, level, subject):
    subject_instance = Subject.objects.get(subject_short=subject)
    level_instance = Level.objects.get(level=level)
    task_list = TaskList.objects.filter(subject=subject_instance).filter(level=level_instance)
    return render(request, 'tasks.html', {
        'subject_short': subject_instance.subject_short,
        'subject_name': subject_instance.subject_name,
        'task_list': task_list,
        'level' : level_instance,
    })


def parse_task_text(text, images):
    """
    Парсит текст задачи, заменяя маркеры на HTML
    
    Поддерживаемые маркеры:
    [IMG_1], [IMG_2] - изображения
    **текст** - жирный
    *текст* - курсив
    [MORSE]...[/MORSE] - код Морзе
    [CODE]...[/CODE] - блок кода
    [TABLE]...[/TABLE] - таблица
    [SUB]текст[/SUB] - нижний индекс
    """
    
    # Замена изображений
    for i, img in enumerate(images, start=1):
        text = text.replace(
            f"[IMG_{i}]",
            f"<div class='task-image'><img src='{img.task_img.url}' alt='Изображение {i}'></div>"
        )
    
    # Жирный текст: **текст** → <strong>текст</strong>
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    
    # Курсив: *текст* → <em>текст</em>
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)\*(?!\*)', r'<em>\1</em>', text)
    
    # Код Морзе: [MORSE]...[/MORSE]
    text = re.sub(
        r'\[MORSE\](.+?)\[/MORSE\]',
        r"<p class='morse'>\1</p>",
        text,
        flags=re.DOTALL
    )
    
    # Блок кода: [CODE]...[/CODE]
    text = re.sub(
        r'\[CODE\](.+?)\[/CODE\]',
        r'<pre>\1</pre>',
        text,
        flags=re.DOTALL
    )
    
    # Таблица: [TABLE]...[/TABLE]
    def parse_table(match):
        table_content = match.group(1).strip()
        rows = [row.strip() for row in table_content.split('\n') if row.strip()]
        
        html = '<table>'
        for i, row in enumerate(rows):
            cells = [cell.strip() for cell in row.split('|') if cell.strip()]
            html += '<tr>'
            tag = 'th' if i == 0 else 'td'
            for cell in cells:
                html += f'<{tag}>{cell}</{tag}>'
            html += '</tr>'
        html += '</table>'
        return html
    
    text = re.sub(r'\[TABLE\](.+?)\[/TABLE\]', parse_table, text, flags=re.DOTALL)
    
    # Нижний индекс: [SUB]2[/SUB] → <span class="sub">2</span>
    text = re.sub(r'\[SUB\](.+?)\[/SUB\]', r'<span class="sub">\1</span>', text)
    
    # Переносы строк → <p>
    paragraphs = text.split('\n\n')
    text = ''.join(f'<p>{p.strip()}</p>' for p in paragraphs if p.strip())
    
    return text


def variant(request, level, subject):
    
    # сохраняем выбранные параметры
    if request.method == 'POST':
        request.session['variant_data'] = json.loads(request.body)
        return JsonResponse({'status': 'ok'})

    data = request.session.get('variant_data', {})
    selected_tasks = []

    # выбираем случайные задачи с подгрузкой изображений
    for tasklist_id, count in data.items():
        random_tasks = list(
            Task.objects
            .filter(task_id=tasklist_id)
            .prefetch_related('images')
            .order_by('?')[:int(count)]
        )
        selected_tasks.extend(random_tasks)

    # парсинг текста с заменой маркеров
    for task in selected_tasks:
        images = list(task.images.all())
        task.rendered_text = parse_task_text(task.task_text, images)

    return render(
        request,
        f'{level}/{subject}.html',
        {'tasks': selected_tasks}
    )