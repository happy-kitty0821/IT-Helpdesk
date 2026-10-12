"""
Migration 0041 — fix the account_recovery EmailTemplate state.

The seeded template from 0040 created an "Account Recovery Request Received"
template for event_type=account_recovery that should NOT exist — account
recovery tickets have a dedicated credentials email, not a generic
"request received" message.

Additionally the correct credentials template ("Account Recovery — Credentials
Email") was seeded as inactive with use_file_fallback=True.

This migration:
  1. Deletes the wrong "Account Recovery Request Received" template.
  2. Activates the correct "Account Recovery — Credentials Email" template
     and turns off use_file_fallback so the DB template body is used.
"""

from django.db import migrations


def fix_account_recovery_templates(apps, schema_editor):
    EmailTemplate = apps.get_model('helpdesk', 'EmailTemplate')

    # Remove the wrong template (generic request-received for account recovery)
    EmailTemplate.objects.filter(
        event_type='account_recovery',
        name='Account Recovery Request Received',
    ).delete()

    # Also remove any other request-received style templates for this event
    # (guard against duplicates with slightly different names)
    EmailTemplate.objects.filter(
        event_type='account_recovery',
        name__icontains='request received',
    ).delete()

    # Remove duplicate shorter-named template if it exists alongside the
    # full 'Credentials Email' version (both were active after 0040).
    # Keep only the one whose name ends with 'Credentials Email'.
    EmailTemplate.objects.filter(
        event_type='account_recovery',
    ).exclude(
        name__icontains='credentials email',
    ).exclude(
        name__icontains='request received',  # already handled above
    ).delete()

    # Activate the correct credentials template and stop using the file fallback
    # so the DB body (with the credentials table) is used instead of the file.
    EmailTemplate.objects.filter(
        event_type='account_recovery',
        name='Account Recovery — Credentials Email',
    ).update(
        is_active=True,
        use_file_fallback=False,
    )

    # If somehow neither named template exists (fresh install after 0040 was
    # already fixed), create the correct one from scratch.
    if not EmailTemplate.objects.filter(event_type='account_recovery').exists():
        EmailTemplate.objects.create(
            event_type='account_recovery',
            name='Account Recovery — Credentials Email',
            subject_template='Your IIC college account recovery credentials — {{ticket_reference}}',
            body_html_template=(
                '<p>Hi {{name}},</p>'
                '<p>Your account recovery request has been reviewed and verified '
                'by the IIC IT team. Below are your credentials.</p>'
                '<table style="border-collapse:collapse;width:100%;margin:16px 0;">'
                '<tr style="background:#f8fafc;">'
                '<td style="padding:10px 14px;font-weight:700;border:1px solid #e2e8f0;width:40%;">College email</td>'
                '<td style="padding:10px 14px;border:1px solid #e2e8f0;">{{college_email}}</td>'
                '</tr>'
                '<tr style="background:#f0fdf4;">'
                '<td style="padding:10px 14px;font-weight:700;border:1px solid #e2e8f0;">Backup code</td>'
                '<td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;'
                'font-size:1.1rem;letter-spacing:.15em;">{{backup_code}}</td>'
                '</tr>'
                '<tr style="background:#eff6ff;">'
                '<td style="padding:10px 14px;font-weight:700;border:1px solid #e2e8f0;">Temporary password</td>'
                '<td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;">{{temp_password}}</td>'
                '</tr>'
                '</table>'
                '<p><strong>Please change your password immediately after signing in. '
                'These credentials are for your use only — do not share them.</strong></p>'
                '<p>If you did not request this, contact us at '
                '<a href="mailto:{{support_email}}">{{support_email}}</a> immediately.</p>'
                '<p>— IIC IT &amp; NOC Department</p>'
            ),
            is_active=True,
            use_file_fallback=False,
        )


def reverse_fix(apps, schema_editor):
    # Reversal is a no-op — we don't want to re-create the wrong template.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('helpdesk', '0040_seed_email_templates'),
    ]

    operations = [
        migrations.RunPython(fix_account_recovery_templates, reverse_code=reverse_fix),
    ]
