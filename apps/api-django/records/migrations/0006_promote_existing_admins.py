from django.db import migrations


def promote_existing_admins(apps, schema_editor):
    User = apps.get_model("records", "User")
    User.objects.filter(role="admin").update(is_active=True, is_staff=True, is_superuser=True)


class Migration(migrations.Migration):
    dependencies = [
        ("records", "0005_profilefavorite_recordfavorite"),
    ]

    operations = [
        migrations.RunPython(promote_existing_admins, migrations.RunPython.noop),
    ]
