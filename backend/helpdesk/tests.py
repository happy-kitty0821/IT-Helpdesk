from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase


@override_settings(ALLOWED_REGISTRATION_DOMAINS=('iic.edu.np',))
class AuthenticationTests(APITestCase):
    def registration_payload(self, **overrides):
        data = {
            'username': 'student.one',
            'email': 'student.one@iic.edu.np',
            'first_name': 'Student',
            'last_name': 'One',
            'password': 'Safe-College-Password-2026!',
        }
        data.update(overrides)
        return data

    def test_registration_rejects_unapproved_domain(self):
        response = self.client.post('/api/v1/auth/register/', self.registration_payload(email='person@gmail.com'))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(get_user_model().objects.filter(email='person@gmail.com').exists())

    def test_registration_creates_session(self):
        response = self.client.post('/api/v1/auth/register/', self.registration_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        me = self.client.get('/api/v1/auth/me/')
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        self.assertEqual(me.data['email'], 'student.one@iic.edu.np')

    def test_login_accepts_username_and_email(self):
        user = get_user_model().objects.create_user(
            username='aayush.limbu', email='aayush.limbu@iic.edu.np', password='A-Strong-Test-Password-2026!'
        )
        for identifier in (user.username, user.email.upper()):
            self.client.logout()
            response = self.client.post('/api/v1/auth/login/', {
                'identifier': identifier,
                'password': 'A-Strong-Test-Password-2026!',
            })
            self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_google_login_requires_configuration(self):
        response = self.client.post('/api/v1/auth/google/', {'credential': 'token'})
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
