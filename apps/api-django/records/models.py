import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models import Q
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("El correo es obligatorio")
        user = self.model(email=self.normalize_email(email).lower(), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("role", User.Role.ADMIN)
        extra_fields.setdefault("full_name", "Administrador")
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        return self._create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        ADMIN = "admin", "Administrador"
        MANAGER = "gestor", "Gestor"
        CAPTURER = "capturador", "Capturador"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=120)
    role = models.CharField(max_length=16, choices=Role.choices)
    parent_user = models.ForeignKey("self", null=True, blank=True, related_name="children", on_delete=models.PROTECT)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)
    profile_image = models.URLField(blank=True, max_length=1000)
    email_verified = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]
    objects = UserManager()

    class Meta:
        ordering = ["full_name", "email"]

    def __str__(self):
        return self.email


class CaptureSession(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Abierta"
        CLOSED = "closed", "Cerrada"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    capturer = models.ForeignKey(User, related_name="capture_sessions", on_delete=models.PROTECT)
    manager = models.ForeignKey(User, related_name="managed_sessions", on_delete=models.PROTECT)
    leadership_name = models.CharField(max_length=120)
    section_code = models.CharField(max_length=40, default="GENERAL")
    network_responsible = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class Record(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Activo"
        VOIDED = "voided", "Anulado"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    capture_session = models.ForeignKey(CaptureSession, null=True, blank=True, related_name="records", on_delete=models.SET_NULL)
    capturer = models.ForeignKey(User, related_name="records_captured", on_delete=models.PROTECT)
    manager = models.ForeignKey(User, related_name="records_managed", on_delete=models.PROTECT)
    leadership_name = models.CharField(max_length=120)
    section_code = models.CharField(max_length=40, default="GENERAL")
    network_responsible = models.JSONField(null=True, blank=True)
    first_name = models.CharField(max_length=80)
    paternal_surname = models.CharField(max_length=80)
    maternal_surname = models.CharField(max_length=80, blank=True, null=True)
    address = models.CharField(max_length=250)
    exterior_number = models.CharField(max_length=20, blank=True, null=True)
    neighborhood = models.CharField(max_length=120, blank=True, null=True)
    district = models.CharField(max_length=120, blank=True, null=True)
    postal_code = models.CharField(max_length=5, blank=True, null=True)
    birth_date = models.DateField()
    phone = models.CharField(max_length=10)
    electoral_key = models.CharField(max_length=18, unique=True)
    observations = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["capturer", "-created_at"]), models.Index(fields=["manager", "-created_at"]), models.Index(fields=["leadership_name", "section_code"])]
        constraints = [
            models.CheckConstraint(condition=Q(phone__regex=r"^[0-9]{10}$"), name="record_phone_10_digits"),
            models.CheckConstraint(condition=Q(electoral_key__regex=r"^[A-Z0-9]{18}$"), name="record_electoral_key_format"),
            models.CheckConstraint(condition=Q(postal_code__isnull=True) | Q(postal_code__regex=r"^[0-9]{5}$"), name="record_postal_code_format"),
        ]


class RecordVersion(models.Model):
    record = models.ForeignKey(Record, related_name="versions", on_delete=models.PROTECT)
    version_number = models.PositiveIntegerField()
    changed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    changed_at = models.DateTimeField(default=timezone.now)
    snapshot = models.JSONField()

    class Meta:
        ordering = ["-version_number"]
        constraints = [models.UniqueConstraint(fields=["record", "version_number"], name="unique_record_version")]


class Goal(models.Model):
    class Period(models.TextChoices):
        DAILY = "daily", "Diaria"
        WEEKLY = "weekly", "Semanal"
        MONTHLY = "monthly", "Mensual"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    manager = models.ForeignKey(User, related_name="goals", on_delete=models.CASCADE)
    capturer = models.ForeignKey(User, null=True, blank=True, related_name="capturer_goals", on_delete=models.CASCADE)
    period_type = models.CharField(max_length=12, choices=Period.choices)
    target_count = models.PositiveIntegerField()
    starts_on = models.DateField()
    ends_on = models.DateField()
    status = models.CharField(max_length=12, default="active")
    archived_at = models.DateTimeField(null=True, blank=True)
    created_by_role = models.CharField(max_length=16, choices=User.Role.choices, default=User.Role.MANAGER)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(ends_on__gte=models.F("starts_on")), name="goal_end_after_start"),
            models.UniqueConstraint(fields=["capturer", "period_type"], condition=Q(capturer__isnull=False, status="active", archived_at__isnull=True), name="one_active_goal_per_capturer_period"),
            models.UniqueConstraint(fields=["manager", "period_type"], condition=Q(capturer__isnull=True, status="active", archived_at__isnull=True), name="one_active_team_goal_per_period"),
        ]
        indexes = [models.Index(fields=["manager", "capturer", "period_type", "-created_at"])]


class Invitation(models.Model):
    class Kind(models.TextChoices):
        MANAGER = "gestor", "Gestor"
        CAPTURER = "capturador", "Capturador"

    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        USED = "used", "Usada"
        REVOKED = "revoked", "Revocada"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    admin = models.ForeignKey(User, null=True, blank=True, related_name="manager_invitations", on_delete=models.CASCADE)
    manager = models.ForeignKey(User, null=True, blank=True, related_name="capturer_invitations", on_delete=models.CASCADE)
    placeholder_name = models.CharField(max_length=120)
    recipient_email = models.EmailField(blank=True, null=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    used_by = models.ForeignKey(User, null=True, blank=True, related_name="accepted_invitations", on_delete=models.SET_NULL)
    created_at = models.DateTimeField(default=timezone.now)
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["kind", "status", "created_at"])]


class AuditEvent(models.Model):
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    entity = models.CharField(max_length=80)
    entity_id = models.UUIDField(null=True, blank=True)
    action = models.CharField(max_length=120)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class EmailVerification(models.Model):
    user = models.ForeignKey(User, related_name="email_verifications", on_delete=models.CASCADE)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(default=timezone.now)


class UserPreference(models.Model):
    class Theme(models.TextChoices):
        LIGHT = "light", "Claro"
        DARK = "dark", "Oscuro"

    class FontSize(models.TextChoices):
        SMALL = "small", "Pequeño"
        NORMAL = "normal", "Normal"
        LARGE = "large", "Grande"

    class Language(models.TextChoices):
        ES = "es", "Español"
        EN = "en", "English"

    user = models.OneToOneField(User, related_name="preferences", on_delete=models.CASCADE)
    theme = models.CharField(max_length=8, choices=Theme.choices, default=Theme.LIGHT)
    font_size = models.CharField(max_length=8, choices=FontSize.choices, default=FontSize.NORMAL)
    language = models.CharField(max_length=2, choices=Language.choices, default=Language.ES)
    updated_at = models.DateTimeField(auto_now=True)

