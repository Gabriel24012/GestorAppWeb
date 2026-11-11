from django.http import JsonResponse
from django.urls import path


urlpatterns = [path("", lambda request: JsonResponse({"status": "ok"}))]
