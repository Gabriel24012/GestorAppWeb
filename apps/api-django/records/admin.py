from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import AuditEvent, CaptureSession, Goal, Invitation, Record, RecordVersion, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "full_name", "role", "parent_user", "is_active", "is_staff")
    list_filter = ("role", "is_active", "is_staff")
    search_fields = ("email", "full_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Perfil", {"fields": ("full_name", "role", "parent_user", "onboarding_completed_at")}),
        ("Permisos", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Fechas", {"fields": ("last_login", "created_at", "updated_at")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "full_name", "role", "parent_user", "password1", "password2")}),)
    filter_horizontal = ("groups", "user_permissions")
    readonly_fields = ("created_at", "updated_at")


for model in (CaptureSession, Record, RecordVersion, Goal, Invitation, AuditEvent):
    admin.site.register(model)
