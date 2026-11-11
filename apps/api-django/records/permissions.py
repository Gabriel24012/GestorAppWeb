from rest_framework.permissions import BasePermission, IsAuthenticated


class IsVerifiedUser(IsAuthenticated):
    message = "email_not_verified"

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return bool(request.user.email_verified)


class HasRole(BasePermission):
    """Use as permission_classes with allowed_roles = (...,) on the view."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated or not request.user.is_active:
            return False
        allowed = getattr(view, "allowed_roles", ())
        return not allowed or request.user.role in allowed


class IsBootstrapRequest(BasePermission):
    def has_permission(self, request, view):
        from django.conf import settings
        from .models import User

        secret = getattr(settings, "BOOTSTRAP_ADMIN_TOKEN", "")
        return bool(secret and not User.objects.filter(role=User.Role.ADMIN).exists() and request.headers.get("X-Bootstrap-Token") == secret)
