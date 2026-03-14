from django.contrib import admin
from django.db.models import Q
from django.utils.html import strip_tags
from django_ckeditor_5.widgets import CKEditor5Widget

from .models import (
    Level,
    LinkedTaskGroup,
    Mark,
    MarkComment,
    Part,
    PreviewType,
    Subject,
    SupportInfo,
    Tag,
    Tags,
    TagsList,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    TaskPreview,
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
    list_per_page = 50
    show_full_result_count = False


@admin.register(TaskList)
class TaskListAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "task_number", "task_title", "subject", "level", "part")
    list_filter = ("subject", "level", "part")
    search_fields = ("task_title",)
    list_select_related = ("subject", "level", "part")
    list_per_page = 25
    show_full_result_count = False


@admin.register(Level)
class LevelAdmin(admin.ModelAdmin):
    list_display = ("level", "level_rus")
    list_filter = ("level",)


@admin.register(Task)
class TaskAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "task", "max_score", "answer_preview", "created_by", "added_at")
    list_filter = ("task__subject", "task__level", "task__part", "created_by", "added_at")
    search_fields = ("answer",)
    date_hierarchy = "added_at"
    list_select_related = ("task__subject", "task__level", "task__part")
    list_per_page = 25
    show_full_result_count = False
    raw_id_fields = ("task",)

    fieldsets = (
        (None, {"fields": ("task", "task_template", "answer", "max_score", "files", "author", "added_at", "created_by")}),
    )

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "answer":
            kwargs["widget"] = CKEditor5Widget(config_name="default")
        return super().formfield_for_dbfield(db_field, request, **kwargs)

    def answer_preview(self, obj):
        raw = obj.answer or ""
        plain = strip_tags(raw).strip() if raw else ""
        return (plain[:50] + "…") if len(plain) > 50 else plain

    answer_preview.short_description = "Ответ"


@admin.register(Variant)
class VariantAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "var_subject", "level", "created_by", "created_at")
    list_filter = ("var_subject", "level", "created_by")
    search_fields = ("created_by",)
    date_hierarchy = "created_at"
    list_select_related = ("var_subject", "level")
    list_per_page = 25
    show_full_result_count = False


@admin.register(VariantContent)
class VariantContentAdmin(admin.ModelAdmin):
    list_display = ("id", "variant", "task", "order")
    list_filter = ("variant__var_subject", "variant__level")
    search_fields = ("variant__var_subject__subject_short",)
    ordering = ("variant", "order")
    list_select_related = ("variant__var_subject", "variant__level", "task")
    list_per_page = 25
    show_full_result_count = False
    raw_id_fields = ("variant", "task")

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
    list_select_related = ("subject", "level")


class TaskGroupMemberInline(admin.TabularInline):
    model = TaskGroupMember
    extra = 0
    raw_id_fields = ("task",)


@admin.register(TaskGroup)
class TaskGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "level")
    list_filter = ("subject", "level")
    list_select_related = ("subject", "level")
    inlines = (TaskGroupMemberInline,)



@admin.register(Tags)
class TagsAdmin(admin.ModelAdmin):
    list_display = ("id", "tag")
    list_filter = ("tag",)
    search_fields = ("tag",)


@admin.register(TagsList)
class TagsListAdmin(admin.ModelAdmin):
    list_display = ("id", "tag")
    list_filter = ("tag",)
    search_fields = ("tag",)


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("id", "task", "taskTag")
    list_filter = ("taskTag",)
    list_select_related = ("task", "taskTag")
    raw_id_fields = ("task", "taskTag")


@admin.register(MarkComment)
class MarkCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "mark_level", "comment_preview")
    list_filter = ("mark_level",)
    search_fields = ("comment_text",)

    def comment_preview(self, obj):
        text = obj.comment_text or ""
        return (text[:80] + "…") if len(text) > 80 else text

    comment_preview.short_description = "Комментарий"


@admin.register(Mark)
class MarkAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "level", "score", "score_exam", "comment")
    list_filter = ("subject", "level")
    list_select_related = ("subject", "level", "comment")
    raw_id_fields = ("comment",)


@admin.register(SupportInfo)
class SupportInfoAdmin(admin.ModelAdmin):
    list_display = ("id", "info_preview", "subject", "level")
    list_filter = ("subject", "level")
    list_select_related = ("subject", "level")

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "info_text":
            kwargs["widget"] = CKEditor5Widget(config_name="default")
        return super().formfield_for_dbfield(db_field, request, **kwargs)

    def info_preview(self, obj):
        text = obj.info_text or ""
        plain = strip_tags(text).strip() if text else ""
        return (plain[:50] + "…") if len(plain) > 50 else plain

    info_preview.short_description = "Текст"


@admin.register(PreviewType)
class PreviewTypeAdmin(admin.ModelAdmin):
    list_display = ("id", "preview_type_text")
    search_fields = ("preview_type_text",)


@admin.register(TaskPreview)
class TaskPreviewAdmin(admin.ModelAdmin):
    list_display = ("id", "preview_preview", "subject", "level", "part", "preview_type")
    list_filter = ("subject", "level", "part", "preview_type")
    list_select_related = ("subject", "level", "part", "preview_type")

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "task_preview_text":
            kwargs["widget"] = CKEditor5Widget(config_name="default")
        return super().formfield_for_dbfield(db_field, request, **kwargs)

    def preview_preview(self, obj):
        text = obj.task_preview_text or ""
        plain = strip_tags(text).strip() if text else ""
        return (plain[:50] + "…") if len(plain) > 50 else plain

    preview_preview.short_description = "Текст перед задачами"
