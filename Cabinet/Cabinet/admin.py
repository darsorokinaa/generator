from django.contrib import admin
from .models import (
    FunnyWord,
    Tariff, Subject, Level,
    UserProfile, TeacherSubject,
    TeachersStudent, Group, TeachersGroup,
    Homework, StudentsHomework, StudentsAnswerImg,
)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display   = ('id', 'name', 'surname', 'username', 'role', 'email', 'tariff', 'last_activity')
    list_filter    = ('role', 'tariff')
    search_fields  = ('name', 'surname', 'username', 'email')
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
    list_display   = ('id', 'teacher', 'variant_id', 'created_at', 'deadline')
    list_filter    = ('teacher',)
    search_fields  = ('text', 'teacher__name', 'teacher__surname')
    ordering       = ('-created_at',)


@admin.register(StudentsHomework)
class StudentsHomeworkAdmin(admin.ModelAdmin):
    list_display   = ('id', 'student', 'homework')
    list_filter    = ('homework',)
    search_fields  = ('student__name', 'student__surname')
    list_display_links = ('id', 'student')


@admin.register(StudentsAnswerImg)
class StudentsAnswerImgAdmin(admin.ModelAdmin):
    list_display   = ('id', 'student', 'homework', 'img')
    list_filter    = ('homework',)
    search_fields  = ('student__name', 'student__surname')
    list_display_links = ('id', 'student')


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
