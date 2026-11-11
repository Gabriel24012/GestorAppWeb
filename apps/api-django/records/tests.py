import hashlib
from datetime import date, timedelta

from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import CaptureSession, EmailVerification, Invitation, Record, User


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
