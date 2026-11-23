import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("records", "0004_verify_email_bound_invitation_accounts"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProfileFavorite",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="profile_favorites", to=settings.AUTH_USER_MODEL)),
                ("target", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="favorited_by", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="RecordFavorite",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="record_favorites", to=settings.AUTH_USER_MODEL)),
                ("record", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="favorited_by", to="records.record")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="profilefavorite",
            constraint=models.UniqueConstraint(fields=("owner", "target"), name="unique_profile_favorite"),
        ),
        migrations.AddConstraint(
            model_name="recordfavorite",
            constraint=models.UniqueConstraint(fields=("owner", "record"), name="unique_record_favorite"),
        ),
    ]
