import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from .models import GuideArticle, RoleGrant, SoftwareResource


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

    @override_settings(GOOGLE_OAUTH_CLIENT_ID='')
    def test_google_login_requires_configuration(self):
        response = self.client.post('/api/v1/auth/google/', {'credential': 'token'})
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)


class AdminContentTests(APITestCase):
    def setUp(self):
        self.temp_media = tempfile.TemporaryDirectory()
        self.media_override = override_settings(MEDIA_ROOT=self.temp_media.name)
        self.media_override.enable()
        User = get_user_model()
        self.superuser = User.objects.create_superuser('admin', 'admin@iic.edu.np', 'Strong-Test-Password-2026!')
        # Grant the administrator role so IsAdministrator / IsContentEditor checks pass.
        RoleGrant.objects.create(user=self.superuser, role='administrator')
        self.member = User.objects.create_user('member', 'member@iic.edu.np', 'Strong-Test-Password-2026!')

    def tearDown(self):
        self.media_override.disable()
        self.temp_media.cleanup()

    def pdf(self, name='guide.pdf'):
        return SimpleUploadedFile(name, b'%PDF-1.4\n%%EOF', content_type='application/pdf')

    def test_regular_user_cannot_access_admin_content(self):
        self.client.force_authenticate(self.member)
        response = self.client.get('/api/v1/admin/guides/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_superuser_can_create_and_publish_guide(self):
        self.client.force_authenticate(self.superuser)
        response = self.client.post('/api/v1/admin/guides/', {
            'title': 'Connect to campus Wi-Fi',
            'slug': 'connect-campus-wifi',
            'summary': 'Steps for joining the IIC student wireless network.',
            'pdf_file': self.pdf(),
            'audience': 'all',
            'tags': '["wifi", "network"]',
            'status': 'published',
        }, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(GuideArticle.objects.get().created_by, self.superuser)
        self.client.logout()
        public = self.client.get('/api/v1/guides/')
        self.assertEqual(len(public.data), 1)  # audience='all' is visible to unauthenticated visitors

    def test_guide_requires_a_real_pdf(self):
        self.client.force_authenticate(self.superuser)
        response = self.client.post('/api/v1/admin/guides/', {
            'title': 'Invalid guide', 'slug': 'invalid-guide', 'summary': 'Not a PDF',
            'pdf_file': SimpleUploadedFile('guide.pdf', b'not-pdf', content_type='application/pdf'),
            'audience': 'public', 'tags': '[]', 'status': 'published',
        }, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_public_guide_exposes_pdf_url(self):
        self.client.force_authenticate(self.superuser)
        created = self.client.post('/api/v1/admin/guides/', {
            'title': 'Public guide', 'slug': 'public-guide', 'summary': 'Downloadable help guide',
            'pdf_file': self.pdf('public-guide.pdf'), 'audience': 'public',
            'tags': '["help"]', 'status': 'published',
        }, format='multipart')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.client.force_authenticate(user=None)
        response = self.client.get('/api/v1/guides/')
        self.assertEqual(response.data[0]['pdf_name'], 'public-guide.pdf')
        self.assertTrue(response.data[0]['pdf_url'].endswith('.pdf'))

    def test_superuser_can_manage_other_users_but_not_demote_self(self):
        self.client.force_authenticate(self.superuser)
        updated = self.client.patch(f'/api/v1/admin/users/{self.member.id}/', {
            'first_name': 'Support', 'is_staff': True,
        }, format='json')
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_staff)
        self.assertEqual(self.member.first_name, 'Support')

        self_update = self.client.patch(f'/api/v1/admin/users/{self.superuser.id}/', {
            'is_superuser': False,
        }, format='json')
        self.assertEqual(self_update.status_code, status.HTTP_400_BAD_REQUEST)

    def test_public_software_only_lists_active_items(self):
        SoftwareResource.objects.create(name='Active Tool', slug='active-tool', description='Available tool', platforms=['Web'], audience='public', status='active')
        SoftwareResource.objects.create(name='Draft Tool', slug='draft-tool', description='Hidden tool', platforms=['Windows'], status='draft')
        self.client.force_authenticate(user=None)
        response = self.client.get('/api/v1/software/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item['slug'] for item in response.data], ['active-tool'])



class NotificationTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser('notif_admin', 'notif@iic.edu.np', 'Admin-Test-Pass-2026!')
        RoleGrant.objects.create(user=self.admin, role='administrator')

    def test_create_discord_channel(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post('/api/v1/admin/notifications/channels/', {
            'type': 'discord', 'name': 'Test Discord',
            'config': {'webhook_url': 'https://discord.com/api/webhooks/test/test'},
            'is_active': True,
        }, format='json')
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data['name'], 'Test Discord')

    def test_get_channel_masks_secrets(self):
        from helpdesk.models import NotificationChannel
        self.client.force_authenticate(self.admin)
        ch = NotificationChannel.objects.create(
            type='discord', name='Secret Discord',
            config={'webhook_url': 'https://real-webhook-url.com/secret'}
        )
        r = self.client.get(f'/api/v1/admin/notifications/channels/{ch.id}/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['config_display']['webhook_url'], '••••••••')

    def test_patch_with_mask_preserves_secret(self):
        from helpdesk.models import NotificationChannel
        self.client.force_authenticate(self.admin)
        ch = NotificationChannel.objects.create(
            type='discord', name='Preserve Discord',
            config={'webhook_url': 'https://real-url.com/secret'}
        )
        r = self.client.patch(f'/api/v1/admin/notifications/channels/{ch.id}/', {
            'config': {'webhook_url': '••••••••'},
        }, format='json')
        self.assertEqual(r.status_code, 200)
        ch.refresh_from_db()
        self.assertEqual(ch.config['webhook_url'], 'https://real-url.com/secret')

    def test_email_templates_seeded(self):
        from helpdesk.models import EmailTemplate
        self.client.force_authenticate(self.admin)
        r = self.client.get('/api/v1/admin/notifications/templates/')
        self.assertEqual(r.status_code, 200)
        event_types = [t['event_type'] for t in r.data]
        self.assertIn('ticket_submitted', event_types)
        self.assertIn('account_recovery', event_types)

    def test_non_admin_cannot_access_channels(self):
        User = get_user_model()
        student = User.objects.create_user('student_notif', 'st@iic.edu.np', 'Pass-2026!')
        # Signal already creates a student grant — use get_or_create to be safe
        RoleGrant.objects.get_or_create(user=student, role='student')
        self.client.force_authenticate(student)
        r = self.client.get('/api/v1/admin/notifications/channels/')
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_notification_log_created_on_ticket_creation(self):
        from helpdesk.models import NotificationChannel, NotificationLog, ServiceCategory
        # Create a discord channel
        NotificationChannel.objects.create(
            type='discord', name='Log Test Discord', is_active=True,
            config={'webhook_url': 'https://invalid-url-for-test.local/webhook'}
        )
        # Use a category with no required form fields to avoid validation errors
        cat, _ = ServiceCategory.objects.get_or_create(
            slug='test-notif-cat',
            defaults={
                'name': 'Test Notification Category',
                'summary': 'Used by notification tests',
                'audience': 'all',
                'form_schema': [],
            }
        )
        self.client.force_authenticate(self.admin)
        r = self.client.post('/api/v1/tickets/', {
            'category': cat.id,
            'subject': 'Notification log test ticket',
            'description': 'Testing that notification log is created on ticket save.',
            'priority': 'p3',
            'extra_fields': {},
        }, format='json')
        self.assertEqual(r.status_code, 201)
        # A log entry should exist (status=failed is fine since URL is fake)
        self.assertTrue(NotificationLog.objects.filter(event_type='ticket_submitted').exists())
