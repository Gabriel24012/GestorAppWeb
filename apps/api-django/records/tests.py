import hashlib
import io
import shutil
import tempfile
from datetime import date, timedelta

from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import CaptureSession, EmailVerification, Invitation, Record, User
from .views import ProfileImageView


class AuthenticationAndRoleContractTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="admin@example.test", password="local-test-password", full_name="Admin Demo", role=User.Role.ADMIN, email_verified=True)
        self.manager = User.objects.create_user(email="manager@example.test", password="local-test-password", full_name="Gestor Demo", role=User.Role.MANAGER, parent_user=self.admin, email_verified=True)
        self.capturer = User.objects.create_user(email="capturer@example.test", password="local-test-password", full_name="Capturador Demo", role=User.Role.CAPTURER, parent_user=self.manager, email_verified=True)
        self.other_capturer = User.objects.create_user(email="other@example.test", password="local-test-password", full_name="Otro Demo", role=User.Role.CAPTURER, parent_user=self.manager, email_verified=True)
        self.session = CaptureSession.objects.create(capturer=self.capturer, manager=self.manager, leadership_name=self.manager.full_name)
        self.own_record = Record.objects.create(capture_session=self.session, capturer=self.capturer, manager=self.manager, leadership_name=self.manager.full_name, first_name="Ana", paternal_surname="Prueba", address="Calle Demo", birth_date=date(1990, 1, 1), phone="5512345678", electoral_key="AAAA000000HDFXXX01")
        Record.objects.create(capturer=self.other_capturer, manager=self.manager, leadership_name=self.manager.full_name, first_name="Luis", paternal_surname="Prueba", address="Calle Demo", birth_date=date(1990, 1, 1), phone="5512345679", electoral_key="BBBB000000HDFXXX02")

    def test_login_returns_profile_and_jwt_pair(self):
        response = self.client.post("/api/v1/auth/token", {"email": self.capturer.email, "password": "local-test-password"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["role"], User.Role.CAPTURER)
        self.assertTrue(response.data["access"])
        self.assertTrue(response.data["refresh"])

    def test_refresh_issues_a_new_access_token(self):
        login = self.client.post("/api/v1/auth/token", {"email": self.capturer.email, "password": "local-test-password"}, format="json")
        response = self.client.post("/api/v1/auth/token/refresh", {"refresh": login.data["refresh"]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["access"])
        self.assertTrue(response.data["refresh"])

    def test_capturer_only_sees_own_records_with_nested_relations(self):
        self.client.force_authenticate(self.capturer)
        response = self.client.get("/api/v1/records")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["meta"]["total"], 1)
        row = response.data["data"][0]
        self.assertEqual(row["id"], str(self.own_record.id))
        self.assertEqual(row["capturer"]["id"], str(self.capturer.id))
        self.assertEqual(row["capture_session"]["id"], str(self.session.id))
        self.assertEqual(str(row["capture_session_id"]), str(self.session.id))

    def test_manager_cannot_create_records(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post("/api/v1/records", {"first_name": "Mal", "paternal_surname": "Uso", "address": "Calle", "birth_date": "1990-01-01", "phone": "5512345677", "electoral_key": "CCCC000000HDFXXX03"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_manager_records_are_limited_to_its_team(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get("/api/v1/manager/records")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["meta"]["total"], 2)

    def test_manager_can_update_a_record_from_its_team(self):
        self.client.force_authenticate(self.manager)
        response = self.client.patch(f"/api/v1/records/{self.own_record.id}", {"first_name": "Ana editada"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.own_record.refresh_from_db()
        self.assertEqual(self.own_record.first_name, "Ana editada")
        self.assertEqual(self.own_record.versions.count(), 1)

    def test_manager_delete_voids_a_record_from_its_team(self):
        self.client.force_authenticate(self.manager)
        response = self.client.delete(f"/api/v1/records/{self.own_record.id}")
        self.assertEqual(response.status_code, 204)
        self.own_record.refresh_from_db()
        self.assertEqual(self.own_record.status, Record.Status.VOIDED)

    def test_manager_cannot_change_a_record_from_another_team(self):
        other_manager = User.objects.create_user(email="other-manager@example.test", password="local-test-password", full_name="Gestor Externo", role=User.Role.MANAGER, parent_user=self.admin, email_verified=True)
        external_capturer = User.objects.create_user(email="external-capturer@example.test", password="local-test-password", full_name="Capturador Externo", role=User.Role.CAPTURER, parent_user=other_manager, email_verified=True)
        external_record = Record.objects.create(capturer=external_capturer, manager=other_manager, leadership_name=other_manager.full_name, first_name="Fuera", paternal_surname="Equipo", address="Calle Externa", birth_date=date(1990, 1, 1), phone="5512345680", electoral_key="DDDD000000HDFXXX04")
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.patch(f"/api/v1/records/{external_record.id}", {"first_name": "Alterado"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/v1/records/{external_record.id}").status_code, 404)
        external_record.refresh_from_db()
        self.assertEqual(external_record.first_name, "Fuera")
        self.assertEqual(external_record.status, Record.Status.ACTIVE)


@override_settings(ENABLE_DEMO_DATA=True)
class AdminDemoDataTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="demo-admin@example.test", password="local-test-password", full_name="Admin Demo", role=User.Role.ADMIN, email_verified=True)
        self.manager = User.objects.create_user(email="regular-manager@example.test", password="local-test-password", full_name="Gestor Real", role=User.Role.MANAGER, parent_user=self.admin, email_verified=True)

    def test_admin_creates_and_deletes_the_complete_demo_hierarchy(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/v1/admin/demo-data", {}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["data"]["managers"], 5)
        self.assertEqual(response.data["data"]["capturers"], 25)
        self.assertEqual(response.data["data"]["records"], 500)

        managers = User.objects.filter(role=User.Role.MANAGER, email__endswith="@demo.gestorapp.local")
        capturers = User.objects.filter(role=User.Role.CAPTURER, parent_user__in=managers)
        records = Record.objects.filter(manager__in=managers)
        self.assertEqual(managers.count(), 5)
        self.assertEqual(capturers.count(), 25)
        self.assertEqual(records.count(), 500)
        self.assertTrue(all(manager.children.filter(role=User.Role.CAPTURER).count() == 5 for manager in managers))
        self.assertTrue(all(capturer.records_captured.count() == 20 for capturer in capturers))
        self.assertFalse(records.filter(address="").exists())
        self.assertFalse(records.filter(exterior_number__isnull=True).exists())
        self.assertFalse(records.filter(neighborhood__isnull=True).exists())
        self.assertFalse(records.filter(district__isnull=True).exists())
        self.assertFalse(records.filter(postal_code__isnull=True).exists())
        self.assertFalse(records.filter(observations__isnull=True).exists())
        self.assertGreater(records.values("created_at__date").distinct().count(), 1)

        filtered = self.client.get("/api/v1/admin/records?district=Distrito%20Norte&limit=100")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.data["meta"]["total"], 100)

        deleted = self.client.delete("/api/v1/admin/demo-data")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual({key: deleted.data["data"][key] for key in ("managers", "capturers", "records")}, {"managers": 5, "capturers": 25, "records": 500})
        self.assertFalse(User.objects.filter(email__endswith="@demo.gestorapp.local").exists())
        self.assertTrue(User.objects.filter(pk=self.manager.pk).exists())

    def test_manager_cannot_manage_admin_demo_data(self):
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post("/api/v1/admin/demo-data", {}, format="json").status_code, 403)
        self.assertEqual(self.client.delete("/api/v1/admin/demo-data").status_code, 403)

    @override_settings(ENABLE_DEMO_DATA=False)
    def test_demo_data_respects_feature_flag(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post("/api/v1/admin/demo-data", {}, format="json").status_code, 403)


class NewAccountFeaturesTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="pending@example.test", password="local-test-password", full_name="Cuenta Pendiente", role=User.Role.ADMIN)

    def test_unverified_user_cannot_login_or_use_an_existing_access_token(self):
        response = self.client.post("/api/v1/auth/token", {"email": self.user.email, "password": "local-test-password"}, format="json")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"].code, "email_not_verified")
        access = str(RefreshToken.for_user(self.user).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post("/api/v1/auth/token/refresh", {"refresh": str(RefreshToken.for_user(self.user))}, format="json").status_code, 401)

    def test_email_verification_token_is_single_use(self):
        token = "one-time-verification-token"
        verification = EmailVerification.objects.create(user=self.user, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=timezone.now() + timedelta(hours=1))
        response = self.client.post("/api/v1/auth/verify-email", {"token": token}, format="json")
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.email_verified)
        self.assertIsNotNone(self.user.email_verified_at)
        self.assertFalse(EmailVerification.objects.filter(pk=verification.pk).exists())
        self.assertEqual(self.client.post("/api/v1/auth/verify-email", {"token": token}, format="json").status_code, 400)

    def test_expired_email_verification_token_is_rejected(self):
        token = "expired-verification-token"
        EmailVerification.objects.create(user=self.user, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.post("/api/v1/auth/verify-email", {"token": token}, format="json").status_code, 400)

    def test_preferences_are_saved_on_the_authenticated_account(self):
        self.user.email_verified = True
        self.user.save(update_fields=["email_verified"])
        self.client.force_authenticate(self.user)
        response = self.client.patch("/api/v1/preferences", {"theme": "dark", "font_size": "large", "language": "en"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/preferences").data["data"], response.data["data"])


class ProfileImageTests(APITestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.settings_override = override_settings(
            AWS_STORAGE_BUCKET_NAME="test-bucket",
            MEDIA_ROOT=self.media_root,
            MEDIA_URL="/media/",
            STORAGES={"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"}},
        )
        self.settings_override.enable()
        self.user = User.objects.create_user(email="photo@example.test", password="local-test-password", full_name="Cuenta con foto", role=User.Role.ADMIN, email_verified=True)
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    @staticmethod
    def image_file(image_format="PNG", advertised_type="image/png"):
        content = io.BytesIO()
        Image.new("RGB", (4, 4), "blue").save(content, format=image_format)
        return SimpleUploadedFile("mobile-photo", content.getvalue(), content_type=advertised_type)

    def test_mobile_upload_uses_image_contents_when_mime_metadata_is_wrong(self):
        response = self.client.post(
            "/api/v1/profile/image",
            {"image": self.image_file(image_format="PNG", advertised_type="image/jpeg")},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["data"]["profile_image"].endswith(".png"))
        self.user.refresh_from_db()
        self.assertEqual(self.user.profile_image, response.data["data"]["profile_image"])

    def test_replacing_and_deleting_a_profile_image_removes_the_stored_files(self):
        first = self.client.post("/api/v1/profile/image", {"image": self.image_file()}, format="multipart")
        self.user.refresh_from_db()
        first_name = ProfileImageView._storage_name(self.user)
        self.assertEqual(first.status_code, 200)
        self.assertTrue(default_storage.exists(first_name))

        second = self.client.post("/api/v1/profile/image", {"image": self.image_file(image_format="JPEG", advertised_type="image/jpeg")}, format="multipart")
        self.user.refresh_from_db()
        second_name = ProfileImageView._storage_name(self.user)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(default_storage.exists(first_name))
        self.assertTrue(default_storage.exists(second_name))

        deleted = self.client.delete("/api/v1/profile/image")
        self.user.refresh_from_db()
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.user.profile_image, "")
        self.assertFalse(default_storage.exists(second_name))


class PublicInvitationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="admin@example.test", password="local-test-password", full_name="Admin", role=User.Role.ADMIN, email_verified=True)

    def test_invitation_can_be_created_without_email_but_account_completion_requires_one(self):
        self.client.force_authenticate(self.admin)
        created = self.client.post("/api/v1/admin/manager-invite-links", {"placeholder_name": "Gestora sin correo"}, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertIsNone(created.data["data"]["email"])
        self.assertFalse(created.data["data"]["email_sent"])
        token = created.data["data"]["link"].rsplit("/", 1)[-1]
        completion = self.client.post(f"/api/v1/invites/{token}/complete", {"full_name": "Gestora Nueva", "password": "local-test-password"}, format="json")
        self.assertEqual(completion.status_code, 400)
        self.assertIn("email", completion.data)

    def test_invitation_email_must_be_unique_across_accounts_and_pending_invites(self):
        self.client.force_authenticate(self.admin)
        existing = self.client.post("/api/v1/admin/manager-invite-links", {"placeholder_name": "Duplicada", "email": self.admin.email}, format="json")
        self.assertEqual(existing.status_code, 400)
        created = self.client.post("/api/v1/admin/manager-invite-links", {"placeholder_name": "Gestora", "email": "new@example.test"}, format="json")
        self.assertEqual(created.status_code, 201)
        manager = User.objects.create_user(email="manager@example.test", password="local-test-password", full_name="Gestor", role=User.Role.MANAGER, parent_user=self.admin, email_verified=True)
        self.client.force_authenticate(manager)
        duplicate = self.client.post("/api/v1/capturadores/invite-links", {"placeholder_name": "Capturador", "email": "NEW@example.test"}, format="json")
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("email", duplicate.data)

    def test_invitation_identifier_must_be_unique_across_roles(self):
        self.client.force_authenticate(self.admin)
        first = self.client.post("/api/v1/admin/manager-invite-links", {"placeholder_name": "Zona Norte"}, format="json")
        self.assertEqual(first.status_code, 201)
        manager = User.objects.create_user(email="manager@example.test", password="local-test-password", full_name="Gestor", role=User.Role.MANAGER, parent_user=self.admin, email_verified=True)
        self.client.force_authenticate(manager)
        duplicate = self.client.post("/api/v1/capturadores/invite-links", {"placeholder_name": "  zona   norte  "}, format="json")
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("placeholder_name", duplicate.data)

    def test_manager_invitation_can_be_completed(self):
        token = "manager-invitation-once"
        Invitation.objects.create(kind=Invitation.Kind.MANAGER, token_hash=hashlib.sha256(token.encode()).hexdigest(), admin=self.admin, placeholder_name="Gestora nueva", recipient_email="gestora@example.test")
        response = self.client.post(f"/api/v1/invites/{token}/complete", {"full_name": "Gestora Nueva", "email": "gestora@example.test", "password": "local-test-password"}, format="json")
        self.assertEqual(response.status_code, 201)
        account = User.objects.get(email="gestora@example.test")
        self.assertEqual(account.role, User.Role.MANAGER)
        self.assertTrue(account.email_verified)
        self.assertIsNotNone(account.email_verified_at)
        self.assertEqual(Invitation.objects.get(token_hash=hashlib.sha256(token.encode()).hexdigest()).status, Invitation.Status.USED)
