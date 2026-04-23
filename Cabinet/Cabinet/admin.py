from django.contrib import admin
from .models import (
    FunnyWord,
    Tariff, Subject, Level,
    UserProfile, TeacherSubject,
    TeachersStudent, Group, TeachersGroup,
    Homework, HomeworkAttachment, HomeworkAssignment, HomeworkAnswerFile, HomeworkTeacherFeedbackFile,
    TeacherVariant,
    Notification, UserPlatformConsent, LessonInvite, Lesson,
)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display   = ('id', 'name', 'surname', 'username', 'role', 'email', 'vk_user_id', 'tariff', 'last_activity')
    list_filter    = ('role', 'tariff')
    search_fields  = ('name', 'surname', 'username', 'email', 'vk_user_id')
    ordering       = ('surname', 'name')
    list_display_links = ('id', 'name')


@admin.register(TeachersStudent)
class TeachersStudentAdmin(admin.ModelAdmin):
    list_display   = ('id', 'student', 'teacher', 'subject', 'level', 'grade', 'status')
    list_filter    = ('status', 'subject', 'level', 'grade')
    search_fields  = ('student__name', 'student__surname', 'teacher__name', 'teacher__surname')
    autocomplete_fields = ('teacher', 'student')
    list_display_links = ('id', 'student')


@admin.register(Homework)
class HomeworkAdmin(admin.ModelAdmin):
    list_display = ('id', 'teacher', 'variant_id', 'subject', 'deadline', 'created_at')
    list_display_links = ('id', 'variant_id')
    list_filter = ('subject', 'created_at')
    search_fields = ('title', 'text', 'teacher__name', 'teacher__surname', 'teacher__email')
    ordering = ('-created_at',)


@admin.register(HomeworkAttachment)
class HomeworkAttachmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'homework', 'filename', 'file_type')
    list_display_links = ('id', 'filename')
    list_filter = ('file_type',)
    search_fields = ('filename', 'homework__title', 'homework__teacher__name', 'homework__teacher__surname')


@admin.register(HomeworkAssignment)
class HomeworkAssignmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'homework', 'student', 'status', 'score', 'created_at')
    list_display_links = ('id', 'homework', 'student')
    list_filter = ('status', 'created_at')
    search_fields = ('student__name', 'student__surname', 'homework__title', 'homework__variant_id')
    ordering = ('-created_at',)


@admin.register(HomeworkAnswerFile)
class HomeworkAnswerFileAdmin(admin.ModelAdmin):
    list_display = ('id', 'assignment', 'filename', 'file_type', 'task_number', 'uploaded_at')
    list_display_links = ('id', 'filename')
    list_filter = ('file_type', 'uploaded_at')
    search_fields = ('filename', 'assignment__student__name', 'assignment__student__surname')
    ordering = ('-uploaded_at',)


@admin.register(HomeworkTeacherFeedbackFile)
class HomeworkTeacherFeedbackFileAdmin(admin.ModelAdmin):
    list_display = ('id', 'assignment', 'filename', 'file_type', 'source_answer_file', 'created_at')
    list_display_links = ('id', 'filename')
    list_filter = ('file_type', 'created_at')
    search_fields = ('filename', 'assignment__student__name', 'assignment__student__surname')
    ordering = ('-created_at',)


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display   = ('id', 'group_name', 'teacher', 'subject', 'level')
    list_filter    = ('subject', 'level')
    search_fields  = ('group_name', 'teacher__name', 'teacher__surname')
    list_display_links = ('id', 'group_name')


@admin.register(TeachersGroup)
class TeachersGroupAdmin(admin.ModelAdmin):
    list_display   = ('id', 'group', 'student')
    list_filter    = ('group',)
    search_fields  = ('student__name', 'student__surname')
    list_display_links = ('id', 'group')


@admin.register(TeacherSubject)
class TeacherSubjectAdmin(admin.ModelAdmin):
    list_display   = ('id', 'teacher', 'subject')
    list_filter    = ('subject',)
    list_display_links = ('id', 'teacher')


@admin.register(Tariff)
class TariffAdmin(admin.ModelAdmin):
    list_display = ('id', 'tariff_name')
    list_display_links = ('id', 'tariff_name')


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display  = ('id', 'subject_name')
    search_fields = ('subject_name',)
    list_display_links = ('id', 'subject_name')


@admin.register(Level)
class LevelAdmin(admin.ModelAdmin):
    list_display = ('id', 'level')
    list_display_links = ('id', 'level')


@admin.register(FunnyWord)
class FunnyWordAdmin(admin.ModelAdmin):
    list_display  = ('id', 'word')
    search_fields = ('word',)
    list_display_links = ('id', 'word')


@admin.register(TeacherVariant)
class TeacherVariantAdmin(admin.ModelAdmin):
    list_display = ('id', 'variant_id', 'level', 'subject', 'teacher', 'created_at')
    list_display_links = ('id', 'variant_id', 'teacher')
    search_fields = (
        'variant_id',
        'teacher__username',   # или другое поле
        'teacher__email',
    )
    list_filter = ('level', 'subject', 'created_at')
    ordering = ('-created_at',)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'notification_type', 'read', 'created_at')
    list_display_links = ('id', 'user')
    list_filter = ('notification_type', 'read', 'created_at')
    search_fields = ('text', 'user__name', 'user__surname', 'user__email')
    ordering = ('-created_at',)


@admin.register(UserPlatformConsent)
class UserPlatformConsentAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'consent_code', 'accepted', 'version', 'updated_at')
    list_display_links = ('id', 'user')
    list_filter = ('consent_code', 'accepted', 'updated_at')
    search_fields = ('user__name', 'user__surname', 'user__email', 'consent_code', 'version')
    ordering = ('-updated_at',)


@admin.register(LessonInvite)
class LessonInviteAdmin(admin.ModelAdmin):
    list_display = ('id', 'teacher', 'target_type', 'target_name', 'status', 'expires_at', 'created_at')
    list_display_links = ('id', 'target_name')
    list_filter = ('target_type', 'status', 'created_at')
    search_fields = ('target_name', 'teacher__name', 'teacher__surname', 'teacher__email')
    ordering = ('-created_at',)


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = ('id', 'variant_id', 'teacher', 'created_at')
    list_display_links = ('id', 'variant_id', 'teacher')
    search_fields = (
        'variant_id',
        'teacher__username',   # или другое поле
        'teacher__email',
    )
    list_filter = ('id', 'variant_id', 'created_at')
    ordering = ('-created_at',)