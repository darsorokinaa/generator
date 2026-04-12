"""Строгая валидация входных данных API (защита от переполнения и мусора в JSON)."""
from rest_framework import serializers


class StudentCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100, trim_whitespace=True)
    surname = serializers.CharField(
        max_length=100, allow_blank=True, required=False, default='', trim_whitespace=True
    )
    email = serializers.EmailField(max_length=254, allow_blank=True, required=False, default='')
    phone = serializers.CharField(max_length=64, allow_blank=True, required=False, default='')
    subject = serializers.IntegerField(min_value=1)
    level = serializers.IntegerField(min_value=1)
    grade = serializers.ChoiceField(choices=['7', '8', '9', '10', '11'])
    goal = serializers.CharField(max_length=200, allow_blank=True, required=False, default='')
    status = serializers.ChoiceField(choices=['1', '2', '3', '4'], default='1')
    lesson_type = serializers.ChoiceField(choices=['individual', 'group'], default='individual')
    group = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    gender = serializers.ChoiceField(
        choices=['female', 'male', 'other'], default='other', required=False
    )
    birth_date = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs.get('lesson_type') == 'group' and not attrs.get('group'):
            raise serializers.ValidationError(
                {'group': 'Для групповых занятий выберите группу'}
            )
        if attrs.get('lesson_type') == 'individual':
            attrs['group'] = None
        return attrs


class GroupCreateSerializer(serializers.Serializer):
    group_name = serializers.CharField(max_length=100, trim_whitespace=True)
    subject = serializers.IntegerField(min_value=1)
    level = serializers.IntegerField(min_value=1)


class LessonTokenSerializer(serializers.Serializer):
    room_id = serializers.CharField(max_length=200, trim_whitespace=True)
    type = serializers.ChoiceField(choices=['student', 'group'], default='student')
    target_id = serializers.IntegerField(min_value=1)
    target_name = serializers.CharField(max_length=200, trim_whitespace=True)
