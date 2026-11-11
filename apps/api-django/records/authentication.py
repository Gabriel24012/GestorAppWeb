from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class VerifiedJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result and not result[0].email_verified:
            raise AuthenticationFailed("email_not_verified", code="email_not_verified")
        return result
