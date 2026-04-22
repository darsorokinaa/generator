"""Строгая валидация входных данных API (защита от переполнения и мусора в JSON)."""
from rest_framework import serializers


class OptionalDateField(serializers.DateField):
    """Пустая / пробельная строка из форм (input type=date) → null при allow_null=True."""

    def to_internal_value(self, data):
        if data is None:
            if self.allow_null:
                return None
            self.fail('invalid', format='YYYY-MM-DD')
        if isinstance(data, str):
            s = data.strip()
            if not s:
                if self.allow_null:
                    return None
                self.fail('invalid', format='YYYY-MM-DD')
            data = s
        return super().to_internal_value(data)


class OptionalPositiveIntField(serializers.IntegerField):
    """Пустая строка или null → null (для group_id из форм)."""

    def to_internal_value(self, data):
        if data is None or data == '':
            return None
        if isinstance(data, str) and not data.strip():
            return None
        return super().to_internal_value(data)

    def run_validators(self, value):
        if value is None:
            return
        super().run_validators(value)


class StudentCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100, trim_whitespace=True)
    surname = serializers.CharField(
        max_length=100, allow_blank=True, required=False, allow_null=True,
        default='', trim_whitespace=True,
    )
    email = serializers.EmailField(
        max_length=254, allow_blank=True, required=False, allow_null=True, default='',
    )
    phone = serializers.CharField(
        max_length=64, allow_blank=True, required=False, allow_null=True, default='',
    )
    subject = serializers.IntegerField(min_value=1)
    level = serializers.IntegerField(min_value=1)
    grade = serializers.ChoiceField(choices=['7', '8', '9', '10', '11'])
    goal = serializers.CharField(
        max_length=200, allow_blank=True, required=False, allow_null=True,
        default='', trim_whitespace=True,
    )
    status = serializers.ChoiceField(choices=['1', '2', '3', '4'], default='1', allow_null=True)
    lesson_type = serializers.ChoiceField(
        choices=['individual', 'group'], default='individual', allow_null=True,
    )
    group = OptionalPositiveIntField(required=False, allow_null=True, min_value=1)
    gender = serializers.ChoiceField(
        choices=['female', 'male', 'other'], default='other', required=False, allow_null=True,
    )
    birth_date = OptionalDateField(required=False, allow_null=True)

    def validate(self, attrs):
        # JSON / формы: null для необязательных строковых полей
        for k in ('surname', 'email', 'phone', 'goal'):
            if attrs.get(k) is None:
                attrs[k] = ''
        if attrs.get('status') is None:
            attrs['status'] = '1'
        if attrs.get('lesson_type') is None:
            attrs['lesson_type'] = 'individual'
        if attrs.get('gender') is None:
            attrs['gender'] = 'other'

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
    variant_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
