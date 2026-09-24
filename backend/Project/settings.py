"""
Django settings for Project project.

Installed Django version: 5.2.x (NOT 6.1)

NOTE ON EMAIL CONFIGURATION
════════════════════════════
This project was originally documented as targeting Django 6.1's MAILERS system.
The installed version is Django 5.2, which uses the classic EMAIL_BACKEND /
EMAIL_HOST / EMAIL_PORT / EMAIL_HOST_USER / EMAIL_HOST_PASSWORD / EMAIL_USE_TLS
settings.  Django 6.1's MAILERS dict is NOT supported in 5.2 — it is silently
ignored, causing send_mail() to fall back to the SMTP backend unconditionally.

All email configuration therefore uses the standard Django 5.2 EMAIL_* settings.
The custom MAILERS variable in this file is used ONLY by our own
email_config_service.py — it is NOT read by Django's mail machinery.

Environment variables (use MAILER_* prefix to avoid confusion with legacy EMAIL_*):
  MAILER_BACKEND    Email backend class path
                    dev default:  django.core.mail.backends.console.EmailBackend
                    production:   django.core.mail.backends.smtp.EmailBackend
  MAILER_HOST       SMTP hostname       (default: localhost)
  MAILER_PORT       SMTP port           (default: 587)
  MAILER_USE_TLS    true/false          (default: true)
  MAILER_USE_SSL    true/false          (default: false)
  MAILER_USERNAME   SMTP login          (default: "")
  MAILER_PASSWORD   SMTP password       (default: "")
  MAILER_TIMEOUT    connection timeout  (default: 30)
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')


SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-local-development-only')
DEBUG = os.environ.get('DJANGO_DEBUG', 'true').lower() == 'true'

ALLOWED_HOSTS = [host.strip() for host in os.environ.get(
    'DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1'
).split(',') if host.strip()]

ALLOWED_REGISTRATION_DOMAINS = tuple(
    domain.strip().lower() for domain in os.environ.get(
        'ALLOWED_REGISTRATION_DOMAINS', 'iic.edu.np'
    ).split(',') if domain.strip()
)
GOOGLE_OAUTH_CLIENT_ID = os.environ.get('GOOGLE_OAUTH_CLIENT_ID', '')


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'helpdesk',
    'drf_spectacular',
    'drf_spectacular_sidecar',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'Project.middleware.MediaCoopMiddleware',
]

X_FRAME_OPTIONS = 'SAMEORIGIN'
ROOT_URLCONF = 'Project.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'Project.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kathmandu'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
DATA_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_THROTTLE_RATES': {
        'auth_login': '10/minute',
        'auth_register': '5/hour',
        'auth_google': '10/minute',
    },
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

AUTHENTICATION_BACKENDS = [
    'helpdesk.authentication.EmailOrUsernameBackend',
]

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.environ.get(
    'CSRF_TRUSTED_ORIGINS', 'http://localhost:3000'
).split(',') if origin.strip()]


# ── Email configuration (Django 5.2 standard EMAIL_* settings) ───────────────
#
# Django 5.2 uses EMAIL_BACKEND, EMAIL_HOST, EMAIL_PORT, etc.
# These are read directly by send_mail(), get_connection(), etc.
#
# We use MAILER_* env var names to keep naming consistent with the
# EmailConfiguration admin model, then map them to the EMAIL_* settings
# that Django 5.2 actually reads.
#
# Backend-aware defaults
# ──────────────────────
# Non-SMTP backends (console, dummy, filebased, locmem) do NOT need host/
# port/credentials — Django only reads EMAIL_HOST etc. when using smtp.EmailBackend.

def _bool(val: str, default: bool) -> bool:
    if not val:
        return default
    return val.strip().lower() in ('1', 'true', 'yes')


_SMTP_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'

EMAIL_BACKEND  = os.environ.get('MAILER_BACKEND', 'django.core.mail.backends.console.EmailBackend')
EMAIL_HOST     = os.environ.get('MAILER_HOST', 'localhost')
EMAIL_PORT     = int(os.environ.get('MAILER_PORT', '587'))
EMAIL_USE_TLS  = _bool(os.environ.get('MAILER_USE_TLS', ''), True)
EMAIL_USE_SSL  = _bool(os.environ.get('MAILER_USE_SSL', ''), False)
EMAIL_HOST_USER    = os.environ.get('MAILER_USERNAME', '')
EMAIL_HOST_PASSWORD = os.environ.get('MAILER_PASSWORD', '')  # from env, never hardcoded
EMAIL_TIMEOUT  = int(os.environ.get('MAILER_TIMEOUT', '30'))

# ── MAILERS helper dict — used ONLY by our email_config_service.py ───────────
# Django 5.2 does NOT read this. It exists so that email_config_service can
# represent the effective configuration in a structured way and so that the
# EmailConfiguration model's to_mailer_dict() output format is consistent.
# apply_mailers_override() updates BOTH this dict AND the EMAIL_* settings.
if EMAIL_BACKEND == _SMTP_BACKEND:
    _smtp_options: dict = {
        'host':    EMAIL_HOST,
        'port':    EMAIL_PORT,
        'use_tls': EMAIL_USE_TLS,
        'use_ssl': EMAIL_USE_SSL,
        'timeout': EMAIL_TIMEOUT,
    }
    if EMAIL_HOST_USER:
        _smtp_options['username'] = EMAIL_HOST_USER
    if EMAIL_HOST_PASSWORD:
        _smtp_options['password'] = EMAIL_HOST_PASSWORD
else:
    # Console / dummy / locmem / filebased — no SMTP options
    _smtp_options = {}

MAILERS = {
    'default': {
        'BACKEND': EMAIL_BACKEND,
        'OPTIONS': _smtp_options,
    },
}

# ── Verification settings ─────────────────────────────────────────────────────
VERIFICATION_FROM_EMAIL         = os.environ.get('VERIFICATION_FROM_EMAIL', 'noreply@iic.edu.np')
VERIFICATION_TOKEN_EXPIRY_HOURS = int(os.environ.get('VERIFICATION_TOKEN_EXPIRY_HOURS', '24'))
EMAIL_VERIFICATION_ENABLED      = _bool(os.environ.get('EMAIL_VERIFICATION_ENABLED', ''), True)

# ── Misc ──────────────────────────────────────────────────────────────────────
HELPDESK_INTERN_SCOPE_SLUGS = [
    'device-support',
    'wifi-issue',
    'general-support',
]

HELPDESK_URL = os.environ.get('HELPDESK_URL', 'http://localhost:3000')

SPECTACULAR_SETTINGS = {
    'TITLE': 'IIC-IT Help Desk Application',
    'DESCRIPTION': 'API documentation generated automatically',
    'VERSION': '0.0.1',
    'SERVE_INCLUDE_SCHEMA': False,
    'SWAGGER_UI_DIST': 'SIDECAR',
    'SWAGGER_UI_FAVICON_HREF': 'SIDECAR',
    'REDOC_DIST': 'SIDECAR',
}
