from django.contrib import admin
from .models import *

admin.site.register(Subject)
admin.site.register(TaskList)
admin.site.register(Level)
admin.site.register(Task)
admin.site.register(Variant)
admin.site.register(VariantContent)

