from rest_framework import serializers
from .models import UserProfile, Subject, Level, TeachersStudent, Group


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
    student_name    = serializers.CharField(source='student.name',    read_only=True)
    student_surname = serializers.CharField(source='student.surname', read_only=True)
    student_email   = serializers.CharField(source='student.email',   read_only=True)
    student_phone   = serializers.CharField(source='student.phone',   read_only=True)
    student_username = serializers.CharField(source='student.username', read_only=True)
    gender          = serializers.CharField(source='student.gender', read_only=True)
    birth_date      = serializers.DateField(source='student.birth_date', read_only=True)
    subject_name    = serializers.CharField(source='subject.subject_name', read_only=True)
    level_name      = serializers.CharField(source='level.level',     read_only=True)
    group_name      = serializers.CharField(source='group.group_name', read_only=True, default=None)

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
