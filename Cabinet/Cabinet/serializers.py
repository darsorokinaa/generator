from django.db import DatabaseError
from rest_framework import serializers
from .models import (
    UserProfile, Subject, Level, TeachersStudent, Group,
    Homework, HomeworkAttachment, HomeworkAssignment, HomeworkAnswerFile,
    HomeworkTeacherFeedbackFile,
    Notification,
    TeacherVariant,
)


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = '__all__'


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ['id', 'subject_name']


class LevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = Level
        fields = ['id', 'level']


class TeachersStudentSerializer(serializers.ModelSerializer):
    student_name     = serializers.CharField(source='student.name',        read_only=True)
    student_surname  = serializers.CharField(source='student.surname',     read_only=True)
    student_email    = serializers.CharField(source='student.email',       read_only=True)
    student_phone    = serializers.CharField(source='student.phone',       read_only=True)
    student_username = serializers.CharField(source='student.username',    read_only=True)
    gender           = serializers.CharField(source='student.gender',      read_only=True)
    birth_date       = serializers.DateField(source='student.birth_date',  read_only=True)
    subject_name     = serializers.CharField(source='subject.subject_name',read_only=True)
    level_name       = serializers.CharField(source='level.level',         read_only=True)
    group_name       = serializers.CharField(source='group.group_name',    read_only=True, default=None)

    class Meta:
        model = TeachersStudent
        fields = [
            'id',
            'student', 'student_name', 'student_surname', 'student_username',
            'student_email', 'student_phone',
            'gender', 'birth_date',
            'subject', 'subject_name',
            'level', 'level_name',
            'grade', 'goal', 'status',
            'lesson_type', 'group', 'group_name',
        ]


class GroupSerializer(serializers.ModelSerializer):
    subject_name = serializers.CharField(source='subject.subject_name', read_only=True)
    level_name   = serializers.CharField(source='level.level',          read_only=True)

    class Meta:
        model = Group
        fields = ['id', 'group_name', 'subject', 'subject_name', 'level', 'level_name']


# ── Homework serializers ───────────────────────────────────────────────────────

class HomeworkAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = HomeworkAttachment
        fields = ['id', 'filename', 'file_type', 'url']

    def get_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url if obj.file else None


class HomeworkSerializer(serializers.ModelSerializer):
    attachments    = HomeworkAttachmentSerializer(many=True, read_only=True)
    teacher_name   = serializers.SerializerMethodField()
    assigned_count = serializers.SerializerMethodField()
    all_cancelled  = serializers.SerializerMethodField()

    class Meta:
        model = Homework
        fields = [
            'id', 'variant_id', 'title', 'text', 'subject',
            'deadline', 'created_at',
            'teacher_name', 'attachments', 'assigned_count', 'all_cancelled',
        ]

    def get_teacher_name(self, obj):
        return f'{obj.teacher.name} {obj.teacher.surname}'.strip()

    def get_assigned_count(self, obj):
        return obj.assignments.count()

    def get_all_cancelled(self, obj):
        total = obj.assignments.count()
        if total == 0:
            return False
        return obj.assignments.filter(status='cancelled').count() == total


class HomeworkAnswerFileSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = HomeworkAnswerFile
        fields = ['id', 'filename', 'file_type', 'task_number', 'annotations', 'uploaded_at', 'url']

    def get_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url if obj.file else None


class HomeworkTeacherFeedbackFileSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = HomeworkTeacherFeedbackFile
        fields = ['id', 'filename', 'file_type', 'source_answer_file', 'created_at', 'url']

    def get_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url if obj.file else None


class HomeworkAssignmentSerializer(serializers.ModelSerializer):
    """Brief — for lists."""
    student_name    = serializers.CharField(source='student.name',    read_only=True)
    student_surname = serializers.CharField(source='student.surname', read_only=True)
    homework_title  = serializers.SerializerMethodField()
    variant_id      = serializers.IntegerField(source='homework.variant_id', read_only=True)
    deadline        = serializers.DateTimeField(source='homework.deadline',  read_only=True)
    teacher_name    = serializers.SerializerMethodField()
    answer_count    = serializers.SerializerMethodField()
    task_teacher_comments = serializers.SerializerMethodField()
    whiteboard_strokes = serializers.SerializerMethodField()

    class Meta:
        model = HomeworkAssignment
        fields = [
            'id', 'status', 'teacher_comment',
            'submitted_at', 'reviewed_at', 'created_at',
            'student_name', 'student_surname',
            'homework_title', 'variant_id', 'deadline', 'teacher_name',
            'answer_count', 'result', 'score',
            'task_teacher_comments', 'whiteboard_strokes',
            'revision_task_ids',
        ]

    def get_task_teacher_comments(self, obj):
        try:
            v = obj.task_teacher_comments
            return dict(v) if isinstance(v, dict) else {}
        except Exception:
            return {}

    def get_whiteboard_strokes(self, obj):
        try:
            v = obj.whiteboard_strokes
            return list(v) if isinstance(v, list) else []
        except Exception:
            return []

    def get_homework_title(self, obj):
        return obj.homework.title or f'Вариант {obj.homework.variant_id}'

    def get_teacher_name(self, obj):
        t = obj.homework.teacher
        return f'{t.name} {t.surname}'.strip()

    def get_answer_count(self, obj):
        return obj.answer_files.count()


class HomeworkAssignmentDetailSerializer(HomeworkAssignmentSerializer):
    """Full detail — includes answer files and homework attachments."""
    answer_files        = HomeworkAnswerFileSerializer(many=True, read_only=True)
    teacher_feedback_files = serializers.SerializerMethodField()
    homework_attachments = HomeworkAttachmentSerializer(
        source='homework.attachments', many=True, read_only=True,
    )
    homework_text = serializers.CharField(source='homework.text', read_only=True)
    subject       = serializers.CharField(source='homework.subject', read_only=True)

    class Meta(HomeworkAssignmentSerializer.Meta):
        fields = HomeworkAssignmentSerializer.Meta.fields + [
            'answer_files', 'teacher_feedback_files', 'homework_attachments', 'homework_text', 'subject',
        ]

    def get_teacher_feedback_files(self, obj):
        """Без падения API, если миграция вложений учителя ещё не применена на сервере."""
        try:
            return HomeworkTeacherFeedbackFileSerializer(
                obj.teacher_feedback_files.all(), many=True, context=self.context,
            ).data
        except DatabaseError:
            return []


class NotificationSerializer(serializers.ModelSerializer):
    homework_id        = serializers.IntegerField(
        source='homework_assignment.homework_id', read_only=True,
    )
    assignment_id      = serializers.IntegerField(
        source='homework_assignment_id', read_only=True,
    )

    class Meta:
        model = Notification
        fields = [
            'id', 'text', 'notification_type', 'read',
            'created_at', 'homework_id', 'assignment_id',
        ]


class TeacherVariantSerializer(serializers.ModelSerializer):
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = TeacherVariant
        fields = [
            'id', 'variant_id', 'level', 'subject', 'title',
            'task_ids', 'created_at', 'teacher_name',
        ]

    def get_teacher_name(self, obj):
        return f'{obj.teacher.name} {obj.teacher.surname}'.strip()
