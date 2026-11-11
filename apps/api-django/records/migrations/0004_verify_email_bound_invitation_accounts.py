from django.db import migrations
from django.utils import timezone


def verify_accounts_created_from_bound_invites(apps, schema_editor):
    User = apps.get_model("records", "User")
    Invitation = apps.get_model("records", "Invitation")
    database = schema_editor.connection.alias
    accepted = Invitation.objects.using(database).filter(
        status="used", recipient_email__isnull=False, used_by__isnull=False
    ).values_list("used_by_id", "recipient_email", "used_by__email")
    now = timezone.now()
    verified_ids = {
        user_id
        for user_id, invited_email, account_email in accepted
        if invited_email.strip().lower() == account_email.strip().lower()
    }
    User.objects.using(database).filter(pk__in=verified_ids, email_verified=False).update(
        email_verified=True,
        email_verified_at=now,
    )


class Migration(migrations.Migration):
    dependencies = [("records", "0003_user_features")]

    operations = [migrations.RunPython(verify_accounts_created_from_bound_invites, migrations.RunPython.noop)]
