from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from records.models import User
from records.views import send_verification_email


class Command(BaseCommand):
    help = "Crea o eleva el usuario administrador inicial. La contraseña se solicita sin mostrarla."

    def add_arguments(self, parser):
        parser.add_argument("--email", default="admin@gmail.com")
        parser.add_argument("--name", default="Admin")

    @transaction.atomic
    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        user = User.objects.filter(email=email).first()
        if User.objects.filter(role=User.Role.ADMIN).exclude(pk=getattr(user, "pk", None)).exists():
            raise CommandError("Ya existe un administrador. Usa la recuperación de contraseña normal.")
        password = getpass("Contraseña nueva (mínimo 8 caracteres): ")
        validate_password(password, user=user)
        if user is None:
            user = User(email=email, full_name=options["name"].strip(), role=User.Role.ADMIN, is_active=True, is_staff=True, onboarding_completed_at=__import__("django.utils.timezone", fromlist=["now"]).now())
        else:
            user.role = User.Role.ADMIN
            user.parent_user = None
            user.is_active = True
            user.is_staff = True
        user.set_password(password)
        user.save()
        email_sent = send_verification_email(user)
        self.stdout.write(self.style.SUCCESS(f"Administrador listo: {email}. Correo de verificación { 'enviado' if email_sent else 'no enviado; configura RESEND_API_KEY y solicita reenvío al iniciar sesión' }."))
