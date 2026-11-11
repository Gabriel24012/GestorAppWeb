import csv
import io
import secrets
import hashlib
import json
import urllib.request
import urllib.error
import logging
from html import escape
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.db.models import Count, Max, Q
from django.http import HttpResponse
from django.utils import timezone
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.utils.dateparse import parse_date
from openpyxl import Workbook
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError, AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from drf_spectacular.utils import extend_schema_view, extend_schema

from .models import AuditEvent, CaptureSession, EmailVerification, Goal, Invitation, Record, RecordVersion, User, UserPreference
from .pagination import StandardPagination
from .permissions import HasRole, IsBootstrapRequest
from .serializers import APIEnvelopeSerializer, AccountInviteSerializer, CaptureSessionSerializer, GoalSerializer, InvitationSerializer, InviteCompletionSerializer, LoginTokenSerializer, ProfileBriefSerializer, ProfileSerializer, RecordSerializer, UserPreferenceSerializer, VerifiedTokenRefreshSerializer
from .utils import apply_record_filters, audit, dashboard_counts, invite_token, period_bounds, progress_for_goal, token_hash, visible_records

logger = logging.getLogger(__name__)


class AuthThrottle(AnonRateThrottle):
    scope = "auth"


class DocumentedAPIView(APIView):
    serializer_class = APIEnvelopeSerializer


class LoginView(TokenObtainPairView):
    serializer_class = LoginTokenSerializer
    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    def post(self, request, *args, **kwargs):
        try:
            return super().post(request, *args, **kwargs)
        except AuthenticationFailed as exc:
            if str(exc.detail) == "email_not_verified":
                email = str(request.data.get("email", "")).strip().lower()
                user = User.objects.filter(email=email).first()
                if user:
                    send_verification_email(user)
            raise


class RefreshView(TokenRefreshView):
    serializer_class = VerifiedTokenRefreshSerializer
    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]


class BootstrapAdminView(DocumentedAPIView):
    permission_classes = [IsBootstrapRequest]
    throttle_classes = [AuthThrottle]

    @transaction.atomic
    def post(self, request):
        email = str(request.data.get("email", "admin@gmail.com")).strip().lower()
        name = str(request.data.get("full_name", "Admin")).strip()
        password = str(request.data.get("password", ""))
        if not email or not name:
            raise ValidationError({"detail": "Correo y nombre completo son obligatorios."})
        validate_password(password)
        if User.objects.filter(role=User.Role.ADMIN).exists():
            raise PermissionDenied("El administrador inicial ya fue creado.")
        user = User.objects.create_user(email=email, password=password, full_name=name, role=User.Role.ADMIN, is_active=True, onboarding_completed_at=timezone.now())
        sent = send_verification_email(user)
        return Response({"data": ProfileSerializer(user).data, "email_sent": sent, "detail": "Confirma tu correo para poder iniciar sesión."}, status=status.HTTP_201_CREATED)


class VerifyEmailView(DocumentedAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    @transaction.atomic
    def post(self, request):
        token = str(request.data.get("token", ""))
        verification = EmailVerification.objects.select_for_update().select_related("user").filter(token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at__gt=timezone.now()).first()
        if not verification:
            raise ValidationError({"detail": "El enlace de verificación no es válido o expiró."})
        user = verification.user
        user.email_verified = True
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified", "email_verified_at", "updated_at"])
        verification.delete()
        return Response({"data": {"email_verified": True, "email": user.email}})


class ResendVerificationView(DocumentedAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    def post(self, request):
        email = str(request.data.get("email", "")).strip().lower()
        user = User.objects.filter(email=email).first()
        sent = send_verification_email(user) if user and not user.email_verified else False
        return Response({"detail": "Si la cuenta requiere verificación, enviaremos un enlace al correo registrado.", "email_sent": sent})


class PreferencesView(DocumentedAPIView):
    def get(self, request):
        preferences, _ = UserPreference.objects.get_or_create(user=request.user)
        return Response({"data": UserPreferenceSerializer(preferences).data})

    def patch(self, request):
        preferences, _ = UserPreference.objects.get_or_create(user=request.user)
        serializer = UserPreferenceSerializer(preferences, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"data": serializer.data})


class ProfileImageView(DocumentedAPIView):
    parser_classes = [MultiPartParser, FormParser]
    def post(self, request):
        image = request.FILES.get("image")
        if not image:
            raise ValidationError({"image": "Selecciona una imagen."})
        if image.size > 5 * 1024 * 1024:
            raise ValidationError({"image": "La imagen no puede superar 5 MB."})
        if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
            raise ValidationError({"image": "Usa una imagen JPEG, PNG o WebP."})
        try:
            from PIL import Image
            check = Image.open(image)
            check.verify()
            extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[image.content_type]
            image.seek(0)
        except Exception:
            raise ValidationError({"image": "El archivo no es una imagen válida."})
        if not settings.AWS_STORAGE_BUCKET_NAME:
            return Response({"detail": "El almacenamiento de imágenes no está configurado."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if request.user.profile_image:
            old_name = request.user.profile_image.rsplit("/", 1)[-1]
            try: default_storage.delete(f"profiles/{request.user.id}/{old_name}")
            except Exception: pass
        name = default_storage.save(f"profiles/{request.user.id}/{secrets.token_hex(16)}{extension}", ContentFile(image.read()))
        request.user.profile_image = default_storage.url(name)
        request.user.save(update_fields=["profile_image", "updated_at"])
        return Response({"data": {"profile_image": request.user.profile_image}})

    def delete(self, request):
        if request.user.profile_image:
            name = request.user.profile_image.rsplit("/", 1)[-1]
            try: default_storage.delete(f"profiles/{request.user.id}/{name}")
            except Exception: pass
            request.user.profile_image = ""
            request.user.save(update_fields=["profile_image", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(DocumentedAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"data": ProfileSerializer(request.user).data})


class CompleteOnboardingView(DocumentedAPIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        user.is_active = True
        user.onboarding_completed_at = timezone.now()
        user.save(update_fields=["is_active", "onboarding_completed_at", "updated_at"])
        return Response({"data": ProfileSerializer(user).data})


class PublicInvitationView(DocumentedAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    def get(self, request, token):
        invitation = Invitation.objects.select_related("admin", "manager").filter(token_hash=token_hash(token), status=Invitation.Status.PENDING).first()
        if not invitation:
            raise NotFound("El enlace no es válido o ya fue usado.")
        inviter = invitation.admin if invitation.kind == Invitation.Kind.MANAGER else invitation.manager
        return Response({"data": {"role": invitation.kind, "placeholder_name": invitation.placeholder_name, "manager_name": inviter.full_name if inviter else None, "email": invitation.recipient_email}})

    @transaction.atomic
    def post(self, request, token):
        invitation = Invitation.objects.select_for_update().filter(token_hash=token_hash(token), status=Invitation.Status.PENDING).first()
        if not invitation:
            raise NotFound("El enlace no es válido o ya fue usado.")
        invitation = Invitation.objects.select_related("admin", "manager").get(pk=invitation.pk)
        serializer = InviteCompletionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        submitted_email = data.get("email", "").strip().lower()
        if invitation.recipient_email and submitted_email and invitation.recipient_email.lower() != submitted_email:
            raise ValidationError({"email": "Usa el correo al que se envió la invitación."})
        email = invitation.recipient_email.lower() if invitation.recipient_email else submitted_email
        if not email:
            raise ValidationError({"email": "Escribe un correo para crear tu cuenta."})
        invited_email_is_verified = bool(invitation.recipient_email)
        verified_at = timezone.now() if invited_email_is_verified else None
        try:
            parent = invitation.admin if invitation.kind == Invitation.Kind.MANAGER else invitation.manager
            user = User.objects.create_user(email=email, password=data["password"], full_name=data["full_name"], role=invitation.kind, parent_user=parent, is_active=True, onboarding_completed_at=timezone.now(), email_verified=invited_email_is_verified, email_verified_at=verified_at)
        except IntegrityError:
            raise ValidationError({"email": "Ese correo ya está registrado."})
        invitation.status = Invitation.Status.USED
        invitation.used_by = user
        invitation.used_at = timezone.now()
        invitation.save(update_fields=["status", "used_by", "used_at"])
        audit(user, "profile", user.id, "complete_invite")
        verification_sent = False if invited_email_is_verified else send_verification_email(user)
        return Response({"data": {**ProfileSerializer(user).data, "email_verification_sent": verification_sent}}, status=status.HTTP_201_CREATED)


class ProfileListCreateView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN]

    def get(self, request):
        role = request.query_params.get("role", User.Role.MANAGER)
        qs = User.objects.filter(role=role).select_related("parent_user").prefetch_related("children")
        rows = [{**row, "kind": "profile", "status_label": "Activo" if row["is_active"] else "Inactivo"} for row in ProfileSerializer(qs, many=True).data]
        kind = Invitation.Kind.MANAGER if role == User.Role.MANAGER else Invitation.Kind.CAPTURER
        invites = Invitation.objects.filter(kind=kind, status=Invitation.Status.PENDING)
        invites = invites.filter(admin=request.user) if role == User.Role.MANAGER else invites.filter(manager=request.user)
        rows.extend({"id": str(invite.id), "kind": "invite", "placeholder_name": invite.placeholder_name, "full_name": invite.placeholder_name, "email": invite.recipient_email, "status_label": "Pendiente", "created_at": invite.created_at} for invite in invites)
        return Response({"data": rows})

    def post(self, request):
        body = dict(request.data)
        body.setdefault("full_name", body.get("placeholder_name", ""))
        data = AccountInviteSerializer(data=body)
        data.is_valid(raise_exception=True)
        validated = data.validated_data
        role = request.query_params.get("role", request.data.get("role", User.Role.MANAGER))
        parent = request.user
        if role == User.Role.CAPTURER:
            parent = User.objects.filter(id=validated.get("manager_id"), role=User.Role.MANAGER).first()
            if not parent:
                raise ValidationError({"manager_id": "Gestor no encontrado."})
        if role not in (User.Role.MANAGER, User.Role.CAPTURER):
            raise ValidationError({"role": "Rol inválido."})
        return create_invitation(request.user, parent, role, validated["full_name"], validated.get("email", ""), legacy=True)


class ProfileDetailView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def patch(self, request, user_id):
        target = get_managed_profile(request.user, user_id, User.Role.MANAGER if "/gestores/" in request.path else User.Role.CAPTURER)
        fields = {}
        if "full_name" in request.data:
            fields["full_name"] = str(request.data["full_name"]).strip()
        if "is_active" in request.data:
            fields["is_active"] = bool(request.data["is_active"])
        if not fields or ("full_name" in fields and not fields["full_name"]):
            raise ValidationError("Envía al menos un cambio válido.")
        for key, value in fields.items():
            setattr(target, key, value)
        target.save()
        audit(request.user, "profile", target.id, "update_profile")
        return Response({"data": ProfileSerializer(target).data})

    def delete(self, request, user_id):
        target = get_managed_profile(request.user, user_id, User.Role.MANAGER if "/gestores/" in request.path else User.Role.CAPTURER)
        children = User.objects.filter(parent_user=target).count()
        records = Record.objects.filter(Q(capturer=target) | Q(manager=target)).count()
        if children or records:
            blockers = []
            if children:
                blockers.append(f"{children} miembro(s) dependen de esta cuenta")
            if records:
                blockers.append(f"{records} registro(s) están asociados")
            raise ValidationError({"detail": f"No se puede borrar a {target.full_name}: {'; '.join(blockers)}. Elimina primero esos miembros o conserva la cuenta desactivada para mantener el historial."})
        target_id = target.id
        try:
            with transaction.atomic():
                CaptureSession.objects.filter(Q(manager=target) | Q(capturer=target), records__isnull=True).delete()
                audit(request.user, "profile", target_id, "delete_profile")
                target.delete()
        except ProtectedError:
            raise ValidationError({"detail": "No se pudo borrar la cuenta porque todavía tiene datos relacionados protegidos. Conserva la cuenta desactivada para no perder el historial."})
        return Response(status=status.HTTP_204_NO_CONTENT)


class CapturerListView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def get(self, request):
        qs = User.objects.filter(role=User.Role.CAPTURER).select_related("parent_user")
        if request.user.role == User.Role.MANAGER:
            qs = qs.filter(parent_user=request.user)
        profiles = ProfileSerializer(qs, many=True).data
        invites = Invitation.objects.filter(kind=Invitation.Kind.CAPTURER, status=Invitation.Status.PENDING)
        if request.user.role == User.Role.MANAGER:
            invites = invites.filter(manager=request.user)
        rows = [{**item, "kind": "profile", "status_label": "Activo" if item["is_active"] else "Inactivo"} for item in profiles]
        rows += [{"id": str(item.id), "kind": "invite", "placeholder_name": item.placeholder_name, "email": item.recipient_email, "status_label": "Pendiente", "created_at": item.created_at} for item in invites]
        return Response({"data": rows})


class InviteCreateView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def post(self, request):
        body = dict(request.data)
        body.setdefault("full_name", body.get("placeholder_name", ""))
        data = AccountInviteSerializer(data=body)
        data.is_valid(raise_exception=True)
        validated = data.validated_data
        kind = request.data.get("role")
        if request.user.role == User.Role.ADMIN and request.path.endswith("manager-invite-links"):
            kind = User.Role.MANAGER
        elif request.user.role == User.Role.MANAGER:
            kind = User.Role.CAPTURER
        if kind not in (User.Role.MANAGER, User.Role.CAPTURER):
            raise ValidationError({"role": "Rol de invitación inválido."})
        parent = request.user
        if kind == User.Role.CAPTURER and request.user.role == User.Role.ADMIN:
            parent = User.objects.filter(id=validated.get("manager_id"), role=User.Role.MANAGER).first()
            if not parent:
                raise ValidationError({"manager_id": "Gestor no encontrado."})
        return create_invitation(request.user, parent, kind, validated["full_name"], validated.get("email", ""))


class InviteResendView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def post(self, request, invitation_id):
        invitation = Invitation.objects.filter(id=invitation_id, status=Invitation.Status.PENDING).first()
        if not invitation or (request.user.role == User.Role.MANAGER and invitation.manager_id != request.user.id) or (request.user.role == User.Role.ADMIN and invitation.admin_id not in (None, request.user.id)):
            raise NotFound("Invitación pendiente no encontrada.")
        link = rotate_invitation_link(invitation)
        return Response({"data": {**InvitationSerializer(invitation).data, "link": link, "action": "link_generated"}})


class InviteEmailResendView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def post(self, request, invitation_id):
        invitation = Invitation.objects.filter(id=invitation_id, status=Invitation.Status.PENDING).first()
        if not invitation or (request.user.role == User.Role.MANAGER and invitation.manager_id != request.user.id) or (request.user.role == User.Role.ADMIN and invitation.admin_id not in (None, request.user.id)):
            raise NotFound("Invitación pendiente no encontrada.")
        if not invitation.recipient_email:
            raise ValidationError({"email": "Esta invitación no tiene correo. Genera y comparte el enlace."})
        link = rotate_invitation_link(invitation)
        role_label = "gestor" if invitation.kind == Invitation.Kind.MANAGER else "capturador"
        sent = send_resend_email(invitation.recipient_email, f"Invitación para ser {role_label} · Gestión de Captura", invitation_email_html(invitation.placeholder_name, role_label, link), "invitación")
        warning = None if sent else "Resend no aceptó el correo. Revisa la consola de la API."
        return Response({"data": {"email_sent": sent, "warning": warning}})


class CaptureContextView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.CAPTURER]

    def get(self, request):
        manager = request.user.parent_user
        if not manager or not manager.is_active:
            raise ValidationError("El capturador no tiene un gestor activo.")
        session, _ = CaptureSession.objects.get_or_create(capturer=request.user, status=CaptureSession.Status.OPEN, section_code="GENERAL", defaults={"manager": manager, "leadership_name": manager.full_name})
        return Response({"data": {"manager_id": str(manager.id), "leadership_name": manager.full_name, "capture_session_id": str(session.id), "section_code": session.section_code}})


class RecordListCreateView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER, User.Role.CAPTURER]

    def get(self, request):
        qs = apply_record_filters(visible_records(request.user), request.query_params).order_by("-created_at")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(RecordSerializer(page, many=True).data)

    def post(self, request):
        serializer = RecordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        record = serializer.save()
        audit(request.user, "records", record.id, "create_record")
        return Response({"data": RecordSerializer(record, context={"request": request}).data}, status=status.HTTP_201_CREATED)


class RecordDetailView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER, User.Role.CAPTURER]

    def get_object(self, request, record_id):
        record = visible_records(request.user).filter(id=record_id).first()
        if not record:
            raise NotFound("Registro no encontrado.")
        return record

    def patch(self, request, record_id):
        record = self.get_object(request, record_id)
        if request.user.role == User.Role.MANAGER:
            raise PermissionDenied("El gestor solo puede consultar los registros de su equipo.")
        serializer = RecordSerializer(record, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        record = serializer.save()
        audit(request.user, "records", record.id, "update_record")
        return Response({"data": RecordSerializer(record, context={"request": request}).data})

    def delete(self, request, record_id):
        record = self.get_object(request, record_id)
        if request.user.role == User.Role.MANAGER:
            raise PermissionDenied("No puedes eliminar registros.")
        if request.user.role == User.Role.ADMIN:
            record.status = Record.Status.VOIDED
            record.save(update_fields=["status", "updated_at"])
        else:
            record.delete()
        audit(request.user, "records", record.id, "delete_record")
        return Response(status=status.HTTP_204_NO_CONTENT)


class RecordSuggestionsView(DocumentedAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = visible_records(request.user)
        return Response({"data": {
            "addresses": sorted(set(qs.exclude(address="").values_list("address", flat=True))),
            "districts": sorted(set(qs.exclude(district__isnull=True).exclude(district="").values_list("district", flat=True))),
            "neighborhoods": sorted(set(qs.exclude(neighborhood__isnull=True).exclude(neighborhood="").values_list("neighborhood", flat=True))),
            "postal_codes": sorted(set(qs.exclude(postal_code__isnull=True).exclude(postal_code="").values_list("postal_code", flat=True))),
        }})


class DashboardView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def get(self, request, role):
        if (role == "admin" and request.user.role != User.Role.ADMIN) or (role == "gestor" and request.user.role != User.Role.MANAGER):
            raise PermissionDenied("No tienes permisos para este panel.")
        records = visible_records(request.user).filter(status=Record.Status.ACTIVE)
        users = User.objects.filter(role=User.Role.MANAGER if role == "admin" else User.Role.CAPTURER)
        if role == "gestor":
            users = users.filter(parent_user=request.user)
        counts = dashboard_counts(records)
        ranking = list(users.annotate(total_records=Count("records_captured", filter=Q(records_captured__status=Record.Status.ACTIVE)), last_record_at=Max("records_captured__created_at", filter=Q(records_captured__status=Record.Status.ACTIVE))).values("id", "full_name", "total_records", "last_record_at").order_by("-total_records", "full_name"))
        areas = list(records.values("district").annotate(total=Count("id")).order_by("-total")[:10])
        goals = Goal.objects.filter(status="active", archived_at__isnull=True)
        if role == "gestor":
            goals = goals.filter(manager=request.user)
        goal_rows = [{**GoalSerializer(item).data} for item in goals.select_related("manager", "capturer")]
        inactive_alerts = []
        if role == "gestor":
            cutoff = timezone.now() - timedelta(days=7)
            inactive_alerts = list(users.annotate(total_records=Count("records_captured", filter=Q(records_captured__status=Record.Status.ACTIVE)), last_record_at=Max("records_captured__created_at", filter=Q(records_captured__status=Record.Status.ACTIVE))).filter(Q(last_record_at__isnull=True) | Q(last_record_at__lt=cutoff)).values("id", "full_name", "total_records", "last_record_at"))
        return Response({"data": {**counts, "total_capturadores": users.count(), "ranking": ranking, "top_zones": [{"zone": item["district"] or "Sin distrito", "total": item["total"]} for item in areas], "goals": goal_rows, "active_goals_list": goal_rows, "admin_goal": next((g for g in goal_rows if g["created_by_role"] == User.Role.ADMIN), None), "team_goal": next((g for g in goal_rows if g["capturer"] is None and g["created_by_role"] == User.Role.MANAGER), None), "inactive_alerts": inactive_alerts}})


class ManagerCapturersView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.MANAGER]

    def get(self, request, user_id=None):
        qs = User.objects.filter(role=User.Role.CAPTURER, parent_user=request.user).select_related("parent_user")
        if user_id:
            qs = qs.filter(id=user_id)
        rows = ProfileSerializer(qs, many=True).data
        result = []
        for row in rows:
            user = qs.get(id=row["id"])
            result.append({**row, "kind": "profile", "status_label": "Activo" if user.is_active else "Inactivo", "total_records": user.records_captured.filter(status="active").count(), "records_today": user.records_captured.filter(status="active", created_at__date=timezone.localdate()).count(), "records_week": user.records_captured.filter(status="active", created_at__date__gte=timezone.localdate() - timedelta(days=timezone.localdate().weekday())).count()})
        if user_id and not result:
            raise NotFound("Capturador no encontrado.")
        if user_id:
            user = qs.first()
            records = user.records_captured.filter(status=Record.Status.ACTIVE)
            active_goal = Goal.objects.filter(manager=request.user, capturer=user, status="active", archived_at__isnull=True).first()
            return Response({"data": {"kind": "profile", "capturer": ProfileSerializer(user).data, "total_records": records.count(), "recent_records": RecordSerializer(records[:10], many=True).data, "top_zones": list(records.values("district").annotate(total=Count("id")).order_by("-total")[:5]), "current_goal": GoalSerializer(active_goal).data if active_goal else None, "can_resend_invite": not user.onboarding_completed_at}})
        return Response({"data": result})


@extend_schema_view(get=extend_schema(operation_id="manager_capturer_detail_retrieve"))
class ManagerCapturerDetailView(ManagerCapturersView):
    """Separate the list and detail operations in the generated API schema."""


@extend_schema_view(get=extend_schema(operation_id="admin_managers_list"))
class AdminManagersView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN]

    def get(self, request):
        managers = User.objects.filter(role=User.Role.MANAGER).prefetch_related("children")
        rows = []
        for manager in managers:
            records = manager.records_managed.filter(status=Record.Status.ACTIVE)
            goals = Goal.objects.filter(manager=manager, capturer__isnull=True, status="active", archived_at__isnull=True).select_related("manager")
            goal_data = [GoalSerializer(goal).data for goal in goals]
            rows.append({**ProfileSerializer(manager).data,
                "total_capturadores": manager.children.filter(role=User.Role.CAPTURER).count(),
                "capturadores_activos": manager.children.filter(role=User.Role.CAPTURER, is_active=True).count(),
                "total_records": records.count(), "active_goals": len(goal_data),
                "active_goals_list": goal_data, "main_goal": goal_data[0] if goal_data else None,
                "last_activity_at": records.aggregate(value=Max("created_at"))["value"]})
        return Response({"data": rows})


class AdminManagerDetailView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN]

    def get(self, request, manager_id):
        manager = User.objects.filter(id=manager_id, role=User.Role.MANAGER).first()
        if not manager:
            raise NotFound("Gestor no encontrado.")
        records = manager.records_managed.filter(status=Record.Status.ACTIVE)
        goals = Goal.objects.filter(manager=manager, status="active", archived_at__isnull=True).select_related("manager", "capturer")
        goal_data = [GoalSerializer(goal).data for goal in goals]
        ranking = list(User.objects.filter(parent_user=manager, role=User.Role.CAPTURER).annotate(total_records=Count("records_captured", filter=Q(records_captured__status=Record.Status.ACTIVE)), last_record_at=Max("records_captured__created_at", filter=Q(records_captured__status=Record.Status.ACTIVE))).values("id", "full_name", "total_records", "last_record_at").order_by("-total_records", "full_name"))
        return Response({"data": {"manager": ProfileSerializer(manager).data, "total_records": records.count(), "total_capturadores": manager.children.filter(role=User.Role.CAPTURER).count(), "active_goals": len(goal_data), "active_goals_list": goal_data, "ranking": ranking, "top_zones": list(records.values("district").annotate(total=Count("id")).order_by("-total")[:10])}})


class AdminManagerGoalsView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN]

    def get(self, request):
        qs = Goal.objects.filter(capturer__isnull=True, created_by_role=User.Role.ADMIN).select_related("manager")
        return Response({"data": [GoalSerializer(goal).data for goal in qs]})

    @transaction.atomic
    def post(self, request):
        body = dict(request.data)
        manager_id = body.pop("manager_id", None) or body.pop("capturer_id", None)
        manager = User.objects.filter(id=manager_id, role=User.Role.MANAGER).first()
        if not manager:
            raise ValidationError({"manager_id": "Selecciona un gestor."})
        serializer = GoalSerializer(data={**body, "capturer_id": None}, context={"request": request})
        serializer.is_valid(raise_exception=True)
        goal = serializer.save(manager=manager, capturer=None, created_by_role=User.Role.ADMIN)
        audit(request.user, "capturer_goals", goal.id, "admin_create_manager_goal")
        return Response({"data": GoalSerializer(goal).data}, status=status.HTTP_201_CREATED)


class AdminManagerGoalDetailView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN]

    def get_object(self, goal_id):
        goal = Goal.objects.filter(id=goal_id, capturer__isnull=True).first()
        if not goal:
            raise NotFound("Meta no encontrada.")
        return goal

    def patch(self, request, goal_id):
        goal = self.get_object(goal_id)
        serializer = GoalSerializer(goal, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        audit(request.user, "capturer_goals", updated.id, "admin_update_manager_goal")
        return Response({"data": GoalSerializer(updated).data})

    def delete(self, request, goal_id):
        goal = self.get_object(goal_id)
        goal.delete()
        audit(request.user, "capturer_goals", goal_id, "admin_delete_manager_goal")
        return Response(status=status.HTTP_204_NO_CONTENT)


class GoalListCreateView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def get(self, request):
        qs = Goal.objects.select_related("manager", "capturer")
        if request.user.role == User.Role.MANAGER:
            qs = qs.filter(manager=request.user)
        data = [GoalSerializer(item).data for item in qs]
        return Response({"data": {"active": [item for item in data if item["status"] == "active" and not item["archived_at"]], "history": [item for item in data if item["status"] != "active" or item["archived_at"]]}})

    @transaction.atomic
    def post(self, request):
        serializer = GoalSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        manager = request.user
        if request.user.role == User.Role.ADMIN:
            manager_id = request.data.get("manager_id") or request.data.get("capturer_id")
            manager = User.objects.filter(id=manager_id, role=User.Role.MANAGER).first()
            if not manager:
                raise ValidationError({"manager_id": "Gestor no encontrado."})
        capturer = serializer.validated_data.get("capturer")
        if capturer and capturer.parent_user_id != manager.id:
            raise ValidationError({"capturer_id": "El capturador no pertenece al gestor."})
        starts = serializer.validated_data["starts_on"]
        ends = serializer.validated_data["ends_on"]
        if ends < starts:
            raise ValidationError({"ends_on": "La fecha final no puede ser anterior al inicio."})
        Goal.objects.filter(manager=manager, capturer=capturer, period_type=serializer.validated_data["period_type"], status="active", archived_at__isnull=True).update(status="archived", archived_at=timezone.now())
        goal = serializer.save(manager=manager, created_by_role=request.user.role)
        audit(request.user, "capturer_goals", goal.id, "create_goal")
        return Response({"data": GoalSerializer(goal).data}, status=status.HTTP_201_CREATED)


class GoalDetailView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def get_object(self, request, goal_id):
        qs = Goal.objects.select_related("manager", "capturer").filter(id=goal_id)
        if request.user.role == User.Role.MANAGER:
            qs = qs.filter(manager=request.user)
        goal = qs.first()
        if not goal:
            raise NotFound("Meta no encontrada.")
        return goal

    def patch(self, request, goal_id):
        goal = self.get_object(request, goal_id)
        serializer = GoalSerializer(goal, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        changed = serializer.save()
        audit(request.user, "capturer_goals", changed.id, "update_goal")
        return Response({"data": GoalSerializer(changed).data})

    def delete(self, request, goal_id):
        goal = self.get_object(request, goal_id)
        goal.delete()
        audit(request.user, "capturer_goals", goal_id, "delete_goal")
        return Response(status=status.HTTP_204_NO_CONTENT)


class ManagerRecordsView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.MANAGER, User.Role.ADMIN]

    def get(self, request):
        qs = apply_record_filters(visible_records(request.user), request.query_params).order_by("-created_at")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(RecordSerializer(page, many=True).data)


class FilterOptionsView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.ADMIN, User.Role.MANAGER]

    def get(self, request):
        qs = visible_records(request.user)
        return Response({"data": {key: sorted(set(values)) for key, values in {
            "addresses": qs.exclude(address="").values_list("address", flat=True),
            "districts": qs.exclude(district__isnull=True).exclude(district="").values_list("district", flat=True),
            "neighborhoods": qs.exclude(neighborhood__isnull=True).exclude(neighborhood="").values_list("neighborhood", flat=True),
            "postal_codes": qs.exclude(postal_code__isnull=True).exclude(postal_code="").values_list("postal_code", flat=True),
            "sections": qs.exclude(section_code="").values_list("section_code", flat=True),
        }.items()}})


class ExportsView(DocumentedAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = apply_record_filters(visible_records(request.user), request.query_params).order_by("-created_at")
        rows = list(qs.values("id", "leadership_name", "section_code", "first_name", "paternal_surname", "maternal_surname", "address", "exterior_number", "neighborhood", "district", "postal_code", "birth_date", "phone", "electoral_key", "observations", "status", "created_at", "manager_id", "capturer_id"))
        headers = list(rows[0].keys()) if rows else ["id"]
        fmt = request.query_params.get("format", "csv")
        audit(request.user, "records", None, f"export_{fmt}")
        if fmt == "xlsx":
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Registros"
            sheet.append(headers)
            for row in rows:
                sheet.append([str(row[key]) if row[key] is not None else "" for key in headers])
            stream = io.BytesIO()
            workbook.save(stream)
            response = HttpResponse(stream.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            response["Content-Disposition"] = 'attachment; filename="registros.xlsx"'
            return response
        if fmt != "csv":
            raise ValidationError({"format": "Usa csv o xlsx."})
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="registros.csv"'
        response.write("\ufeff")
        writer = csv.DictWriter(response, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: str(value) if value is not None else "" for key, value in row.items()})
        return response


class DemoRecordsView(DocumentedAPIView):
    permission_classes = [IsAuthenticated, HasRole]
    allowed_roles = [User.Role.MANAGER]

    def post(self, request):
        if not getattr(settings, "ENABLE_DEMO_DATA", False):
            raise PermissionDenied("Los datos demo están desactivados.")
        capturer = User.objects.filter(parent_user=request.user, role=User.Role.CAPTURER, is_active=True).first()
        if not capturer:
            raise ValidationError("Necesitas al menos un capturador activo.")
        count = int(request.data.get("count", 200))
        if not 1 <= count <= 500:
            raise ValidationError({"count": "El valor debe estar entre 1 y 500."})
        session, _ = CaptureSession.objects.get_or_create(capturer=capturer, status=CaptureSession.Status.OPEN, section_code="GENERAL", defaults={"manager": request.user, "leadership_name": request.user.full_name})
        created = []
        for idx in range(count):
            suffix = secrets.token_hex(9).upper()
            created.append(Record(capture_session=session, capturer=capturer, manager=request.user, leadership_name=request.user.full_name.upper(), section_code="GENERAL", first_name=f"Demo{idx + 1}", paternal_surname="Prueba", address="Domicilio de demostración", birth_date=timezone.localdate() - timedelta(days=365 * 30), phone=f"55{secrets.randbelow(10**8):08d}", electoral_key=suffix, observations="[DEMO-GESTOR] Registro sintético de prueba."))
        Record.objects.bulk_create(created)
        audit(request.user, "records", None, "create_demo_records", {"count": len(created)})
        return Response({"data": {"created": len(created), "marker": "[DEMO-GESTOR]"}}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        if not getattr(settings, "ENABLE_DEMO_DATA", False):
            raise PermissionDenied("Los datos demo están desactivados.")
        deleted, _ = Record.objects.filter(manager=request.user, observations__contains="[DEMO-GESTOR]").delete()
        audit(request.user, "records", None, "delete_demo_records", {"deleted": deleted})
        return Response({"data": {"deleted": deleted, "marker": "[DEMO-GESTOR]"}})


def get_managed_profile(actor, profile_id, expected_role):
    qs = User.objects.select_related("parent_user")
    if actor.role == User.Role.MANAGER:
        qs = qs.filter(parent_user=actor, role=User.Role.CAPTURER)
    else:
        qs = qs.filter(role=expected_role)
    target = qs.filter(id=profile_id).first()
    if not target:
        raise NotFound("Perfil no encontrado.")
    return target


@transaction.atomic
def create_invitation(actor, parent, role, full_name, email, legacy=False):
    email = (email or "").strip().lower()
    identifier = " ".join((full_name or "").split()).casefold()
    if Invitation.objects.filter(status=Invitation.Status.PENDING).exists():
        pending_identifiers = Invitation.objects.filter(status=Invitation.Status.PENDING).values_list("placeholder_name", flat=True)
        if any(" ".join(value.split()).casefold() == identifier for value in pending_identifiers):
            raise ValidationError({"placeholder_name": "Ya existe una invitación pendiente con ese identificador. Usa uno diferente."})
    if email:
        if User.objects.filter(email__iexact=email).exists():
            raise ValidationError({"email": "Ya existe una cuenta con ese correo."})
        if Invitation.objects.filter(recipient_email__iexact=email, status=Invitation.Status.PENDING).exists():
            raise ValidationError({"email": "Ya existe una invitación pendiente con ese correo. Puedes reenviarla desde la lista de miembros."})
    kind = Invitation.Kind.MANAGER if role == User.Role.MANAGER else Invitation.Kind.CAPTURER
    token = invite_token()
    invitation = Invitation.objects.create(kind=kind, token_hash=token_hash(token), admin=actor if kind == Invitation.Kind.MANAGER else None, manager=parent if kind == Invitation.Kind.CAPTURER else None, placeholder_name=full_name, recipient_email=email or None)
    base = getattr(settings, "APP_URL", "http://localhost:4200").rstrip("/")
    link = f"{base}/auth/invite/{token}"
    audit(actor, "invitation", invitation.id, "create_invitation")
    data = {"id": str(invitation.id), "kind": "invite", "placeholder_name": full_name, "full_name": full_name, "email": email or None, "status_label": "Pendiente", "created_at": invitation.created_at} if legacy else InvitationSerializer(invitation).data
    sent = False
    if email:
        role_label = "gestor" if kind == Invitation.Kind.MANAGER else "capturador"
        sent = send_resend_email(email, f"Invitación para ser {role_label} · Gestión de Captura", invitation_email_html(full_name, role_label, link), "invitación")
    warning = None if sent else ("No se indicó correo. Comparte el enlace manualmente." if not email else "Resend no aceptó el correo. Revisa la consola de la API y copia el enlace para compartirlo.")
    return Response({"data": {**data, "email": email or None, "link": link, "email_sent": sent, "warning": warning}}, status=status.HTTP_201_CREATED)


def rotate_invitation_link(invitation):
    token = invite_token()
    invitation.token_hash = token_hash(token)
    invitation.save(update_fields=["token_hash"])
    base = getattr(settings, "APP_URL", "http://localhost:4200").rstrip("/")
    return f"{base}/auth/invite/{token}"


def invitation_email_html(full_name, role_label, link):
    return f"<p>Hola {escape(full_name)},</p><p>Te invitaron a unirte a Gestión de Captura como {escape(role_label)}.</p><p><a href=\"{escape(link, quote=True)}\">Completar registro</a></p><p>Si no esperabas esta invitación, ignora este mensaje.</p>"


def send_resend_email(to, subject, html, purpose):
    if not settings.RESEND_API_KEY:
        logger.error("No se envió %s: RESEND_API_KEY no está configurada en el proceso de Django.", purpose)
        return False
    body = {"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "html": html}
    req = urllib.request.Request("https://api.resend.com/emails", data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "gestion-captura/1.0 (Django transactional email)"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            if 200 <= response.status < 300:
                logger.warning("Correo de %s aceptado por Resend (HTTP %s).", purpose, response.status)
                return True
            logger.error("Resend rechazó correo de %s (HTTP %s).", purpose, response.status)
            return False
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        logger.error("Resend rechazó correo de %s (HTTP %s): %s", purpose, exc.code, detail)
        return False
    except urllib.error.URLError as exc:
        logger.error("No se pudo conectar con Resend para correo de %s: %s", purpose, exc.reason)
        return False
    except TimeoutError:
        logger.error("Tiempo de espera agotado enviando correo de %s a Resend.", purpose)
        return False


def send_verification_email(user):
    if user.email_verified:
        return False
    if not settings.RESEND_API_KEY:
        logger.error("No se envió verificación: RESEND_API_KEY no está configurada en el proceso de Django.")
        return False
    token = secrets.token_urlsafe(40)
    EmailVerification.objects.filter(user=user).delete()
    EmailVerification.objects.create(user=user, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=timezone.now() + timedelta(hours=settings.EMAIL_VERIFICATION_HOURS))
    url = f"{settings.APP_URL.rstrip('/')}/auth/confirm?token={token}"
    html = f"<p>Hola {escape(user.full_name)},</p><p>Confirma tu correo para iniciar sesión.</p><p><a href=\"{escape(url, quote=True)}\">Verificar correo</a></p><p>El enlace vence en 24 horas.</p>"
    return send_resend_email(user.email, "Verifica tu correo · Gestión de Captura", html, "verificación")
