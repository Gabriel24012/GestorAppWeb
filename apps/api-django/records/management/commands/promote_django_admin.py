from django.core.management.base import BaseCommand, CommandError

from records.models import User


class Command(BaseCommand):
    help = "Concede acceso a /django-admin/ a una cuenta existente con rol administrador."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        user = User.objects.filter(email__iexact=email, role=User.Role.ADMIN).first()
        if not user:
            raise CommandError("No existe una cuenta con rol administrador para ese correo.")
        user.is_active = True
        user.is_staff = True
        user.is_superuser = True
        user.save(update_fields=["is_active", "is_staff", "is_superuser", "updated_at"])
        self.stdout.write(self.style.SUCCESS(f"Acceso a Django Admin concedido a {user.email}."))
