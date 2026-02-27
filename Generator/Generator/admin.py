from django.contrib import admin
from django.db.models import Q

from .models import (
    Level,
    LinkedTaskGroup,
    Part,
    Subject,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    Variant,
    VariantContent,
)


class SearchByIdMixin:
    """Миксин: если поисковый запрос — число, ищем также по id."""

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if search_term.strip() and search_term.strip().isdigit():
            q_id = Q(id=int(search_term.strip()))
            queryset = self.model.objects.filter(q_id) | queryset
        return queryset, use_distinct


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ("subject_short", "subject_name")
    list_filter = ("subject_short",)
    search_fields = ("subject_short", "subject_name")


@admin.register(TaskList)
class TaskListAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "task_number", "task_title", "subject", "level", "part")
    list_filter = ("subject", "level", "part")
    search_fields = ("task_title",)


@admin.register(Level)
class LevelAdmin(admin.ModelAdmin):
    list_display = ("level", "level_rus")
    list_filter = ("level",)


@admin.register(Task)
class TaskAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "task", "answer_preview", "created_by", "added_at")
    list_filter = ("task__subject", "task__level", "task__part", "created_by", "added_at")
    search_fields = ("answer",)
    date_hierarchy = "added_at"

    def answer_preview(self, obj):
        return (obj.answer or "")[:50] + "…" if obj.answer and len(obj.answer) > 50 else (obj.answer or "")

    answer_preview.short_description = "Ответ"


@admin.register(Variant)
class VariantAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "var_subject", "level", "created_by", "created_at")
    list_filter = ("var_subject", "level", "created_by")
    search_fields = ("created_by",)
    date_hierarchy = "created_at"


@admin.register(VariantContent)
class VariantContentAdmin(admin.ModelAdmin):
    list_display = ("id", "variant", "task", "order")
    list_filter = ("variant__var_subject", "variant__level")
    search_fields = ("variant__var_subject__subject_short",)
    ordering = ("variant", "order")

    def get_search_results(self, request, queryset, search_term):
        if not search_term.strip():
            return super().get_search_results(request, queryset, search_term)
        if search_term.strip().isdigit():
            val = int(search_term.strip())
            q = Q(id=val) | Q(variant_id=val) | Q(task_id=val)
            return self.model.objects.filter(q).distinct(), True
        return super().get_search_results(request, queryset, search_term)


@admin.register(Part)
class PartAdmin(admin.ModelAdmin):
    list_display = ("id", "part_title")
    list_filter = ("part_title",)


@admin.register(LinkedTaskGroup)
class LinkedTaskGroupAdmin(admin.ModelAdmin):
    list_display = ("subject", "level", "task_numbers")
    list_filter = ("subject", "level")


class TaskGroupMemberInline(admin.TabularInline):
    model = TaskGroupMember
    extra = 0
    raw_id_fields = ("task",)


@admin.register(TaskGroup)
class TaskGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "level")
    list_filter = ("subject", "level")
    inlines = (TaskGroupMemberInline,)
