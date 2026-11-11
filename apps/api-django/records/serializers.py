import re
from datetime import date

from django.contrib.auth.password_validation import validate_password
from django.db import models, transaction
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AuditEvent, CaptureSession, Goal, Invitation, Record, RecordVersion, User, UserPreference


class APIEnvelopeSerializer(serializers.Serializer):
    data = serializers.JSONField(required=False)
    meta = serializers.JSONField(required=False)


class UserPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserPreference
        fields = ("theme", "font_size", "language", "updated_at")
        read_only_fields = ("updated_at",)


class ProfileBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "full_name", "email", "role", "is_active", "email_verified", "profile_image")
        read_only_fields = fields


class ProfileSerializer(serializers.ModelSerializer):
    parent = ProfileBriefSerializer(source="parent_user", read_only=True)
    parent_user_id = serializers.UUIDField(read_only=True)
    children = ProfileBriefSerializer(many=True, read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "role", "parent", "parent_user_id", "children", "is_active", "email_verified", "email_verified_at", "profile_image", "onboarding_completed_at", "created_at")
        read_only_fields = ("id", "role", "email_verified", "email_verified_at", "profile_image", "onboarding_completed_at", "created_at")

    def validate(self, attrs):
        role = attrs.get("role", getattr(self.instance, "role", None))
        parent = attrs.get("parent_user", getattr(self.instance, "parent_user", None))
        actor = self.context.get("request").user if self.context.get("request") else None
        if role == User.Role.ADMIN and parent:
            raise serializers.ValidationError({"parent_user_id": "Un administrador no puede tener superior."})
        if role == User.Role.MANAGER and (not parent or parent.role != User.Role.ADMIN):
            raise serializers.ValidationError({"parent_user_id": "El gestor requiere un administrador."})
        if role == User.Role.CAPTURER and (not parent or parent.role != User.Role.MANAGER):
            raise serializers.ValidationError({"parent_user_id": "El capturador requiere un gestor."})
        if actor and actor.role == User.Role.MANAGER and role == User.Role.CAPTURER and parent != actor:
            raise serializers.ValidationError({"parent_user_id": "Solo puedes asignar capturadores a tu equipo."})
        return attrs


class CaptureSessionSerializer(serializers.ModelSerializer):
    capturer = ProfileBriefSerializer(read_only=True)
    manager = ProfileBriefSerializer(read_only=True)
    capturer_id = serializers.PrimaryKeyRelatedField(source="capturer", queryset=User.objects.filter(role=User.Role.CAPTURER), required=False)
    manager_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = CaptureSession
        fields = ("id", "capturer", "capturer_id", "manager", "manager_id", "leadership_name", "section_code", "network_responsible", "status", "created_at", "updated_at")
        read_only_fields = ("id", "manager", "created_at", "updated_at")


class RecordVersionSerializer(serializers.ModelSerializer):
    changed_by = ProfileBriefSerializer(read_only=True)

    class Meta:
        model = RecordVersion
        fields = ("id", "version_number", "changed_by", "changed_at", "snapshot")
        read_only_fields = fields


class RecordSerializer(serializers.ModelSerializer):
    capture_session = CaptureSessionSerializer(read_only=True)
    capturer = ProfileBriefSerializer(read_only=True)
    manager = ProfileBriefSerializer(read_only=True)
    leadership_name = serializers.CharField(required=False, allow_blank=True)
    versions = RecordVersionSerializer(many=True, read_only=True)
    capture_session_id = serializers.PrimaryKeyRelatedField(source="capture_session", queryset=CaptureSession.objects.all(), required=False, allow_null=True)
    capturer_id = serializers.UUIDField(read_only=True)
    manager_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Record
        fields = ("id", "capture_session", "capture_session_id", "capturer", "capturer_id", "manager", "manager_id", "leadership_name", "section_code", "network_responsible", "first_name", "paternal_surname", "maternal_surname", "address", "exterior_number", "neighborhood", "district", "postal_code", "birth_date", "phone", "electoral_key", "observations", "status", "created_at", "updated_at", "versions")
        read_only_fields = ("id", "capturer", "manager", "created_at", "updated_at", "versions")

    def validate_birth_date(self, value):
        if value > date.today() or value < date.today().replace(year=date.today().year - 120):
            raise serializers.ValidationError("La fecha de nacimiento debe estar entre hoy y hace 120 años.")
        return value

    def validate_phone(self, value):
        if not re.fullmatch(r"\d{10}", value):
            raise serializers.ValidationError("El teléfono debe tener 10 dígitos.")
        return value

    def validate_electoral_key(self, value):
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{18}", value):
            raise serializers.ValidationError("La clave electoral debe tener 18 caracteres alfanuméricos.")
        return value

    def validate_postal_code(self, value):
        if not value:
            return None
        if value and not re.fullmatch(r"\d{5}", value):
            raise serializers.ValidationError("El C.P. debe tener 5 dígitos.")
        return value

    def validate(self, attrs):
        request = self.context.get("request")
        if not request:
            return attrs
        actor = request.user
        session = attrs.get("capture_session", getattr(self.instance, "capture_session", None))
        if self.instance and actor.role != User.Role.ADMIN:
            for field in ("capturer", "manager", "capture_session"):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError({field: "No se puede cambiar la pertenencia del registro."})
        if actor.role == User.Role.CAPTURER and session and session.capturer_id != actor.id:
            raise serializers.ValidationError({"capture_session_id": "La sesión no pertenece al usuario."})
        if self.instance and actor.role != User.Role.ADMIN and "status" in attrs and attrs["status"] != self.instance.status:
            raise serializers.ValidationError({"status": "Solo un administrador puede anular o reactivar registros."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        actor = self.context["request"].user
        if actor.role != User.Role.CAPTURER:
            raise serializers.ValidationError("Solo un capturador puede crear registros.")
        session = validated_data.get("capture_session")
        manager = actor.parent_user
        if not manager or manager.role != User.Role.MANAGER or not manager.is_active:
            raise serializers.ValidationError("El capturador no tiene un gestor activo.")
        validated_data.update(capturer=actor, manager=manager, leadership_name=manager.full_name, section_code=(session.section_code if session else validated_data.get("section_code", "GENERAL")).upper())
        if session and session.status != CaptureSession.Status.OPEN:
            raise serializers.ValidationError({"capture_session_id": "La sesión está cerrada."})
        return Record.objects.create(**validated_data)

    @transaction.atomic
    def update(self, instance, validated_data):
        if any(getattr(instance, key) != value for key, value in validated_data.items() if key in {"first_name", "paternal_surname", "maternal_surname", "address", "exterior_number", "neighborhood", "district", "postal_code", "birth_date", "phone", "electoral_key", "observations", "status"}):
            from .models import RecordVersion
            RecordVersion.objects.create(record=instance, version_number=(instance.versions.aggregate(models.Max("version_number"))["version_number__max"] or 0) + 1, changed_by=self.context["request"].user, snapshot={field: getattr(instance, field).isoformat() if hasattr(getattr(instance, field), "isoformat") else getattr(instance, field) for field in ("leadership_name", "section_code", "first_name", "paternal_surname", "maternal_surname", "address", "exterior_number", "neighborhood", "district", "postal_code", "birth_date", "phone", "electoral_key", "observations", "status")})
        return super().update(instance, validated_data)


class GoalSerializer(serializers.ModelSerializer):
    capturer = ProfileBriefSerializer(read_only=True)
    manager = ProfileBriefSerializer(read_only=True)
    capturer_id = serializers.PrimaryKeyRelatedField(source="capturer", queryset=User.objects.filter(role=User.Role.CAPTURER), required=False, allow_null=True)
    manager_id = serializers.UUIDField(read_only=True)
    progress = serializers.SerializerMethodField()
    target_count = serializers.IntegerField(min_value=1)

    class Meta:
        model = Goal
        fields = ("id", "manager", "manager_id", "capturer", "capturer_id", "period_type", "target_count", "starts_on", "ends_on", "status", "archived_at", "created_by_role", "created_at", "progress")
        read_only_fields = ("id", "manager", "status", "archived_at", "created_by_role", "created_at", "progress")

    def get_progress(self, obj):
        from .utils import progress_for_goal
        return progress_for_goal(obj)

    def validate(self, attrs):
        capturer = attrs.get("capturer", getattr(self.instance, "capturer", None))
        manager = getattr(self.instance, "manager", None)
        request = self.context.get("request")
        if not manager and request and request.user.role == User.Role.MANAGER:
            manager = request.user
        if capturer and manager and capturer.parent_user_id != manager.id:
            raise serializers.ValidationError({"capturer_id": "El capturador debe pertenecer al gestor de la meta."})
        starts = attrs.get("starts_on", getattr(self.instance, "starts_on", None))
        ends = attrs.get("ends_on", getattr(self.instance, "ends_on", None))
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_on": "La fecha final no puede ser anterior al inicio."})
        return attrs


class InvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invitation
        fields = ("id", "kind", "placeholder_name", "recipient_email", "status", "created_at", "used_at")
        read_only_fields = ("id", "status", "created_at", "used_at")


class LoginTokenSerializer(TokenObtainPairSerializer):
    username_field = User.USERNAME_FIELD

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["full_name"] = user.full_name
        return token

    def validate(self, attrs):
        if "username" in attrs and "email" not in attrs:
            attrs["email"] = attrs.pop("username")
        data = super().validate(attrs)
        if not self.user.email_verified:
            raise AuthenticationFailed("email_not_verified", code="email_not_verified")
        data["user"] = ProfileSerializer(self.user).data
        return data


class VerifiedTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        token = RefreshToken(attrs["refresh"])
        user = User.objects.filter(id=token.get("user_id")).first()
        if not user or not user.email_verified:
            raise AuthenticationFailed("email_not_verified", code="email_not_verified")
        return super().validate(attrs)


class InviteCompletionSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=120)
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=8, max_length=128)

    def validate_email(self, value):
        return value.strip().lower()

    def validate_password(self, value):
        validate_password(value)
        return value


class AccountInviteSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=120)
    email = serializers.EmailField(required=False, allow_blank=True)
    manager_id = serializers.UUIDField(required=False)

    def validate_email(self, value):
        return value.strip().lower()


class GoalProgressSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    target = serializers.IntegerField()
    percentage = serializers.IntegerField()
    status = serializers.CharField()


class AuditEventSerializer(serializers.ModelSerializer):
    actor = ProfileBriefSerializer(read_only=True)

    class Meta:
        model = AuditEvent
        fields = ("id", "actor", "entity", "entity_id", "action", "metadata", "created_at")
        read_only_fields = fields
