"""API and PDF views — React SPA."""
import json
import logging
import os
import re
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse
from urllib import request as urlrequest, error as urlerror
import secrets
import time
from datetime import datetime

import jwt as pyjwt

from django.conf import settings as django_settings
from django.core.signing import BadSignature, Signer
from django.db.models import Case, Count, IntegerField, Prefetch, Q, Value, When
from django.http import (
    FileResponse,
    HttpResponse,
    HttpResponseBadRequest,
    HttpResponseRedirect,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, render
from django.template.loader import render_to_string
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
try:
    from weasyprint import HTML as WeasyHTML
    _WEASYPRINT_OK = True
except Exception:
    WeasyHTML = None  # type: ignore[assignment,misc]
    _WEASYPRINT_OK = False

from .models import (
    Announcement,
    Criteria,
    ErrorReport,
    LessonRoom,
    Level,
    LinkedTaskGroup,
    Mark,
    Subject,
    SubTopic,
    SupportInfo,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    Update,
    Variant,
    VariantContent,
    username_for_created_by,
)
from .latex_utils import process_latex
from . import pdf_utils
from . import telegram_utils

logger = logging.getLogger(__name__)


def get_subject_for_api(subject_param):
    """Subject по short name из URL; регистр не важен (history == History)."""
    s = (subject_param or "").strip()
    return get_object_or_404(Subject, subject_short__iexact=s)


def _is_spa_lesson_join_path(level, subject):
    """React /:level/:subject не должен перехватывать /lesson/join — иначе в API уходит subject=join."""
    return (
        str(level or "").strip().lower() == "lesson"
        and str(subject or "").strip().lower() == "join"
    )


FAVICON_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
    b'<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">'
    b'<feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.18"/>'
    b'</filter></defs>'
    b'<rect width="1024" height="1024" fill="#2F6FFF"/>'
    b'<rect x="200" y="200" width="624" height="624" rx="140" fill="#5F8FFF" filter="url(#shadow)"/>'
    b'<path d="M660 340H420L560 512L420 684H660" fill="none" stroke="#FFFFFF" stroke-width="88" '
    b'stroke-linecap="round" stroke-linejoin="round"/></svg>'
)


def _subtopics_for_groups(subject_instance, level_instance, task_numbers):
    """Подтемы для групп: TaskGroup.subtopic + Task.subtopic + все SubTopic предмета/уровня."""
    if not task_numbers:
        return []
    matching_ids = (
        TaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
            taskgroupmember__task_number__in=task_numbers,
        )
        .annotate(mcnt=Count("taskgroupmember", distinct=True))
        .filter(mcnt=len(task_numbers))
        .values_list("id", flat=True)
        .distinct()
    )
    group_ids = list(matching_ids)
    from django.db.models import Count as DbCount

    by_sid = {}

    # 1) По TaskGroup.subtopic (пропускаем sid=None) — только если есть группы
    if group_ids:
        for row in (
            TaskGroup.objects.filter(id__in=group_ids)
            .values("subtopic_id")
            .annotate(cnt=DbCount("id"))
        ):
            sid = row["subtopic_id"]
            if sid is None:
                continue
            cnt = row["cnt"]
            st = SubTopic.objects.filter(id=sid).values_list("title", flat=True).first()
            by_sid[sid] = {"id": sid, "title": st or f"Подтема {sid}", "group_count": cnt, "display_count": cnt}

    # 2) Подтемы из Task.subtopic в группах (только если есть группы)
    if group_ids:
        for row in (
            TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__subtopic_id__isnull=False,
            )
            .values("task__subtopic_id")
            .annotate(cnt=DbCount("task_group_id", distinct=True))
        ):
            sid = row["task__subtopic_id"]
            if not sid:
                continue
            cnt = row["cnt"]
            if sid not in by_sid:
                st = SubTopic.objects.filter(id=sid).values_list("title", flat=True).first()
                by_sid[sid] = {"id": sid, "title": st or f"Подтема {sid}", "group_count": cnt, "display_count": cnt}
            else:
                by_sid[sid]["group_count"] = max(by_sid[sid]["group_count"], cnt)
                by_sid[sid]["display_count"] = max(by_sid[sid]["display_count"], cnt)

    # 3) Все SubTopic предмета/уровня — TaskList для наших номеров
    tasklist_ids = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
            task_number__in=task_numbers,
        ).values_list("id", flat=True)
    )
    for st in SubTopic.objects.filter(task_list_id__in=tasklist_ids).order_by("order", "title"):
        if st.id not in by_sid:
            cnt = TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__subtopic_id=st.id,
            ).values("task_group_id").distinct().count()
            task_cnt = Task.objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                task__task_number__in=task_numbers,
                subtopic_id=st.id,
            ).count()
            display_count = cnt if cnt > 0 else max(0, task_cnt // len(task_numbers))
            by_sid[st.id] = {"id": st.id, "title": st.title, "group_count": cnt, "display_count": display_count}

    # 4) Если всё ещё пусто — все SubTopic предмета/уровня (на случай разных частей)
    if not by_sid:
        all_tls = TaskList.objects.filter(
            subject=subject_instance, level=level_instance
        ).values_list("id", flat=True)
        for st in SubTopic.objects.filter(task_list_id__in=all_tls).order_by("order", "title")[:20]:
            cnt = TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__subtopic_id=st.id,
            ).values("task_group_id").distinct().count()
            task_cnt = Task.objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                subtopic_id=st.id,
            ).count()
            n_per_group = len(task_numbers)
            display_count = cnt if cnt > 0 else max(0, task_cnt // n_per_group)
            by_sid[st.id] = {"id": st.id, "title": st.title, "group_count": cnt, "display_count": display_count}

    return sorted(by_sid.values(), key=lambda x: (-x["group_count"], x["title"]))


def _normalize_content(data):
    if not isinstance(data, dict):
        return {}
    result = {}
    for k, v in data.items():
        if isinstance(v, dict):
            continue
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n > 0:
            result[str(k)] = n
    return result


def _linked_group_subtopic_config_key(task_numbers):
    """
    Канонический ключ для group_subtopic_config.
    Порядок номеров в LinkedTaskGroup.task_numbers и в JSON tasks[].task_numbers может различаться;
    без сортировки конфиг подтем не находился, и группы собирались без учёта выбранных подтем.
    """
    if not task_numbers:
        return tuple()
    ints = []
    for n in task_numbers:
        try:
            ints.append(int(n))
        except (TypeError, ValueError):
            continue
    return tuple(sorted(ints))


def _group_members_match_group(members, required_nums, expected_len):
    """Проверка: в группе ровно expected_len членов и множество номеров совпадает с required_nums."""
    if len(members) != expected_len:
        return False
    return {m.task_number for m in members} == required_nums


def _tasklist_id_for_number(id_by_number, n):
    """Сопоставление номера задания с TaskList.id (в id_by_number ключи — int из БД, n может быть str из JSON)."""
    if not id_by_number:
        return None
    if n in id_by_number:
        return id_by_number[n]
    try:
        return id_by_number.get(int(n))
    except (TypeError, ValueError):
        return None


def _parse_linked_task_numbers(raw):
    """
    LinkedTaskGroup.task_numbers в JSONField: числа или строки.
    Без int()-нормализации id_by_number.get("3") не находит ключ 3 → падаем в fallback
    и берём по одной случайной задаче на номер вместо целой TaskGroup.
    """
    if not raw:
        return []
    out = []
    for n in raw:
        try:
            out.append(int(n))
        except (TypeError, ValueError):
            return None
    return out


def favicon(request):
    return HttpResponse(FAVICON_SVG, content_type='image/svg+xml')


def yandex_webmaster_verification(request):
    """Файл подтверждения из корня репозитория или папки Django-проекта."""
    for base in (django_settings.BASE_DIR.parent, django_settings.BASE_DIR):
        p = os.path.join(base, "yandex_ef13ec5e267d285b.html")
        if os.path.isfile(p):
            return FileResponse(open(p, "rb"), content_type="text/html; charset=UTF-8")
    return HttpResponse("Verification file not found", status=404, content_type="text/plain; charset=UTF-8")


def react_app(request):
    frontend_dir = getattr(django_settings, 'FRONTEND_DIR', django_settings.BASE_DIR.parent / 'frontend' / 'dist')
    index_path = frontend_dir / 'index.html'
    if index_path.exists():
        with open(index_path, 'r', encoding='utf-8') as f:
            resp = HttpResponse(f.read(), content_type='text/html; charset=utf-8')
        # Иначе браузер/CDN держит старый index.html и подгружает старый бандл без новых экранов/карточек.
        resp["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp["Pragma"] = "no-cache"
        return resp
    return HttpResponse(
        "<div><h1>Frontend не собран</h1><p>Запусти <code>npm run build</code> в frontend/</p></div>",
        status=500,
    )


# Фильтр ФИПИ: автор пустой, 'ФИПИ' или содержит любое из этих слов (без учёта регистра)
_FIPI_AUTHOR_KEYWORDS = [
    "фипи", "fipi", "егкр", "егэ", "апробация", "открытый вариант", "открытый",
    "демоверсия", "демо", "досрочный",
]


def _get_fipi_q():
    """Единый фильтр ФИПИ: автор пустой, или 'ФИПИ', или содержит любое ключевое слово из списка."""
    return (
        Q(author__isnull=True)
        | Q(author__exact="")
        | Q(author__iexact="ФИПИ")
        | Q(author__icontains="фипи")
        | Q(author__icontains="fipi")
        | Q(author__icontains="ЕГКР")
        | Q(author__icontains="егэ")
        | Q(author__icontains="ЕГЭ")
        | Q(author__icontains="Апробация")
        | Q(author__icontains="Открытый вариант")
        | Q(author__icontains="Открытый")
        | Q(author__icontains="демоверсия")
        | Q(author__icontains="Демоверсия")
        | Q(author__icontains="демо")
        | Q(author__icontains="Досрочный")
    )


def _create_variant(subject_short, level_str, body_bytes, create=True, request=None):
    subject_instance = get_subject_for_api(subject_short)
    level_instance = get_object_or_404(Level, level=level_str)
    data = json.loads(body_bytes)

    # Глобальный флаг "только ФИПИ" (для варианта/теста)
    only_fipi = False
    if isinstance(data, dict):
        only_fipi = bool(data.get("only_fipi"))

    # Унифицированное извлечение content: либо из поля "content", либо из корневого словаря
    if isinstance(data, dict) and "content" in data:
        content = _normalize_content(data["content"])
    else:
        content = _normalize_content(data)
    # Дополнительно: для linked-групп из tasks обеспечиваем нужное кол-во ГРУПП по каждому слоту
    group_subtopic_config = {}  # key: _linked_group_subtopic_config_key -> {subtopic_ids, subtopic_counts}
    if isinstance(data, dict) and data.get("tasks"):
        content = dict(content)
        for t in data["tasks"]:
            if isinstance(t, dict):
                nums = tuple(t.get("task_numbers") or [])
                cnt = t.get("count")
                try:
                    cnt = int(cnt) if cnt is not None else 0
                except (TypeError, ValueError):
                    cnt = 0
                if nums and cnt > 0:
                    for n in nums:
                        try:
                            ni = int(n)
                        except (TypeError, ValueError):
                            continue
                        tl = TaskList.objects.filter(
                            subject=subject_instance,
                            level=level_instance,
                            task_number=ni,
                        ).values_list("id", flat=True).first()
                        if tl:
                            key = str(tl)
                            content[key] = max(content.get(key, 0), cnt)
                    # Подтемы для группы: subtopic_ids, subtopic_counts в самом элементе tasks
                    st_ids = t.get("subtopic_ids")
                    st_counts = t.get("subtopic_counts")
                    if st_ids is not None or (st_counts and isinstance(st_counts, dict)):
                        cfg = {}
                        if isinstance(st_ids, list):
                            cfg["subtopic_ids"] = [int(x) for x in st_ids if x is not None and str(x) not in ("", "all")]
                        else:
                            cfg["subtopic_ids"] = []
                        if isinstance(st_counts, dict):
                            cfg["subtopic_counts"] = {}
                            for k, v in st_counts.items():
                                if str(k) == "all":
                                    cfg["subtopic_counts"]["all"] = int(v) if v else 0
                                else:
                                    try:
                                        ki = int(k)
                                        n = int(v) if v else 0
                                        if n > 0:
                                            cfg["subtopic_counts"][ki] = n
                                    except (TypeError, ValueError):
                                        pass
                        else:
                            cfg["subtopic_counts"] = {}
                        if cfg["subtopic_ids"] or cfg["subtopic_counts"]:
                            cfg_key = _linked_group_subtopic_config_key(nums)
                            if cfg_key:
                                group_subtopic_config[cfg_key] = cfg
    tasklist_ids = [int(k) for k in content.keys()]
    # ОГЭ инф. №13: какие подтемы включать (текст / презентация); иначе — по одной задаче из каждой подтемы
    oge_inf_13_subtopics = None
    if isinstance(data, dict) and data.get("oge_inf_13_subtopics"):
        raw = data["oge_inf_13_subtopics"]
        if isinstance(raw, list):
            tmp = []
            for x in raw:
                if x is None or str(x).strip() == "":
                    continue
                try:
                    tmp.append(int(x))
                except (TypeError, ValueError):
                    continue
            oge_inf_13_subtopics = tmp or None

    subtopic_ids = None
    subtopic_counts = None
    if isinstance(data, dict) and data.get("subtopic_ids"):
        raw = data["subtopic_ids"]
        subtopic_ids = [int(x) for x in raw if x is not None and str(x).strip() != ""]
        if not subtopic_ids:
            subtopic_ids = None
    if isinstance(data, dict) and data.get("subtopic_counts") and isinstance(data["subtopic_counts"], dict):
        subtopic_counts = {}
        for k, v in data["subtopic_counts"].items():
            if isinstance(v, dict):
                continue
            try:
                n = int(v)
            except (TypeError, ValueError):
                continue
            if n > 0:
                try:
                    subtopic_counts[int(k)] = n
                except (TypeError, ValueError):
                    pass
        if not subtopic_counts:
            subtopic_counts = None
    if not content:
        raise ValueError("Не выбрано ни одного задания")

    # Тот же фильтр ФИПИ, что и в тренажёре (без учёта подтем)
    fipi_q = _get_fipi_q() if only_fipi else Q()

    tasklist_ids = [int(k) for k in content.keys()]

    ordered_tasklists = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
            id__in=tasklist_ids,
        ).order_by("task_number")
    )
    if not ordered_tasklists:
        raise ValueError("Указанные задания не найдены для этого предмета и уровня")

    id_by_number = {tl.task_number: tl.id for tl in ordered_tasklists}
    selected_tasks = []
    handled_tasklist_ids = set()


    def take_linked_groups(linked):
        """
        Целые TaskGroup из БД: случайный выбор групп, все задачи только из одной группы за раз.
        Подтема: группа подходит, если subtopic у TaskGroup совпадает ИЛИ у всех задач в группе
        один и тот же subtopic_id из выбранных (фильтр в Python — без ложных совпадений из-за JOIN).
        """
        from random import shuffle

        parsed = _parse_linked_task_numbers(linked.task_numbers)
        if parsed is None:
            return None, None
        task_numbers = parsed
        if not task_numbers:
            return None, None
        ids_for_group = [_tasklist_id_for_number(id_by_number, n) for n in task_numbers]
        if any(i is None for i in ids_for_group):
            return None, None
        cfg_key = _linked_group_subtopic_config_key(task_numbers)
        cfg = group_subtopic_config.get(cfg_key, {}) if cfg_key else {}
        st_counts = cfg.get("subtopic_counts") or {}
        st_ids = cfg.get("subtopic_ids") or []

        member_prefetch = Prefetch(
            "taskgroupmember_set",
            queryset=TaskGroupMember.objects.select_related("task").order_by("task_number"),
        )
        required_nums = set(task_numbers)
        n_per = len(task_numbers)

        def _linked_groups_base_qs(extra_filter=None):
            qs = (
                TaskGroup.objects.filter(
                    subject=subject_instance,
                    level=level_instance,
                    taskgroupmember__task_number__in=task_numbers,
                )
                .annotate(mcnt=Count("taskgroupmember", distinct=True))
                .filter(mcnt=n_per)
                .distinct()
            )
            if extra_filter is not None:
                qs = qs.filter(extra_filter)
            return qs

        def _group_matches_subtopic_filter(group, members, allowed_ids, require_null_group_subtopic=False):
            """allowed_ids: frozenset[int] или None. require_null: группа и все задачи без подтемы."""
            if require_null_group_subtopic:
                if group.subtopic_id is not None:
                    return False
                return members and all(m.task.subtopic_id is None for m in members)
            if allowed_ids is None:
                return True
            gsid = group.subtopic_id
            if gsid is not None and gsid in allowed_ids:
                return True
            task_subs = [m.task.subtopic_id for m in members]
            if not task_subs:
                return False
            u = set(task_subs)
            if len(u) != 1:
                return False
            only = task_subs[0]
            return only is not None and only in allowed_ids

        def _pick_random_full_groups(
            candidate_qs,
            num_groups_needed,
            allowed_subtopic_ids=None,
            require_null_group_subtopic=False,
            exclude_group_ids=None,
        ):
            if num_groups_needed <= 0:
                return []
            exclude_group_ids = exclude_group_ids or set()
            ids = list(candidate_qs.values_list("id", flat=True).distinct())
            shuffle(ids)
            picked_tasks = []
            used_gids = set()
            for gid in ids:
                if len(picked_tasks) >= num_groups_needed * n_per:
                    break
                if gid in used_gids or gid in exclude_group_ids:
                    continue
                group = (
                    TaskGroup.objects.filter(pk=gid)
                    .prefetch_related(member_prefetch)
                    .first()
                )
                if not group:
                    continue
                members = sorted(
                    group.taskgroupmember_set.all(),
                    key=lambda m: (m.task_number, m.id),
                )
                if not _group_members_match_group(members, required_nums, n_per):
                    continue
                if not _group_matches_subtopic_filter(
                    group, members, allowed_subtopic_ids, require_null_group_subtopic
                ):
                    continue
                tasks_row = [m.task for m in members]
                if only_fipi and fipi_q:
                    tids = [t.id for t in tasks_row]
                    if (
                        Task.objects.filter(id__in=tids)
                        .filter(fipi_q)
                        .count()
                        != len(tids)
                    ):
                        continue
                picked_tasks.extend(tasks_row)
                used_gids.add(gid)
            if len(picked_tasks) < num_groups_needed * n_per:
                return None
            return picked_tasks

        try:
            num_groups_wanted = int(min(content.get(str(i), 0) for i in ids_for_group))
        except (TypeError, ValueError):
            num_groups_wanted = 0
        if num_groups_wanted <= 0:
            return None, None

        base_plain = _linked_groups_base_qs()

        def _pick_plain(n):
            return _pick_random_full_groups(base_plain, n, None, False)

        wants_subtopic_cfg = bool(st_counts) or bool(st_ids)
        all_tasks = []

        if wants_subtopic_cfg:
            # Один выбор подтемы с count (типичный случай): одна целая группа за раз, не суммируем лишние ключи
            positive_counts = []
            for sid_raw, raw_cnt in st_counts.items():
                try:
                    c = int(raw_cnt) if raw_cnt is not None and raw_cnt != "" else 0
                except (TypeError, ValueError):
                    continue
                if c <= 0:
                    continue
                sk = sid_raw if isinstance(sid_raw, str) else str(sid_raw)
                if sk == "all":
                    positive_counts.append(("all", c))
                elif sid_raw is None or sk == "null":
                    positive_counts.append(("null", c))
                else:
                    try:
                        positive_counts.append((int(sid_raw), c))
                    except (TypeError, ValueError):
                        continue

            remaining = num_groups_wanted

            if positive_counts:
                # Если выбрана ровно одна числовая подтема — берём min(её count, remaining) групп с этой подтемой
                numeric_only = [x for x in positive_counts if isinstance(x[0], int)]
                all_all = [x for x in positive_counts if x[0] == "all"]
                all_null = [x for x in positive_counts if x[0] == "null"]

                if len(numeric_only) == 1 and not all_all and not all_null:
                    sid_i, c = numeric_only[0]
                    take = min(c, remaining)
                    part = _pick_random_full_groups(
                        base_plain, take, frozenset({sid_i}), False
                    )
                    if part:
                        all_tasks.extend(part)
                elif all_all and not numeric_only and not all_null:
                    take = min(all_all[0][1], remaining)
                    part = _pick_plain(take)
                    if part:
                        all_tasks.extend(part)
                elif all_null and not numeric_only and not all_all:
                    take = min(all_null[0][1], remaining)
                    part = _pick_random_full_groups(
                        base_plain, take, None, True
                    )
                    if part:
                        all_tasks.extend(part)
                else:
                    # Несколько подтем / смешанный выбор: по очереди, не больше remaining
                    for kind, c in positive_counts:
                        if remaining <= 0:
                            break
                        take = min(c, remaining)
                        if kind == "all":
                            part = _pick_plain(take)
                        elif kind == "null":
                            part = _pick_random_full_groups(
                                base_plain, take, None, True
                            )
                        else:
                            part = _pick_random_full_groups(
                                base_plain, take, frozenset({kind}), False
                            )
                        if not part:
                            all_tasks = []
                            break
                        all_tasks.extend(part)
                        remaining = num_groups_wanted - len(all_tasks) // n_per
            if not all_tasks and st_ids:
                allowed = frozenset(int(x) for x in st_ids)
                part = _pick_random_full_groups(
                    base_plain, num_groups_wanted, allowed, False
                )
                if part:
                    all_tasks.extend(part)

            need_tasks = num_groups_wanted * n_per
            if len(all_tasks) >= need_tasks:
                return all_tasks, ids_for_group
            short_groups = num_groups_wanted - len(all_tasks) // n_per
            if short_groups > 0 and all_tasks:
                picked_tids = [t.id for t in all_tasks]
                excl_gids = set(
                    TaskGroupMember.objects.filter(task_id__in=picked_tids).values_list(
                        "task_group_id", flat=True
                    )
                )
                extra = _pick_random_full_groups(
                    base_plain, short_groups, None, False, excl_gids
                )
                if extra:
                    all_tasks.extend(extra)
            if len(all_tasks) >= need_tasks:
                return all_tasks, ids_for_group
            # Не набрали с подтемой — одна/несколько любых целых групп по номерам
            if not all_tasks:
                fallback = _pick_plain(num_groups_wanted)
                if fallback:
                    return fallback, ids_for_group
            return None, None

        all_tasks = _pick_plain(num_groups_wanted)
        if all_tasks is None:
            return None, None
        return all_tasks, ids_for_group

    linked_defs = list(
        LinkedTaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
    )

    for tasklist in ordered_tasklists:
        tasklist_id = tasklist.id
        if tasklist_id in handled_tasklist_ids:
            continue
        count = content.get(str(tasklist_id), 0)
        if count <= 0:
            continue
        group_tasks, group_ids = None, None
        linked_for_slot = None
        for linked in linked_defs:
            nums = _parse_linked_task_numbers(linked.task_numbers)
            if nums is None:
                continue
            if nums and nums[0] == int(tasklist.task_number):
                linked_for_slot = linked
                group_tasks, group_ids = take_linked_groups(linked)
                break
        if linked_for_slot and group_tasks is None and group_ids is None:
            raise ValueError(
                "Для связанных заданий не удалось подобрать нужное число целых групп в базе "
                "(или при включённом «только ФИПИ» ни одна группа целиком не проходит фильтр). "
                "Добавьте группы в админке или ослабьте ограничения."
            )
        if group_tasks is not None and group_ids is not None:
            # Связанные группы уже отобраны (в т.ч. с учётом subtopic из group_subtopic_config)
            if only_fipi and fipi_q:
                task_numbers = []
                for linked in linked_defs:
                    nums = _parse_linked_task_numbers(linked.task_numbers)
                    if nums and nums[0] == int(tasklist.task_number):
                        task_numbers = nums
                        break
                n_per_group = len(task_numbers) if task_numbers else len(group_ids)
                fipi_ids = set(
                    Task.objects.filter(id__in=[t.id for t in group_tasks]).filter(fipi_q).values_list("id", flat=True)
                )
                for i in range(0, len(group_tasks), n_per_group):
                    chunk = group_tasks[i : i + n_per_group]
                    if len(chunk) == n_per_group and all(t.id in fipi_ids for t in chunk):
                        selected_tasks.extend(chunk)
            else:
                selected_tasks.extend(group_tasks)
            handled_tasklist_ids.update(group_ids)
            continue
        # Одиночные задания: берём случайные задачи (с фильтром по подтемам при выборе)
        qs = Task.objects.filter(task_id=tasklist_id)
        if only_fipi and fipi_q:
            qs = qs.filter(fipi_q)

        is_oge_inf_13 = (
            subject_instance.subject_short == "inf"
            and level_instance.level == "oge"
            and tasklist.task_number == 13
        )
        # Радио «текст / презентация»: только задачи выбранной подтемы (важнее глобальных subtopic_ids тренажёра)
        oge13_subtopic_locked = False
        if is_oge_inf_13 and oge_inf_13_subtopics:
            valid_oge13_ids = list(
                SubTopic.objects.filter(
                    task_list_id=tasklist_id,
                    id__in=oge_inf_13_subtopics,
                ).values_list("id", flat=True)
            )
            if valid_oge13_ids:
                qs = qs.filter(subtopic_id__in=valid_oge13_ids)
                oge13_subtopic_locked = True

        # Только подтемы, принадлежащие этому слоту (TaskList)
        slot_subtopic_ids = None
        if subtopic_ids:
            slot_subtopic_ids = list(
                SubTopic.objects.filter(
                    id__in=subtopic_ids, task_list_id=tasklist_id
                ).values_list("id", flat=True)
            )

        # Важно: при одновременной передаче subtopic_ids и subtopic_counts сначала
        # собираем задачи по счётчикам (точное кол-во на подтему). Иначе ветка
        # slot_subtopic_ids брала count случайных задач из объединения подтем и игнорировала counts.
        tasks_for_slot = None

        if oge13_subtopic_locked:
            tasks_for_slot = list(qs.order_by("?")[: int(count)])
        elif subtopic_counts:
            from random import shuffle
            count_ids = []
            for k in subtopic_counts:
                if str(k) in ("all", "null"):
                    continue
                try:
                    count_ids.append(int(k))
                except (TypeError, ValueError):
                    continue
            # Порядок подтем фиксирован (order в справочнике); внутри каждой подтемы — случайный выбор задач.
            # Между подтемами не перемешиваем: сначала все выбранные по первой подтеме, затем по второй и т.д.
            slot_subtopic_ids_for_counts = list(
                SubTopic.objects.filter(
                    id__in=count_ids,
                    task_list_id=tasklist_id,
                )
                .order_by("order", "title", "id")
                .values_list("id", flat=True)
            )
            pooled = []
            for sid in slot_subtopic_ids_for_counts:
                cnt = subtopic_counts.get(sid, subtopic_counts.get(str(sid), 0))
                cnt = int(cnt) if cnt else 0
                if cnt <= 0:
                    continue
                subset = list(
                    qs.filter(subtopic_id=sid).values_list("id", flat=True)
                )
                shuffle(subset)
                pooled.extend(subset[:cnt])
            if pooled:
                capped_ids = pooled[: int(count)]
                id_to_task = {
                    t.id: t
                    for t in Task.objects.filter(id__in=capped_ids)
                }
                tasks_for_slot = [
                    id_to_task[i] for i in capped_ids if i in id_to_task
                ]

        if tasks_for_slot is None:
            if slot_subtopic_ids:
                qf = qs.filter(subtopic_id__in=slot_subtopic_ids)
                tasks_for_slot = list(qf.order_by("?")[: int(count)])
            elif is_oge_inf_13 and not oge_inf_13_subtopics:
                st_ids_with_tasks = list(
                    qs.exclude(subtopic_id__isnull=True)
                    .values_list("subtopic_id", flat=True)
                    .distinct()
                )
                tasks_for_slot = []
                for sid in st_ids_with_tasks:
                    one = qs.filter(subtopic_id=sid).order_by("?").first()
                    if one:
                        tasks_for_slot.append(one)
                if not tasks_for_slot:
                    tasks_for_slot = list(qs.order_by("?")[: int(count)])
            else:
                tasks_for_slot = list(qs.order_by("?")[: int(count)])
        selected_tasks.extend(tasks_for_slot)

    if create:
        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by=username_for_created_by(request),
            share_token=secrets.token_urlsafe(12),
            content=content or {},
        )
        VariantContent.objects.bulk_create([
            VariantContent(variant=new_variant, task=task, order=index)
            for index, task in enumerate(selected_tasks, start=1)
        ])
        return new_variant
    return selected_tasks


@ensure_csrf_cookie
def api_csrf(request):
    return JsonResponse({"detail": "CSRF cookie set"})


def admin_logout_to_public_home(request):
    """Выход из Django-админки с редиректом на публичную главную (genurok.ru), а не на / текущего хоста."""
    from django.contrib.auth import logout as auth_logout
    from django.http import HttpResponseRedirect

    auth_logout(request)
    url = getattr(django_settings, "GENUROK_PUBLIC_HOME_URL", "http://genurok.ru/").strip()
    if not url.endswith("/"):
        url += "/"
    return HttpResponseRedirect(url)


LK_NAV_COOKIE_NAME = "lk_nav_gate"
LK_NAV_SIGNER_SALT = "lk_nav_gate_v1"


def _lk_nav_signer():
    return Signer(salt=LK_NAV_SIGNER_SALT)


def lk_nav_cookie_is_valid(request) -> bool:
    raw = (request.COOKIES.get(LK_NAV_COOKIE_NAME) or "").strip()
    if not raw:
        return False
    try:
        return _lk_nav_signer().unsign(raw) == "1"
    except BadSignature:
        return False


def lk_nav_password_configured() -> bool:
    return bool((getattr(django_settings, "LK_NAVIGATION_PASSWORD", "") or "").strip())


def lk_site_base_url() -> str:
    return getattr(django_settings, "LK_PUBLIC_URL", "http://lk.genurok.tw1.ru").rstrip("/")


def lk_user_nav_url() -> str:
    """Куда вести пользователя по кнопке «Личный кабинет» (дашборд при наличии LK_DASHBOARD_URL)."""
    dash = (getattr(django_settings, "LK_DASHBOARD_URL", "") or "").strip().rstrip("/")
    return dash or lk_site_base_url()


@require_http_methods(["GET"])
def api_site_config(request):
    """Публичные настройки для SPA: URL личного кабинета (не хардкодить в бандле VITE_)."""
    lk_base = lk_site_base_url()
    lk_nav = lk_user_nav_url()
    pwd_required = lk_nav_password_configured()
    return JsonResponse(
        {
            "lk_public_url": lk_base,
            "lk_nav_url": lk_nav,
            "lk_nav_password_required": pwd_required,
            "lk_nav_unlocked": (not pwd_required) or lk_nav_cookie_is_valid(request),
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_lk_nav_unlock(request):
    """Проверка пароля для перехода в ЛК; при успехе — подписанная cookie на несколько дней."""
    expected = (getattr(django_settings, "LK_NAVIGATION_PASSWORD", "") or "").strip()
    if not expected:
        return JsonResponse({"ok": True, "unlocked": True})
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)
    pwd = str((data or {}).get("password") or "")
    if pwd != expected:
        return JsonResponse({"ok": False, "error": "Неверный пароль"}, status=403)
    max_age = int(getattr(django_settings, "LK_NAV_COOKIE_MAX_AGE", 604800))
    response = JsonResponse({"ok": True, "unlocked": True})
    response.set_cookie(
        LK_NAV_COOKIE_NAME,
        _lk_nav_signer().sign("1"),
        max_age=max_age,
        httponly=True,
        samesite="Lax",
        secure=request.is_secure(),
        path="/",
    )
    return response


def api_tasks(request, level, subject):
    if _is_spa_lesson_join_path(level, subject):
        return JsonResponse({"subject_name": "", "tasks": []})
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)

    subtopic_ids = None
    if request.GET.get("subtopic_ids"):
        raw = request.GET.get("subtopic_ids", "").strip().split(",")
        subtopic_ids = [int(x) for x in raw if x.strip().isdigit()]
        if not subtopic_ids:
            subtopic_ids = None

    tasks_qs = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        ).annotate(count_task=Count("task")).order_by('task_number')
    )
    if subtopic_ids:
        id_to_count = dict(
            Task.objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                subtopic_id__in=subtopic_ids,
            )
            .values("task_id")
            .annotate(c=Count("id"))
            .values_list("task_id", "c")
        )
        for t in tasks_qs:
            t.count_task = id_to_count.get(t.id, 0)
    id_by_number = {tl.task_number: tl.id for tl in tasks_qs}
    tl_by_id = {tl.id: tl for tl in tasks_qs}

    linked_defs = list(
        LinkedTaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
    )

    # Collect all task_numbers from linked groups to batch-count in one query
    linked_number_sets = []
    for linked in linked_defs:
        task_numbers = _parse_linked_task_numbers(linked.task_numbers)
        if task_numbers is None or not task_numbers:
            continue
        ids_for_group = [_tasklist_id_for_number(id_by_number, n) for n in task_numbers]
        if any(i is None for i in ids_for_group):
            continue
        linked_number_sets.append((linked, task_numbers, ids_for_group))

    # Batch count available groups for all linked defs in one query per unique set
    linked_counts = {}
    for linked, task_numbers, ids_for_group in linked_number_sets:
        key = tuple(task_numbers)
        if key not in linked_counts:
            matching_ids = (
                TaskGroup.objects.filter(
                    subject=subject_instance,
                    level=level_instance,
                    taskgroupmember__task_number__in=task_numbers,
                )
                .annotate(mcnt=Count("taskgroupmember", distinct=True))
                .filter(mcnt=len(task_numbers))
                .values_list("id", flat=True)
                .distinct()
            )
            linked_counts[key] = matching_ids.count()

    linked_tasklist_ids = set()
    linked_group_items = []

    for linked, task_numbers, ids_for_group in linked_number_sets:
        key = tuple(task_numbers)
        groups_count = linked_counts.get(key, 0)
        subtopics = _subtopics_for_groups(subject_instance, level_instance, task_numbers)
        # Показываем linked_group, если есть группы ИЛИ подтемы с задачами (display_count > 0)
        has_subtopics_with_tasks = any((s.get("display_count") or 0) > 0 for s in subtopics)
        if groups_count == 0 and not has_subtopics_with_tasks:
            continue
        linked_tasklist_ids.update(ids_for_group)
        # Reuse already-loaded tasklist data instead of a new DB query
        tasklists = sorted(
            [tl_by_id[i] for i in ids_for_group if i in tl_by_id],
            key=lambda tl: tl.task_number,
        )
        linked_group_items.append({
            "type": "linked_group",
            "linked_key": "_".join(str(n) for n in task_numbers),
            "task_numbers": task_numbers,
            "tasks": [
                {
                    "tasklist_id": tl.id,
                    "task_number": tl.task_number,
                    "task_title": tl.task_title,
                    "part": tl.part_id,
                }
                for tl in tasklists
            ],
            "count_available": groups_count,
            "subtopics": subtopics,
        })

    groups = TaskGroup.objects.filter(
        subject=subject_instance,
        level=level_instance,
    )
    group_members = TaskGroupMember.objects.filter(
        task_group__in=groups
    ).select_related("task_group", "task", "task__task")

    group_dict = {}
    grouped_tasklist_ids = set(linked_tasklist_ids)

    group_tasklist_ids = [m.task.task_id for m in group_members if m.task.task_id]
    tasklist_counts = dict(
        TaskList.objects.filter(id__in=group_tasklist_ids)
        .annotate(count_task=Count("task"))
        .values_list("id", "count_task")
    ) if group_tasklist_ids else {}

    for member in group_members:
        group_id = member.task_group_id
        tl_id = member.task.task_id
        if tl_id and tl_id in linked_tasklist_ids:
            continue
        if group_id not in group_dict:
            group_dict[group_id] = {
                "type": "group",
                "group_id": group_id,
                "tasks": [],
            }
        tl = member.task.task
        group_dict[group_id]["tasks"].append({
            "id": member.task.id,
            "tasklist_id": tl_id,
            "task_number": member.task_number,
            "task_title": tl.task_title if tl else "",
            "part": tl.part_id if tl else None,
            "count_task": tasklist_counts.get(tl_id, 0),
        })
        if tl_id:
            grouped_tasklist_ids.add(tl_id)

    # Добавляем подтемы для каждой группы
    for group_id, gd in group_dict.items():
        task_nums = sorted({t["task_number"] for t in gd["tasks"]})
        gd["subtopics"] = _subtopics_for_groups(subject_instance, level_instance, task_nums)
        gd["task_numbers"] = task_nums

    result = []
    for t in tasks_qs:
        if t.id in grouped_tasklist_ids:
            continue
        if subtopic_ids and (t.count_task or 0) <= 0:
            continue
        result.append({
            "type": "single",
            "id": t.id,
            "task_number": t.task_number,
            "task_title": t.task_title,
            "part": t.part_id,
            "count_task": t.count_task,
        })

    linked_task_number_sets = {frozenset(item["task_numbers"]) for item in linked_group_items}
    for gd in group_dict.values():
        gd_nums = frozenset(gd.get("task_numbers") or [])
        if gd_nums not in linked_task_number_sets:
            result.append(gd)
    # Дедупликация linked_group по task_numbers (на случай дублей в БД или разных TaskList для одних номеров)
    seen_task_nums = set()
    deduped_linked = []
    for item in linked_group_items:
        key = frozenset(item.get("task_numbers") or [])
        if key in seen_task_nums:
            continue
        seen_task_nums.add(key)
        deduped_linked.append(item)
    result.extend(deduped_linked)

    # Fallback: задания, попавшие в grouped_tasklist_ids, но не отображающиеся ни в одной группе
    # (напр. LinkedTaskGroup без групп/подтем — скипнули, а TaskGroup с тем же номером не добавили)
    shown_task_numbers = set()
    for item in result:
        if item.get("type") == "single":
            shown_task_numbers.add(item.get("task_number"))
        else:
            for t in item.get("tasks") or []:
                shown_task_numbers.add(t.get("task_number"))
    for t in tasks_qs:
        if t.id in grouped_tasklist_ids and t.task_number not in shown_task_numbers:
            result.append({
                "type": "single",
                "id": t.id,
                "task_number": t.task_number,
                "task_title": t.task_title,
                "part": t.part_id,
                "count_task": t.count_task,
            })

    def sort_key(item):
        if item["type"] == "single":
            return item["task_number"]
        if item["type"] == "linked_group":
            return min(item["task_numbers"])
        return min(task["task_number"] for task in item["tasks"])

    result = sorted(result, key=sort_key)

    resp = {
        "subject_name": subject_instance.subject_name,
        "tasks": result
    }
    # Диагностика: при ?debug=1 показывать, почему linked_group может не отображаться
    if request.GET.get("debug") == "1":
        debug_linked = []
        for linked in LinkedTaskGroup.objects.filter(
            subject=subject_instance, level=level_instance
        ):
            tn = linked.task_numbers or []
            parsed = _parse_linked_task_numbers(tn)
            ids_for = (
                [_tasklist_id_for_number(id_by_number, n) for n in parsed]
                if parsed is not None
                else []
            )
            missing = (
                [n for n, i in zip(parsed, ids_for) if i is None]
                if parsed is not None
                else list(tn)
            )
            key = tuple(parsed) if parsed is not None and parsed else ()
            cnt = linked_counts.get(key, 0)
            debug_linked.append({
                "task_numbers_in_db": tn,
                "missing_in_tasklist": missing if missing else None,
                "groups_count": cnt,
                "skipped_reason": (
                    "empty_task_numbers" if not tn else
                    "invalid_task_numbers" if parsed is None else
                    "tasklist_missing" if missing else
                    "no_groups" if cnt == 0 else None
                ),
            })
        resp["_debug_linked"] = debug_linked
    return JsonResponse(resp)


def api_subtopics(request, level, subject):
    """GET: список подтем по номерам заданий и связанным группам для тренажёра."""
    if _is_spa_lesson_join_path(level, subject):
        return JsonResponse({"subtopics_by_task": []})
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)
 
    # --- Одиночные задания (старая логика) ---
    task_lists = (
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
        .filter(subtopics__isnull=False)
        .distinct()
        .order_by("task_number")
    )
 
    fipi_q = _get_fipi_q()
    out = []
 
    for tl in task_lists:
        subtopics = list(
            SubTopic.objects.filter(task_list=tl).order_by("order", "title").values("id", "title", "order")
        )
        if not subtopics:
            continue
        for st in subtopics:
            title = st["title"]
            base_qs = Task.objects.filter(task_id=tl.id, subtopic__title=title)
            st["task_count"] = base_qs.count()
            st["fipi_task_count"] = base_qs.filter(fipi_q).count()
        out.append({
            "task_list_id": tl.id,
            "task_number": tl.task_number,
            "task_title": tl.task_title,
            "subtopics": subtopics,
        })

    return JsonResponse({
        "subtopics_by_task": out,
    })

@csrf_exempt
@require_http_methods(["POST"])
def api_generate_variant(request, level, subject):
    try:
        new_variant = _create_variant(subject, level, request.body, request=request)
        return JsonResponse({'variant_id': new_variant.id})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


def api_variant_lookup(request, variant_id):
    variant = get_object_or_404(Variant.objects.select_related('level', 'var_subject'), id=variant_id)
    return JsonResponse({
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
    })


@require_http_methods(["GET"])
def api_criteria(request, level, subject):
    """Критерии по task_list_id или по (subject, level, task_number). Criteria привязаны к TaskList (номер задания)."""
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)

    tl_ids = []
    task_list_id = request.GET.get("task_list_id")
    task_number_param = request.GET.get("task_number")

    if task_list_id:
        try:
            tl_ids.append(int(task_list_id))
        except (TypeError, ValueError):
            pass
    if task_number_param is not None:
        try:
            tn = int(task_number_param)
            ids_by_num = list(
                TaskList.objects.filter(
                    subject=subject_instance,
                    level=level_instance,
                    task_number=tn,
                ).values_list("id", flat=True)
            )
            tl_ids = list(dict.fromkeys(tl_ids + ids_by_num))
        except (TypeError, ValueError):
            pass

    if not tl_ids:
        return JsonResponse({"criteria": []})

    criteria_list = list(
        Criteria.objects.filter(task_number_id__in=tl_ids)
        .order_by("-criteria_score", "id")
        .values("id", "criteria_text", "criteria_score")
    )
    for c in criteria_list:
        c["criteria_text"] = process_latex(str(c.get("criteria_text") or ""), for_browser=True)

    max_score = TaskList.objects.filter(id__in=tl_ids).order_by("-max_score").values_list("max_score", flat=True).first()
    max_score = max_score if max_score is not None else 1

    return JsonResponse({"criteria": criteria_list, "max_score": max_score})


def _variant_detail_payload(request, variant):
    """Единая сборка JSON варианта для API (по id)."""
    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related("task", "task__task", "task__subtopic")
        .order_by("order")
    )

    tasks_data = []
    for item in contents:
        task_list = item.task.task
        file_url = None
        if item.task.files:
            f = item.task.files
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

        if task_list:
            max_score = getattr(task_list, "max_score", 1)
        else:
            max_score = getattr(item.task, "max_score", None)
            if max_score is None:
                max_score = 1

        st = getattr(item.task, "subtopic", None)
        tasks_data.append({
            "id": item.task.id,
            "task_list_id": task_list.id if task_list else None,
            "number": task_list.task_number if task_list else item.order,
            "task_title": task_list.task_title if task_list else "",
            "text": process_latex(str(item.task.task_template or ""), for_browser=True),
            "answer": process_latex(str(item.task.answer or ""), for_browser=True),
            "part": task_list.part_id if task_list else None,
            "subdivision": (task_list.subdivision or "").strip() or None,
            "subtopic_id": st.id if st else None,
            "subtopic_title": (st.title or "").strip() if st else "",
            "file": file_url,
            "author": (item.task.author or "").strip() or None,
            "max_score": max_score,
        })

    return {
        "id": variant.id,
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
        "tasks": tasks_data,
    }


def api_variant_detail(request, level, subject, variant_id):
    variant = get_object_or_404(Variant.objects.select_related('level', 'var_subject'), id=variant_id)
    return JsonResponse(_variant_detail_payload(request, variant))


@require_http_methods(["GET"])
def api_lesson_variant_detail(request, variant_id):
    """Вариант для урока: всегда по /api, без зависимости от роутинга SPA."""
    variant = get_object_or_404(Variant.objects.select_related("level", "var_subject"), id=variant_id)
    return JsonResponse(_variant_detail_payload(request, variant))


@require_http_methods(["GET"])
def variant_detail_short_url(request, level, subject, variant_id):
    """Короткий URL без /api для получения JSON варианта в уроке и внешних интеграциях."""
    return api_variant_detail(request, level, subject, variant_id)


@require_http_methods(["GET"])
def api_score_conversion(request, level, subject):
    """Конвертация первичных баллов в вторичные по таблице Mark. Работает для всех предметов (subject_short в Mark)."""
    score = request.GET.get("score", "0")
    try:
        total = int(score)
    except ValueError:
        total = 0
    level_norm = (level or "").strip().lower()
    subject_norm = (subject or "").strip().lower()
    # Строки Mark по предмету и уровню (точный уровень или level=null для любого)
    qs = (
        Mark.objects
        .filter(subject__subject_short__iexact=subject_norm)
        .filter(Q(level__level__iexact=level_norm) | Q(level__isnull=True))
        .filter(score__lte=total)
        .select_related("comment")
    )
    # Сначала берём запись с подходящим уровнем, затем с максимальным score <= total
    qs = qs.annotate(
        level_match=Case(
            When(level__level__iexact=level_norm, then=Value(1)),
            default=Value(0),
            output_field=IntegerField(),
        )
    ).order_by("-level_match", "-score")
    mark_row = qs.first()
    if mark_row is None:
        return JsonResponse({"score_exam": None, "comment": None, "mark_level": None})
    score_exam = mark_row.score_exam
    comment = mark_row.comment.comment_text if mark_row.comment else None
    mark_level = mark_row.comment.mark_level if (mark_row.comment and mark_row.comment.mark_level) else None
    return JsonResponse({"score_exam": score_exam, "comment": comment, "mark_level": mark_level})


@require_http_methods(["GET"])
def api_support_info(request, level, subject):
    """Справочная информация по предмету и уровню — все записи."""
    from django.db.models import Q

    items = list(
        SupportInfo.objects
        .filter(subject__subject_short__iexact=(subject or "").strip())
        .filter(Q(level__level=level) | Q(level__isnull=True))
        .select_related("subject", "level")
        .order_by("-level_id")
    )
    result = [
        {"html": process_latex(str(info.info_text or ""), for_browser=True)}
        for info in items
    ]
    return JsonResponse({"items": result})


@require_http_methods(["GET"])
def api_updates(request):
    """Список обновлений платформы (только с show=True), по убыванию времени добавления."""
    items = list(
        Update.objects.filter(show=True).order_by("-created")[:20].values("id", "title", "description", "created")
    )
    for item in items:
        d = item.get("created")
        if d:
            try:
                item["created_display"] = d.strftime("%d.%m.%Y, %H:%M")
                item["created_iso"] = d.strftime("%Y-%m-%dT%H:%M:%S")
            except (AttributeError, TypeError):
                item["created_display"] = ""
                item["created_iso"] = ""
        else:
            item["created_display"] = ""
            item["created_iso"] = ""
        del item["created"]
    return JsonResponse({"updates": items})


@require_http_methods(["GET"])
def api_announcements(request):
    """Активные объявления для главной страницы (show=True), по порядку."""
    qs = Announcement.objects.filter(show=True).order_by("sort_order", "-created")[:10]
    def build_url(field):
        if field:
            try:
                return request.build_absolute_uri(field.url)
            except (ValueError, TypeError):
                pass
        return ""

    rows = []
    for obj in qs:
        rows.append({
            "id": obj.id,
            "title": obj.title,
            "body": str(obj.body or ""),
            "image_url": build_url(obj.corner_image),
            "button_label": obj.button_label,
            "button_url": obj.button_url,
            "background_url": build_url(obj.background),
            "has_button": bool(
                (obj.button_label or "").strip() and (obj.button_url or "").strip()
            ),
            "theme_overlay_url": build_url(obj.theme_overlay),
            "theme_header_bg_url": build_url(obj.theme_header_bg),
            "theme_logo_url": build_url(obj.theme_logo),
            "theme_decor_url": build_url(obj.theme_decor),
            "theme_worksheet_bg_url": build_url(obj.theme_worksheet_bg),
        })
    return JsonResponse({"announcements": rows})


@csrf_exempt
@require_http_methods(["POST"])
def report_pdf(request, level, subject):
    """Генерация PDF-отчёта по результатам выполнения варианта."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"error": "Неверный формат данных"}, status=400)

    variant_id = data.get("variantId")
    if not variant_id:
        return JsonResponse({"error": "Не указан вариант"}, status=400)

    variant = get_object_or_404(
        Variant.objects.select_related("var_subject", "level"),
        id=variant_id,
    )
    if (
        str(variant.var_subject.subject_short).lower() != str(subject).lower()
        or str(variant.level.level).lower() != str(level).lower()
    ):
        return JsonResponse({"error": "Вариант не соответствует уровню/предмету"}, status=400)

    student_name = (data.get("studentName") or "Ученик").strip() or "Ученик"
    start_time_raw = data.get("startTime") or ""
    end_time_raw = data.get("endTime") or ""
    total_time_formatted = data.get("totalTimeFormatted") or ""
    task_times = data.get("taskTimes") or {}
    scores = data.get("scores") or {}
    tasks = data.get("tasks") or []
    total_score = data.get("totalScore", 0)
    max_score = data.get("maxScore", 0)
    score_exam = data.get("scoreExam")
    score_comment = data.get("scoreComment") or ""
    mark_level = data.get("markLevel")

    # Время в отчёте — по компьютеру пользователя (передано с фронта в локальном формате)
    date_solution = (data.get("dateSolutionLocal") or "").strip()
    time_start = (data.get("timeStartLocal") or "").strip()
    time_end = (data.get("timeEndLocal") or "").strip()
    if not date_solution or not time_start:
        try:
            if start_time_raw:
                dt = datetime.fromisoformat(start_time_raw.replace("Z", "+00:00"))
                if not date_solution:
                    date_solution = dt.strftime("%d.%m.%Y")
                if not time_start:
                    time_start = dt.strftime("%H:%M:%S")
            if end_time_raw and not time_end:
                dt_end = datetime.fromisoformat(end_time_raw.replace("Z", "+00:00"))
                time_end = dt_end.strftime("%H:%M:%S")
        except (ValueError, TypeError):
            pass

    subject_label = {
        "inf": "Информатика",
        "math": "Математика",
    }.get(subject, variant.var_subject.subject_name or str(subject))
    level_val = str(level).lower()
    level_label = {"oge": "ОГЭ", "ege": "ЕГЭ"}.get(level_val, level_val.upper())
    if level_val.isdigit():
        level_label = f"{level_val} класс"

    subtopic_by_task_id = {}
    try:
        for vc in VariantContent.objects.filter(variant=variant).select_related("task__subtopic"):
            st = getattr(vc.task, "subtopic", None)
            if st and (st.title or "").strip():
                subtopic_by_task_id[vc.task_id] = (st.title or "").strip()
    except Exception:
        pass

    report_rows = []
    for t in tasks:
        tid = str(t.get("id", ""))
        tid_int = int(tid) if tid.isdigit() else None
        num = t.get("number", tid)
        title = t.get("task_title", "")
        st_raw = t.get("subtopic_title")
        subtopic_title = (st_raw or "").strip() if isinstance(st_raw, str) else ""
        if not subtopic_title and tid_int is not None:
            subtopic_title = subtopic_by_task_id.get(tid_int, "")
        max_s = t.get("max_score", 1)
        sc = scores.get(tid, scores.get(int(tid) if tid.isdigit() else tid, 0))
        sec = task_times.get(tid, task_times.get(int(tid) if tid.isdigit() else tid, 0))
        time_str = f"{sec} сек" if isinstance(sec, (int, float)) else ""
        report_rows.append({
            "number": num,
            "title": title,
            "subtopic_title": subtopic_title,
            "score": sc,
            "max_score": max_s,
            "time": time_str,
        })

    mid = (len(report_rows) + 1) // 2
    report_col1 = report_rows[:mid]
    report_col2 = report_rows[mid:]

    level_to_class = {1: "insufficient", 2: "threshold", 3: "average", 4: "high"}
    score_comment_class = level_to_class.get(mark_level, "") if mark_level else ""

    base_url = request.build_absolute_uri("/").rstrip("/") or "/"
    favicon_url = base_url + ("favicon.svg" if base_url.endswith("/") else "/favicon.svg")

    context = {
        "base_url": base_url,
        "favicon_url": favicon_url,
        "student_name": student_name,
        "subject_label": subject_label,
        "level_label": level_label,
        "variant_id": variant_id,
        "date_solution": date_solution,
        "time_start": time_start,
        "time_end": time_end,
        "total_time_formatted": total_time_formatted,
        "report_col1": report_col1,
        "report_col2": report_col2,
        "total_score": total_score,
        "max_score": max_score,
        "score_exam": score_exam,
        "score_comment": score_comment,
        "score_comment_class": score_comment_class,
        "pdf_css": pdf_utils.get_pdf_css(),
        "is_oge": level_val == "oge",
    }

    html_string = render_to_string("report_template.html", context)
    base_url = request.build_absolute_uri("/")

    if not _WEASYPRINT_OK:
        return HttpResponse("PDF недоступен: WeasyPrint не установлен", status=503, content_type="text/plain; charset=utf-8")

    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except Exception as e:
        logger.exception("WeasyPrint report PDF failed: %s", e)
        return HttpResponse("Ошибка генерации PDF", status=500, content_type="text/plain; charset=utf-8")

    safe_name = "".join(c if c.isalnum() or c in " -_" else "-" for c in student_name).strip() or "report"
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="report-{safe_name}.pdf"'
    return response


def _render_variant_pdf(request, level, subject, variant_id, background_url="", theme="default"):

    author_filter = (request.GET.get("author") or "").strip() or None
    cache_path = pdf_utils.get_pdf_cache_path(variant_id, theme, author_filter)
    nocache = request.GET.get("nocache", "").lower() in ("1", "true", "yes")
    if django_settings.DEBUG:
        nocache = True  # В режиме разработки всегда перегенерируем PDF
    if os.path.exists(cache_path) and not nocache:
        f = open(cache_path, "rb")
        try:
            return FileResponse(f, content_type="application/pdf")
        except Exception:
            f.close()
            raise

    variant = get_object_or_404(Variant, id=variant_id)
    try:
        context = pdf_utils.build_pdf_context(request, variant, subject, author_filter=author_filter)
    except Exception as e:
        logger.exception("PDF build_pdf_context failed for variant %s: %s", variant_id, e)
        return HttpResponse("Ошибка подготовки PDF", status=500, content_type="text/plain; charset=utf-8")

    context["background_url"] = background_url

    html_string = render_to_string("pdf_template.html", context)
    base_url = request.build_absolute_uri('/')

    if not _WEASYPRINT_OK:
        return HttpResponse("PDF недоступен: WeasyPrint не установлен", status=503, content_type="text/plain; charset=utf-8")

    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except IndexError:
        html_safe = re.sub(r'<div class="task-body">\s*</div>', '<div class="task-body"><p>&nbsp;</p></div>', html_string)
        html_safe = re.sub(r'<span class="answer-field">\s*</span>', '<span class="answer-field">&nbsp;</span>', html_safe)
        pdf = WeasyHTML(string=html_safe, base_url=base_url).write_pdf()
    except Exception as e:
        logger.exception("WeasyPrint PDF generation failed for variant %s: %s", variant_id, e)
        return HttpResponse("Ошибка генерации PDF", status=500, content_type="text/plain; charset=utf-8")

    try:
        with open(cache_path, "wb") as f:
            f.write(pdf)
    except OSError as e:
        logger.warning("Could not cache PDF to %s: %s", cache_path, e)

    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="variant_{variant_id}.pdf"'
    return response


def _get_announcement_worksheet_bg(request, theme=None):
    """Ищет активное объявление с заполненным theme_worksheet_bg, фильтруя по теме."""
    qs = (
        Announcement.objects
        .filter(show=True, theme_worksheet_bg__isnull=False)
        .exclude(theme_worksheet_bg="")
        .order_by("sort_order", "-created")
    )
    if theme == "easter":
        qs = qs.filter(title__iregex=r'пасх|easter')
    elif theme == "cosmos":
        qs = qs.filter(title__iregex=r'косм|cosmos|space')
    obj = qs.first()
    if obj and obj.theme_worksheet_bg:
        try:
            return request.build_absolute_uri(obj.theme_worksheet_bg.url)
        except (ValueError, TypeError):
            pass
    return ""


def variant_pdf(request, level, subject, variant_id):
    theme = request.GET.get("theme", "").lower()
    background_url = ""
    if theme == "cosmos":
        background_url = pdf_utils.resolve_background_image("img/cosmos.png", request=request)
    elif theme == "easter":
        background_url = pdf_utils.resolve_background_image("img/easter.png", request=request)
    return _render_variant_pdf(
        request,
        level,
        subject,
        variant_id,
        background_url=background_url,
        theme=theme or "default",
    )


def variant_pdfCosmos(request, level, subject, variant_id):
    """PDF варианта с космической темой (алиас для /pdf/cosmos)."""
    background_url = pdf_utils.resolve_background_image("img/cosmos.png", request=request)
    return _render_variant_pdf(
        request,
        level,
        subject,
        variant_id,
        background_url=background_url,
        theme="cosmos",
    )


def search_task(request):
    q = (request.GET.get("q") or "").strip()
    if not q or not q.isdigit():
        return JsonResponse({"tasks": []})

    task = Task.objects.filter(id=int(q)).select_related("task").first()
    if not task or not task.task:
        return JsonResponse({"tasks": []})

    return JsonResponse({
        "tasks": [{
            "id": task.id,
            "task_number": task.task.task_number,
            "task_text": process_latex(str(task.task_template or ""), for_browser=True),
            "answer": task.answer,
        }]
    })


def search_variant(request):
    q = (request.GET.get("q") or "").strip()
    if not q or not q.isdigit():
        return JsonResponse({"variant": None, "tasks": []})

    variant = Variant.objects.filter(id=int(q)).select_related("var_subject", "level").first()
    if not variant:
        return JsonResponse({"variant": None, "tasks": []})

    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related("task")
        .order_by("order")
    )
    tasks = [
        {"number": item.order, "id": item.task.id, "answer": item.task.answer}
        for item in contents
    ]
    return JsonResponse({
        "variant": {
            "id": variant.id,
            "level": variant.level.level,
            "subject": variant.var_subject.subject_short,
            "subject_name": variant.var_subject.subject_name,
        },
        "tasks": tasks,
    })


@csrf_exempt
@require_http_methods(["POST"])
def report_error(request, level, subject):
    """Приём отчёта об ошибке и сохранение в базу данных."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"error": "Неверный формат данных"}, status=400)

    task_id = data.get("taskId")
    task_number = data.get("taskNumber")
    error_type = data.get("errorType")
    comment = (data.get("comment") or "").strip()
    variant_id = data.get("variantId")

    if not error_type:
        return JsonResponse({"error": "Не указан тип ошибки"}, status=400)

    try:
        ErrorReport.objects.create(
            subject=str(subject),
            level=str(level),
            task_number=int(task_number) if task_number is not None else None,
            task_id=int(task_id) if task_id is not None else None,
            variant_id=int(variant_id) if variant_id is not None else None,
            error_type=str(error_type),
            comment=comment,
        )
    except Exception:
        logger.exception("Не удалось сохранить ErrorReport")
        return JsonResponse({"error": "Не удалось сохранить сообщение"}, status=500)

    return JsonResponse({"ok": True})


# ---------------------------------------------------------------------------
# Lesson join (receives JWT from cabinet, renders lesson room)
# ---------------------------------------------------------------------------

def _lesson_jwt_iss_allowed(iss) -> bool:
    """ЛК может подставлять iss по-разному (домен, короткое имя) — после проверки подписи допускаем типовые варианты."""
    if iss is None:
        return True
    s = str(iss).strip().lower()
    if not s:
        return True
    if s in (
        "cabinet",
        "lk-cabinet",
        "lk_cabinet",
        "lk",
        "personal-cabinet",
        "personal_cabinet",
        "lesson",
    ):
        return True
    if "cabinet" in s or "lk" in s or "lesson" in s:
        return True
    return False


def _persist_lesson_room(room_id: str, payload: dict) -> None:
    rid = str(room_id or "").strip()[:200]
    if not rid:
        return
    try:
        current_payload = (
            LessonRoom.objects.filter(room_id=rid)
            .values_list("jwt_payload", flat=True)
            .first()
        )
        merged_payload = dict(payload or {})
        if isinstance(current_payload, dict):
            for key, value in current_payload.items():
                if str(key).startswith("_lesson_"):
                    merged_payload[key] = value
        LessonRoom.objects.update_or_create(
            room_id=rid,
            defaults={"jwt_payload": merged_payload},
        )
    except Exception:
        logger.exception("Не удалось сохранить LessonRoom для %s", rid)


def _is_lesson_session_closed(room_id: str) -> bool:
    rid = str(room_id or "").strip()[:200]
    if not rid:
        return False
    try:
        return LessonRoom.objects.filter(room_id=rid, lesson_ended_at__isnull=False).exists()
    except Exception:
        logger.exception("LessonRoom closed check failed for %s", rid)
        return False


def mark_lesson_session_closed(room_id: str) -> bool:
    """
    Помечает комнату завершённой. Возвращает True, если закрытие выполнено впервые
    (нужно уведомить остальных по WebSocket).
    """
    rid = str(room_id or "").strip()[:200]
    if not rid:
        return False
    try:
        now = timezone.now()
        room = LessonRoom.objects.filter(room_id=rid).first()
        if room and room.lesson_ended_at:
            return False
        if room:
            room.lesson_ended_at = now
            room.save(update_fields=["lesson_ended_at", "updated_at"])
            return True
        LessonRoom.objects.create(room_id=rid, jwt_payload={}, lesson_ended_at=now)
        return True
    except Exception:
        logger.exception("Не удалось пометить LessonRoom завершённой: %s", rid)
        return False


def _broadcast_lesson_session_closed(room_id: str) -> None:
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        rid = str(room_id or "").strip()
        if not rid:
            return
        async_to_sync(channel_layer.group_send)(
            f"lesson_{rid}",
            {
                "type": "lesson_message",
                "payload": {
                    "type": "lesson_ended",
                    "reason": "session_closed",
                    "by_role": "server",
                },
            },
        )
    except Exception:
        logger.exception("WS broadcast session_closed failed for %s", room_id)


def notify_lk_teacher_joined(token: str, extra: dict | None = None) -> bool:
    """
    Сообщает ЛК, что учитель реально вошёл в урок.
    ЛК рассылает ученику приглашение (WS / push на все устройства — реализуется в ЛК).
    В extra передаются room_id и target_id, чтобы ЛК не парсил JWT повторно и мог
    адресно отправить web-push на все токены ученика.
    """
    endpoint = (getattr(django_settings, "LK_LESSON_NOTIFY_URL", "") or "").strip()
    if not endpoint:
        lk_base = (getattr(django_settings, "LK_PUBLIC_URL", "") or "").rstrip("/")
        if lk_base:
            endpoint = f"{lk_base}/api/lesson/teacher-joined/"
    if not endpoint and bool(getattr(django_settings, "DEBUG", False)):
        endpoint = "http://127.0.0.1:8001/api/lesson/teacher-joined/"
    if not endpoint:
        return False
    payload: dict = {"token": token}
    if extra:
        for k, v in extra.items():
            if v is None or v == "":
                continue
            payload[k] = v
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    # ЛК может требовать заголовок; часто тот же секрет, что и JWT (LESSON_SECRET), если отдельный не задан.
    wh = (getattr(django_settings, "LESSON_WEBHOOK_SECRET", None) or "").strip()
    if not wh:
        wh = (getattr(django_settings, "LESSON_SECRET", None) or "").strip()
    if wh:
        headers["X-Lesson-Webhook-Secret"] = wh
    last_err: Exception | None = None
    for attempt in range(3):
        req = urlrequest.Request(
            endpoint,
            data=body,
            method="POST",
            headers=headers,
        )
        try:
            with urlrequest.urlopen(req, timeout=12):
                return True
        except urlerror.HTTPError as e:
            last_err = e
            detail = ""
            try:
                detail = (e.read() or b"").decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            logger.warning(
                "ЛК ответил HTTP %s на teacher-joined: %s",
                getattr(e, "code", "?"),
                detail or str(e),
            )
            if attempt < 2:
                time.sleep(0.35 * (2**attempt))
        except (urlerror.URLError, TimeoutError, OSError, ValueError) as e:
            last_err = e
            if attempt < 2:
                time.sleep(0.35 * (2**attempt))
    logger.warning(
        "Не удалось уведомить ЛК о входе учителя после 3 попыток: %s (%s)",
        endpoint,
        last_err,
    )
    return False


def verify_lesson_token(token: str) -> dict:
    secret = (getattr(django_settings, "LESSON_SECRET", None) or "").strip() or os.environ.get(
        "LESSON_SECRET", ""
    ).strip()
    if not secret:
        raise ValueError("LESSON_SECRET не задан на сервере")
    try:
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        iss = payload.get("iss")
        if not _lesson_jwt_iss_allowed(iss):
            raise ValueError("Неверный издатель токена")
        return payload
    except pyjwt.ExpiredSignatureError:
        raise ValueError("Токен истёк")
    except Exception as e:
        raise ValueError(f"Невалидный токен: {e}")


def normalize_lesson_jwt_payload(payload: dict) -> dict:
    """Кабинет может отдавать snake_case или camelCase — без этого lesson_join давал KeyError (ошибка join)."""
    room = (
        payload.get("room_id")
        or payload.get("roomId")
        or payload.get("room")
        or payload.get("lesson_room_id")
        or payload.get("lessonRoomId")
        or payload.get("session_id")
        or payload.get("sessionId")
        or payload.get("lesson_id")
        or payload.get("lessonId")
    )
    teacher = (
        payload.get("teacher")
        or payload.get("teacher_name")
        or payload.get("teacherName")
        or payload.get("tutor_name")
        or payload.get("tutorName")
        or ""
    )
    target = (
        payload.get("target_name")
        or payload.get("targetName")
        or payload.get("student_name")
        or payload.get("studentName")
        or payload.get("user_name")
        or payload.get("display_name")
        or payload.get("name")
        or ""
    )
    group_name = (
        payload.get("group_name")
        or payload.get("groupName")
        or payload.get("class_name")
        or payload.get("className")
        or payload.get("stream_name")
        or payload.get("streamName")
        or payload.get("cohort_name")
        or payload.get("cohortName")
        or payload.get("lesson_group_name")
        or payload.get("lessonGroupName")
        or ""
    )
    raw_role = (
        payload.get("type")
        or payload.get("role")
        or payload.get("lesson_type")
        or payload.get("lessonType")
        or ""
    )
    s = str(raw_role).strip().lower()
    if s in ("teacher", "tutor", "учитель"):
        lesson_type = "teacher"
    elif s in ("student", "pupil", "learner", "ученик"):
        lesson_type = "student"
    elif payload.get("is_teacher") is True or payload.get("isTeacher") is True:
        lesson_type = "teacher"
    elif payload.get("is_student") is True or payload.get("isStudent") is True:
        lesson_type = "student"
    elif not s:
        lesson_type = "student"
    elif "teacher" in s or "tutor" in s or "учит" in s:
        lesson_type = "teacher"
    elif "student" in s or "pupil" in s or "учен" in s:
        lesson_type = "student"
    else:
        lesson_type = "student"

    if room is None or str(room).strip() == "":
        raise ValueError("В токене нет идентификатора комнаты (room_id / roomId / session_id и т.п.)")

    teacher = str(teacher).strip() or "Учитель"
    target = str(target).strip()
    group_name = str(group_name).strip()
    if lesson_type == "student":
        participant_name = target or "Ученик"
    else:
        participant_name = teacher
    return {
        "room_id": str(room).strip(),
        "teacher_name": teacher,
        "target_name": target,
        "lesson_group_name": group_name,
        "lesson_type": lesson_type,
        "participant_name": participant_name,
    }


def _apply_lesson_video_collapsed_ui(normalized: dict) -> None:
    """Текст в свёрнутой колонке видео: группа, имя ученика или (для ученика) имя учителя — не номер варианта."""
    g = (normalized.get("lesson_group_name") or "").strip()
    t = (normalized.get("target_name") or "").strip()
    teacher = (normalized.get("teacher_name") or "").strip()
    role = normalized.get("lesson_type")
    if g:
        normalized["lesson_video_collapsed_label"] = g
        normalized["lesson_video_collapsed_hint"] = "Группа"
    elif t:
        normalized["lesson_video_collapsed_label"] = t
        normalized["lesson_video_collapsed_hint"] = "Ученик" if role == "teacher" else ""
    elif role == "student" and teacher:
        normalized["lesson_video_collapsed_label"] = teacher
        normalized["lesson_video_collapsed_hint"] = "Учитель"
    else:
        normalized["lesson_video_collapsed_label"] = ""
        normalized["lesson_video_collapsed_hint"] = ""


def _lesson_first_url(*candidates) -> str:
    for v in candidates:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _merge_jitsi_jwt_query(url: str, payload: dict, lesson_type: str) -> str:
    """
    Подставляет ?jwt= из payload ЛК (если токен есть и ещё не задан в URL).
    Учитель: берёт jitsi_jwt / jitsiJwt.
    Ученик:  берёт student_jitsi_jwt / studentJitsiJwt.
    На своём Jitsi / JaaS токен несёт роль (moderator=true/false); meet.jit.si JWT не принимает.
    """
    if lesson_type == "teacher":
        tok = _lesson_first_url(
            payload.get("jitsi_jwt"),
            payload.get("jitsiJwt"),
            payload.get("jitsi_token"),
            payload.get("jitsiToken"),
        )
    else:
        tok = _lesson_first_url(
            payload.get("student_jitsi_jwt"),
            payload.get("studentJitsiJwt"),
        )
    tok = (tok or "").strip()
    if not tok:
        return url
    u = urlparse(url)
    if not u.scheme or not u.hostname:
        return url
    if not _jitsi_embed_host_allowed(u.hostname):
        return url
    qs = parse_qs(u.query, keep_blank_values=True)
    if qs.get("jwt"):
        return url  # JWT уже встроен в URL из ЛК — не перезаписываем
    qs["jwt"] = [tok]
    new_query = urlencode(qs, doseq=True)
    return urlunparse(u._replace(query=new_query))


def _jitsi_embed_host_allowed(hostname: str) -> bool:
    """Хосты, для которых дополняем URL параметрами встраивания во фрейм."""
    h = (hostname or "").lower().rstrip(".")
    if not h:
        return False
    if h in django_settings.JITSI_EMBED_EXTRA_HOSTS:
        return True
    if h == "meet.jit.si":
        return True
    if h.endswith(".8x8.vc"):
        return True
    if h.endswith(".meet.jitsi.net"):
        return True
    return False


def enhance_jitsi_iframe_url(url: str, *, as_organizer: bool = False) -> str:
    """
    Добавляет во fragment параметры Jitsi Meet для работы во встроенном iframe:
    отключает deep linking (редирект в приложение) и экран prejoin в узкой вставке.
    Учитель: config.startAsModerator=true (модератор/организатор без отдельного входа в Jitsi),
    config.hideLoginButton — скрыть кнопку входа в аккаунт Jitsi.
    Ученик: config.startAsModerator=false — обычный участник.
    Перечисленные config.* из additions подставляются поверх одноимённых ключей во fragment.
    Не трогает URL с JSON во fragment и неизвестные хосты.
    """
    raw = (url or "").strip()
    if not raw:
        return raw
    u = urlparse(raw)
    if u.scheme not in ("https", "http") or not u.hostname:
        return raw
    if u.scheme == "http" and u.hostname not in ("localhost", "127.0.0.1"):
        return raw
    if not _jitsi_embed_host_allowed(u.hostname):
        return raw
    frag = u.fragment or ""
    if frag.strip().startswith("{"):
        return raw
    additions = [
        ("config.disableDeepLinking", "true"),
        # Отключаем lobby/waiting-room (meet.jit.si требует это явно)
        ("config.disableLobbyMode", "true"),
        ("config.lobby.enabled", "false"),
        ("config.autoKnockLobby", "false"),
        # Отключаем экран «перед звонком»
        ("config.prejoinConfig.enabled", "false"),
        ("config.prejoinPageEnabled", "false"),
        ("config.requireDisplayName", "false"),
        # Прячем кнопку входа и прочие отвлекающие элементы
        ("config.hideLoginButton", "true"),
        ("config.enableInsecureRoomNameWarning", "false"),
    ]
    additions.append(
        ("config.startAsModerator", "true" if as_organizer else "false"),
    )
    if as_organizer:
        # Дополнительные привилегии организатора
        additions += [
            ("config.enableUserRolesBasedOnToken", "false"),
            ("config.disableRemoteMute", "false"),
        ]
    override_keys = {k for k, _ in additions}
    pairs = []
    if frag:
        for part in frag.split("&"):
            part = part.strip()
            if not part or "=" not in part:
                continue
            k, v = part.split("=", 1)
            if k in override_keys:
                continue
            pairs.append((k, v))
    pairs.extend(additions)
    new_frag = "&".join(f"{k}={v}" for k, v in pairs)
    return urlunparse(u._replace(fragment=new_frag))


def lesson_video_context_from_jwt(payload: dict, lesson_type: str = "teacher") -> dict:
    """
    Ссылка на видеозвонок из ЛК (JWT). В iframe только https (или localhost) — иначе только внешняя ссылка.
    lesson_type: 'teacher' или 'student' — выбирает нужный URL из payload.
    """
    p = payload or {}

    # Чистый Jitsi-поток: берём role-specific URL, затем fallback на общий video_url.
    if lesson_type == "teacher":
        role_url = _lesson_first_url(
            p.get("teacher_video_url"),
            p.get("teacherVideoUrl"),
            p.get("video_url"),
            p.get("videoUrl"),
        )
    else:
        role_url = _lesson_first_url(
            p.get("student_video_url"),
            p.get("studentVideoUrl"),
            p.get("video_url"),
            p.get("videoUrl"),
        )

    direct = _lesson_first_url(
        role_url,
        p.get("jitsi_url"), p.get("jitsiUrl"),
    )
    role_jitsi_room = _lesson_first_url(
        p.get("teacher_jitsi_room") if lesson_type == "teacher" else p.get("student_jitsi_room"),
        p.get("teacherJitsiRoom") if lesson_type == "teacher" else p.get("studentJitsiRoom"),
        p.get("jitsi_room"),
        p.get("jitsiRoom"),
    )
    if not direct and role_jitsi_room:
        slug = role_jitsi_room.strip()
        if slug:
            direct = "https://meet.jit.si/" + quote(slug, safe="")
    if direct:
        direct = _merge_jitsi_jwt_query(direct, p, lesson_type)
    embed_url = ""
    link_url = ""
    if direct:
        low = direct.lower()
        as_organizer = lesson_type == "teacher"
        if low.startswith("https://") or low.startswith("http://localhost") or low.startswith("http://127.0.0.1"):
            enhanced = enhance_jitsi_iframe_url(direct, as_organizer=as_organizer)
            embed_url = enhanced
            # Та же ссылка, что в iframe — в т.ч. «открыть в отдельной вкладке» с ролью организатора у учителя
            link_url = enhanced
        else:
            link_url = direct

    return {
        "lesson_video_embed_url": embed_url,
        "lesson_video_link_url": link_url,
    }


@require_http_methods(["GET"])
def api_lesson_verify(request):
    """
    Проверка JWT из ЛК без HTML-страницы (для SPA на /lesson/join/).
    GET ?token=...
    """
    token = (request.GET.get("token") or "").strip()
    if not token:
        return JsonResponse({"ok": False, "error": "Параметр token не передан"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=401)
    if _is_lesson_session_closed(normalized["room_id"]):
        return JsonResponse(
            {
                "ok": False,
                "error": "Урок уже завершён. Запросите новую ссылку в личном кабинете.",
            },
            status=403,
        )
    _persist_lesson_room(normalized["room_id"], payload)
    video = lesson_video_context_from_jwt(payload, lesson_type=normalized.get("lesson_type", "teacher"))
    _apply_lesson_video_collapsed_ui(normalized)
    return JsonResponse(
        {
            "ok": True,
            "room_id": normalized["room_id"],
            "teacher": normalized["teacher_name"],
            "target_name": normalized["target_name"],
            "group_name": normalized.get("lesson_group_name") or "",
            "lesson_type": normalized["lesson_type"],
            "participant_name": normalized["participant_name"],
            "video_collapsed_label": normalized.get("lesson_video_collapsed_label") or "",
            "video_collapsed_hint": normalized.get("lesson_video_collapsed_hint") or "",
            "teacher_id": payload.get("teacher_id") or payload.get("teacherId"),
            "target_id": payload.get("target_id") or payload.get("targetId"),
            "video_embed_url": video["lesson_video_embed_url"],
            "video_link_url": video["lesson_video_link_url"],
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_teacher_joined(request):
    """
    Явный сигнал от страницы урока, что учитель открыл видеозвонок.
    После этого ЛК отправляет приглашение ученику.
    """
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)
    token = str((data or {}).get("token") or "").strip()
    role_override = str((data or {}).get("role") or "").strip().lower()
    if not token:
        return JsonResponse({"ok": False, "error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=401)
    if role_override in ("teacher", "tutor"):
        normalized["lesson_type"] = "teacher"
    elif role_override in ("student", "pupil"):
        normalized["lesson_type"] = "student"
    if normalized.get("lesson_type") != "teacher":
        return JsonResponse({"ok": False, "error": "teacher token required"}, status=400)
    lk_extra = {
        "room_id": normalized.get("room_id"),
        "target_id": payload.get("target_id") or payload.get("targetId"),
        "teacher_id": payload.get("teacher_id") or payload.get("teacherId"),
    }
    delivered = notify_lk_teacher_joined(token, extra=lk_extra)
    if not delivered:
        return JsonResponse({"ok": False, "error": "notify failed"}, status=502)
    return JsonResponse({"ok": True})


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_session_close(request):
    """
    Завершение сессии урока: после вызова повторный вход в ту же комнату по JWT запрещён.
    Вызывается со страницы урока (закрытие вкладки, выход из Jitsi, кнопка «Завершить урок»).
    """
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)
    token = str((data or {}).get("token") or "").strip()
    if not token:
        return JsonResponse({"ok": False, "error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=401)
    room_id = normalized["room_id"]
    first_close = mark_lesson_session_closed(room_id)
    if first_close:
        _broadcast_lesson_session_closed(room_id)
    return JsonResponse({"ok": True, "closed": True})


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_attachment_upload(request):
    """
    Загрузка файла-решения от ученика (изображение, файл, голосовое).
    POST multipart: поля lesson_token, task_number, file.
    Файл хранится в MEDIA_ROOT/lesson_attachments/<safe_room>/<file_token><ext>.
    """
    lesson_token = (
        request.POST.get("lesson_token")
        or request.META.get("HTTP_X_LESSON_TOKEN", "")
    ).strip()
    if not lesson_token:
        return JsonResponse({"ok": False, "error": "lesson_token required"}, status=400)
    try:
        payload = verify_lesson_token(lesson_token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=401)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"ok": False, "error": "field 'file' required"}, status=400)

    max_bytes = 20 * 1024 * 1024  # 20 MB
    if uploaded.size > max_bytes:
        return JsonResponse({"ok": False, "error": "Файл слишком большой (макс. 20 МБ)"}, status=400)

    room_id = normalized["room_id"]
    safe_room = re.sub(r"[^a-zA-Z0-9_-]", "_", room_id)[:64]
    file_token = secrets.token_urlsafe(32)
    orig_ext = os.path.splitext(uploaded.name)[1][:10].lower()
    filename = f"{file_token}{orig_ext}"

    attach_dir = os.path.join(django_settings.MEDIA_ROOT, "lesson_attachments", safe_room)
    os.makedirs(attach_dir, exist_ok=True)

    filepath = os.path.join(attach_dir, filename)
    with open(filepath, "wb") as f:
        for chunk in uploaded.chunks():
            f.write(chunk)

    meta = {
        "original_name": uploaded.name[:200],
        "content_type": uploaded.content_type or "application/octet-stream",
        "room_id": room_id,
        "safe_room": safe_room,
        "participant": normalized.get("participant_name", ""),
        "task_number": request.POST.get("task_number", ""),
        "created_at": time.time(),
    }
    with open(filepath + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    serve_url = f"/api/lesson/attachment/{safe_room}/{filename}"
    return JsonResponse({"ok": True, "url": serve_url, "filename": uploaded.name[:200]})


def api_lesson_attachment_serve(request, safe_room, filename):
    """
    Отдача файла вложения. Доступ только участникам урока (валидный lesson_token).
    lesson_token передаётся query-параметром ?t=...
    """
    # Проверяем токен
    lesson_token = (request.GET.get("t") or "").strip()
    if not lesson_token:
        return HttpResponse("Нет доступа: передайте ?t=<lesson_token>", status=403, content_type="text/plain")
    try:
        payload = verify_lesson_token(lesson_token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError:
        return HttpResponse("Токен недействителен", status=403, content_type="text/plain")

    # safe_room в URL должен совпадать с room_id из токена
    expected_safe_room = re.sub(r"[^a-zA-Z0-9_-]", "_", normalized["room_id"])[:64]
    if safe_room != expected_safe_room:
        return HttpResponse("Доступ запрещён", status=403, content_type="text/plain")

    # Защита от path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        return HttpResponse("Недопустимое имя файла", status=400, content_type="text/plain")

    attach_dir = os.path.join(django_settings.MEDIA_ROOT, "lesson_attachments", safe_room)
    filepath = os.path.join(attach_dir, filename)
    if not os.path.isfile(filepath):
        return HttpResponse("Файл не найден", status=404, content_type="text/plain")

    # Читаем метаданные для content-type
    content_type = "application/octet-stream"
    original_name = filename
    meta_path = filepath + ".meta.json"
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as mf:
                meta = json.load(mf)
            content_type = meta.get("content_type") or content_type
            original_name = meta.get("original_name") or filename
        except Exception:
            pass

    response = FileResponse(open(filepath, "rb"), content_type=content_type)
    # Для изображений — показываем inline; для остальных — скачиваем
    safe_name = re.sub(r'[^\w.\-]', '_', original_name)
    is_image = content_type.startswith("image/")
    is_audio = content_type.startswith("audio/")
    if is_image or is_audio:
        response["Content-Disposition"] = f'inline; filename="{safe_name}"'
    else:
        response["Content-Disposition"] = f'attachment; filename="{safe_name}"'
    return response


def lesson_join_redirect(request):
    """Без завершающего слэша запрос иначе попадает в react_app — сохраняем query (?token=…)."""
    q = request.META.get("QUERY_STRING", "").strip()
    target = "/lesson/join/" + ("?" + q if q else "")
    return HttpResponseRedirect(target)


def lesson_join(request):
    token = request.GET.get("token", "")
    if not token:
        return HttpResponseBadRequest("Токен не передан")
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
        # ?role= в URL переопределяет роль из JWT (учитель и ученик открывают разные ссылки)
        role_override = request.GET.get("role", "").strip().lower()
        if role_override in ("teacher", "tutor"):
            normalized["lesson_type"] = "teacher"
            normalized["participant_name"] = normalized["teacher_name"]
        elif role_override in ("student", "pupil"):
            normalized["lesson_type"] = "student"
            normalized["participant_name"] = normalized["target_name"] or "Ученик"
        normalized.update(lesson_video_context_from_jwt(payload, lesson_type=normalized.get("lesson_type", "teacher")))
        _apply_lesson_video_collapsed_ui(normalized)
    except ValueError as e:
        return HttpResponseBadRequest(str(e))

    if _is_lesson_session_closed(normalized["room_id"]):
        return HttpResponseBadRequest(
            "Урок уже завершён. Ссылка из личного кабинета больше не открывает эту комнату."
        )

    _persist_lesson_room(normalized["room_id"], payload)
    normalized["lesson_token"] = token
    normalized["lk_public_url"] = lk_user_nav_url()
    normalized["lk_nav_password_required"] = lk_nav_password_configured()
    normalized["lk_nav_unlocked"] = (not normalized["lk_nav_password_required"]) or lk_nav_cookie_is_valid(
        request
    )
    return render(request, "lesson_room.html", normalized)
