from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailOrUsernameBackend(ModelBackend):
    """Authenticate with either a username or an email address."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        identifier = (username or kwargs.get('email') or '').strip()
        if not identifier or password is None:
            return None

        User = get_user_model()
        lookup = {'email__iexact': identifier} if '@' in identifier else {'username__iexact': identifier}
        try:
            user = User.objects.get(**lookup)
        except (User.DoesNotExist, User.MultipleObjectsReturned):
            User().set_password(password)
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
