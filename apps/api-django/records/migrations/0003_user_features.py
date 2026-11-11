import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("records", "0002_goal_one_active_goal_per_capturer_period_and_more")]

    operations = [
        migrations.AddField("user", "profile_image", models.URLField(blank=True, max_length=1000)),
        migrations.AddField("user", "email_verified", models.BooleanField(default=False)),
        migrations.AddField("user", "email_verified_at", models.DateTimeField(blank=True, null=True)),
        migrations.CreateModel(
            name="EmailVerification",
            fields=[("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")), ("token_hash", models.CharField(max_length=64, unique=True)), ("expires_at", models.DateTimeField()), ("created_at", models.DateTimeField(default=django.utils.timezone.now)), ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="email_verifications", to=settings.AUTH_USER_MODEL))],
        ),
        migrations.CreateModel(
            name="UserPreference",
            fields=[("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")), ("theme", models.CharField(choices=[("light", "Claro"), ("dark", "Oscuro")], default="light", max_length=8)), ("font_size", models.CharField(choices=[("small", "Pequeño"), ("normal", "Normal"), ("large", "Grande")], default="normal", max_length=8)), ("language", models.CharField(choices=[("es", "Español"), ("en", "English")], default="es", max_length=2)), ("updated_at", models.DateTimeField(auto_now=True)), ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="preferences", to=settings.AUTH_USER_MODEL))],
        ),
    ]
