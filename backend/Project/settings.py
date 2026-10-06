"""
Django settings for Project project.

Django 6.1 — uses MAILERS for all email configuration.
MAILERS and any EMAIL_* setting cannot coexist (ImproperlyConfigured).
This file sets ONLY MAILERS; no EMAIL_* settings are present anywhere.

Environment variables (MAILER_* prefix):
  MAILER_BACKEND    Backend class (default: console.EmailBackend)
  MAILER_HOST       SMTP hostname       (default: localhost)
  MAILER_PORT       SMTP port           (default: 587)
  MAILER_USE_TLS    true/false          (default: true)
  MAILER_USE_SSL    true/false          (default: false)
  MAILER_USERNAME   SMTP login          (default: "")
  MAILER_PASSWORD   SMTP password       (default: "")
  MAILER_TIMEOUT    timeout seconds     (default: 30)
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-local-development-only')
DEBUG = os.environ.get('DJANGO_DEBUG', 'true').lower() == 'true'

ALLOWED_HOSTS = [h.strip() for h in os.environ.get(
    'DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1'
).split(',') if h.strip()]

ALLOWED_REGISTRATION_DOMAINS = tuple(
    d.strip().lower() for d in os.environ.get(
        'ALLOWED_REGISTRATION_DOMAINS', 'iic.edu.np'
    ).split(',') if d.strip()
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
    'whitenoise.middleware.WhiteNoiseMiddleware',
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

# Optional: compresses files and caches them
STORAGES = {
    # 1. Required for media uploads / models.FileField
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    # 2. WhiteNoise storage without strict manifest requirement during tests
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
    },
}
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
# Allow up to 25 GB file uploads (software installers).  Files larger than
# FILE_UPLOAD_MAX_MEMORY_SIZE are streamed to temporary files on disk, so
# memory usage stays low even for very large uploads.
DATA_UPLOAD_MAX_MEMORY_SIZE = 26 * 1024 * 1024 * 1024  # 26 GB (25 GB + overhead)
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024  # 5 MB — above this, files stream to disk

# ── Protected file delivery ────────────────────────────────────────────────────
# Set to True in production when Nginx is configured with an internal
# /protected-media/ alias (X-Accel-Redirect). Django sends only the header;
# Nginx transfers the bytes — zero Django worker overhead for large files.
#   nginx.conf snippet:
#     location /protected-media/ {
#         internal;
#         alias /var/www/iic-app/backend/media/;
#     }
MEDIA_ACCEL_REDIRECT = os.environ.get('MEDIA_ACCEL_REDIRECT', 'false').lower() == 'true'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'EXCEPTION_HANDLER': 'helpdesk.throttling.custom_exception_handler',
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
CSRF_TRUSTED_ORIGINS = [o.strip() for o in os.environ.get(
    'CSRF_TRUSTED_ORIGINS', 'http://localhost:3000'
).split(',') if o.strip()]


# ── Email — Django 6.1 MAILERS (the ONLY valid approach when MAILERS is used) ─
#
# CRITICAL: Do NOT set EMAIL_BACKEND, EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER,
# EMAIL_HOST_PASSWORD, EMAIL_USE_TLS, EMAIL_USE_SSL, or EMAIL_TIMEOUT here.
# Django 6.1 raises ImproperlyConfigured if any EMAIL_* setting coexists with
# MAILERS. All transport config belongs inside MAILERS["default"] only.
#
# Non-SMTP backends (console, dummy, locmem, filebased) must receive an empty
# OPTIONS dict — passing SMTP kwargs to them raises InvalidMailer in Django 6.1.

def _bool(val: str, default: bool) -> bool:
    if not val:
        return default
    return val.strip().lower() in ('1', 'true', 'yes')


_SMTP_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'

_mailer_backend  = os.environ.get('MAILER_BACKEND', 'django.core.mail.backends.console.EmailBackend')
_mailer_host     = os.environ.get('MAILER_HOST', 'localhost')
_mailer_port     = int(os.environ.get('MAILER_PORT', '587'))
_mailer_use_tls  = _bool(os.environ.get('MAILER_USE_TLS', ''), True)
_mailer_use_ssl  = _bool(os.environ.get('MAILER_USE_SSL', ''), False)
_mailer_username = os.environ.get('MAILER_USERNAME', '')
_mailer_password = os.environ.get('MAILER_PASSWORD', '')
_mailer_timeout  = int(os.environ.get('MAILER_TIMEOUT', '30'))

# Only SMTP backends accept these OPTIONS; all others get an empty dict
if _mailer_backend == _SMTP_BACKEND:
    _mailer_options: dict = {
        'host':    _mailer_host,
        'port':    _mailer_port,
        'use_tls': _mailer_use_tls,
        'use_ssl': _mailer_use_ssl,
        'timeout': _mailer_timeout,
    }
    if _mailer_username:
        _mailer_options['username'] = _mailer_username
    if _mailer_password:
        _mailer_options['password'] = _mailer_password  # read from env, never hardcoded
else:
    _mailer_options = {}  # console / dummy / locmem / filebased — no SMTP options

MAILERS = {
    'default': {
        'BACKEND': _mailer_backend,
        'OPTIONS': _mailer_options,
    },
}

# ── Verification settings (not email transport — safe alongside MAILERS) ──────
VERIFICATION_FROM_EMAIL         = os.environ.get('VERIFICATION_FROM_EMAIL', 'noreply@iic.edu.np')
VERIFICATION_TOKEN_EXPIRY_HOURS = int(os.environ.get('VERIFICATION_TOKEN_EXPIRY_HOURS', '24'))
EMAIL_VERIFICATION_ENABLED      = _bool(os.environ.get('EMAIL_VERIFICATION_ENABLED', ''), True)
PASSWORD_RESET_TOKEN_EXPIRY_HOURS = int(os.environ.get('PASSWORD_RESET_TOKEN_EXPIRY_HOURS', '24'))

# ── Misc ───────────────────────────────────────────────────────────────────────
HELPDESK_INTERN_SCOPE_SLUGS = ['device-support', 'wifi-issue', 'general-support']
HELPDESK_URL = os.environ.get('HELPDESK_URL', 'http://localhost:3000')

SPECTACULAR_SETTINGS = {
    'TITLE': 'IIC IT-NOC Help Desk Application',
    'DESCRIPTION': 'API documentation generated automatically',
    'VERSION': '0.0.1',
    'SERVE_INCLUDE_SCHEMA': False,
    'SWAGGER_UI_DIST': 'SIDECAR',
    'SWAGGER_UI_FAVICON_HREF': 'SIDECAR',
    'REDOC_DIST': 'SIDECAR',
}
