from django.contrib import admin
from django.utils.html import strip_tags
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

admin.site.register(Subject)
admin.site.register(TaskList)
admin.site.register(Level)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("id", "get_task_number", "get_subject", "get_level", "short_template", "created_by", "added_at")
    list_filter = ("task__subject", "task__level", "task__task_number")
    search_fields = ("task_template", "answer")
    ordering = ("task__task_number",)

    def get_task_number(self, obj):
        return obj.task.task_number if obj.task else "-"
    get_task_number.short_description = "№ задачи"
    get_task_number.admin_order_field = "task__task_number"

    def get_subject(self, obj):
        return obj.task.subject if obj.task else "-"
    get_subject.short_description = "Предмет"
    get_subject.admin_order_field = "task__subject"

    def get_level(self, obj):
        return obj.task.level if obj.task else "-"
    get_level.short_description = "Уровень"
    get_level.admin_order_field = "task__level"

    def short_template(self, obj):
        return strip_tags(obj.task_template)[:120] + "..." if len(strip_tags(obj.task_template)) > 120 else strip_tags(obj.task_template)
    short_template.short_description = "Условие"
    short_template.admin_order_field = "task_template"

    def save_model(self, request, obj, form, change):
        obj.created_by = request.user.username
        super().save_model(request, obj, form, change)


admin.site.register(Variant)
admin.site.register(VariantContent)
admin.site.register(Part)


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