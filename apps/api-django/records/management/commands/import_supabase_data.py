import os

import psycopg
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from psycopg.rows import dict_row

from records.models import AuditEvent, CaptureSession, Goal, Invitation, Record, RecordVersion, User


def rows(cursor, table):
    cursor.execute(f'SELECT * FROM public."{table}"')
    return cursor.fetchall()


class Command(BaseCommand):
    help = "Importa una sola vez los datos locales Supabase; crea usuarios sin contraseña y conserva IDs/relaciones."

    def add_arguments(self, parser):
        parser.add_argument("--source", default=os.environ.get("SUPABASE_SOURCE_DATABASE_URL"))
        parser.add_argument("--dry-run", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        source = options.get("source")
        if not source:
            raise CommandError("Define SUPABASE_SOURCE_DATABASE_URL o pasa --source.")
        try:
            connection = psycopg.connect(source, row_factory=dict_row)
        except Exception as exc:
            raise CommandError(f"No se pudo conectar a la base Supabase local: {exc}") from exc
        with connection, connection.cursor() as cursor:
            source_data = {table: rows(cursor, table) for table in ("profiles", "capture_sessions", "records", "record_versions", "capturer_goals", "manager_invites", "capturer_invites", "audit_events")}
        if options["dry_run"]:
            for table, items in source_data.items():
                self.stdout.write(f"{table}: {len(items)}")
            return

        counts = {}
        role_order = {User.Role.ADMIN: 0, User.Role.MANAGER: 1, User.Role.CAPTURER: 2}
        for item in sorted(source_data["profiles"], key=lambda row: role_order.get(row["role"], 3)):
            user, created = User.objects.get_or_create(id=item["id"], defaults={
                "email": item["email"], "full_name": item["full_name"], "role": item["role"],
                "parent_user_id": item.get("parent_user_id"), "is_active": item["is_active"],
                "onboarding_completed_at": item.get("onboarding_completed_at"),
                "created_at": item["created_at"], "updated_at": item["updated_at"],
            })
            if created:
                user.set_unusable_password()
                user.save(update_fields=["password"])
            else:
                for key, value in (("email", item["email"]), ("full_name", item["full_name"]), ("role", item["role"]), ("parent_user_id", item.get("parent_user_id")), ("is_active", item["is_active"]), ("onboarding_completed_at", item.get("onboarding_completed_at"))):
                    setattr(user, key, value)
                user.save()
        counts["profiles"] = len(source_data["profiles"])

        for item in source_data["capture_sessions"]:
            CaptureSession.objects.update_or_create(id=item["id"], defaults={key: item.get(key) for key in ("capturer_id", "manager_id", "leadership_name", "section_code", "network_responsible", "status", "created_at", "updated_at")})
        counts["capture_sessions"] = len(source_data["capture_sessions"])

        record_fields = ("capture_session_id", "capturer_id", "manager_id", "leadership_name", "section_code", "network_responsible", "first_name", "paternal_surname", "maternal_surname", "address", "exterior_number", "neighborhood", "district", "postal_code", "birth_date", "phone", "electoral_key", "observations", "status", "created_at", "updated_at")
        for item in source_data["records"]:
            Record.objects.update_or_create(id=item["id"], defaults={key: item.get(key) for key in record_fields})
        counts["records"] = len(source_data["records"])

        for item in source_data["record_versions"]:
            RecordVersion.objects.update_or_create(record_id=item["record_id"], version_number=item["version_number"], defaults={"id": item["id"], "changed_by_id": item.get("changed_by"), "changed_at": item["changed_at"], "snapshot": item["snapshot"]})
        counts["record_versions"] = len(source_data["record_versions"])

        for item in source_data["capturer_goals"]:
            Goal.objects.update_or_create(id=item["id"], defaults={key: item.get(source) for key, source in {
                "manager_id": "manager_id", "capturer_id": "capturer_id", "period_type": "period_type", "target_count": "target_count", "starts_on": "starts_on", "ends_on": "ends_on", "status": "status", "archived_at": "archived_at", "created_by_role": "created_by_role", "created_at": "created_at", "updated_at": "updated_at",
            }.items()})
        counts["capturer_goals"] = len(source_data["capturer_goals"])

        for kind, table in ((Invitation.Kind.MANAGER, "manager_invites"), (Invitation.Kind.CAPTURER, "capturer_invites")):
            for item in source_data[table]:
                Invitation.objects.update_or_create(id=item["id"], defaults={
                    "kind": kind, "token_hash": item["token_hash"], "admin_id": item.get("admin_id"), "manager_id": item.get("manager_id"),
                    "placeholder_name": item["placeholder_name"], "recipient_email": item.get("recipient_email"), "status": item["status"],
                    "used_by_id": item.get("used_by_user_id"), "created_at": item["created_at"], "used_at": item.get("used_at"),
                })
        counts["invitations"] = len(source_data["manager_invites"]) + len(source_data["capturer_invites"])

        for item in source_data["audit_events"]:
            AuditEvent.objects.update_or_create(id=item["id"], defaults={"actor_id": item.get("actor_id"), "entity": item["entity"], "entity_id": item.get("entity_id"), "action": item["action"], "metadata": item.get("metadata") or {}, "created_at": item["created_at"]})
        counts["audit_events"] = len(source_data["audit_events"])
        from django.core.management.color import no_style
        from django.db import connection
        with connection.cursor() as target_cursor:
            for statement in connection.ops.sequence_reset_sql(no_style(), [RecordVersion, AuditEvent]):
                target_cursor.execute(statement)
        expected_ids = {
            "profiles": {str(item["id"]) for item in source_data["profiles"]},
            "capture_sessions": {str(item["id"]) for item in source_data["capture_sessions"]},
            "records": {str(item["id"]) for item in source_data["records"]},
            "record_versions": {str(item["id"]) for item in source_data["record_versions"]},
            "capturer_goals": {str(item["id"]) for item in source_data["capturer_goals"]},
            "invitations": {str(item["id"]) for table in ("manager_invites", "capturer_invites") for item in source_data[table]},
            "audit_events": {str(item["id"]) for item in source_data["audit_events"]},
        }
        target_ids = {
            "profiles": {str(value) for value in User.objects.values_list("id", flat=True)},
            "capture_sessions": {str(value) for value in CaptureSession.objects.values_list("id", flat=True)},
            "records": {str(value) for value in Record.objects.values_list("id", flat=True)},
            "record_versions": {str(value) for value in RecordVersion.objects.values_list("id", flat=True)},
            "capturer_goals": {str(value) for value in Goal.objects.values_list("id", flat=True)},
            "invitations": {str(value) for value in Invitation.objects.values_list("id", flat=True)},
            "audit_events": {str(value) for value in AuditEvent.objects.values_list("id", flat=True)},
        }
        mismatched = [name for name in expected_ids if target_ids[name] != expected_ids[name]]
        if mismatched:
            raise CommandError("La verificación posterior detectó IDs distintos en: " + ", ".join(mismatched) + ". Se revirtió la transacción.")
        verified_counts = {name: len(values) for name, values in expected_ids.items()}
        self.stdout.write(self.style.SUCCESS("Importación verificada (conteos e IDs): " + ", ".join(f"{key}={value}" for key, value in verified_counts.items())))
        self.stdout.write("Las cuentas importadas tienen contraseña sin definir; asigna contraseñas nuevas con bootstrap_admin para el administrador y el alta por invitación para las demás cuentas.")
