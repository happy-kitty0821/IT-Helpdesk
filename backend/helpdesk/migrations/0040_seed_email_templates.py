"""
Migration 0040 — seed default EmailTemplate rows for every event type.

Each template is seeded with:
  • use_file_fallback = True   — the on-disk HTML file is used by default;
                                  admins can turn this off once they've
                                  customised the body to their liking.
  • is_active = True
  • A correct name and subject line per event type.
  • A minimal body that references the right variables — admins can expand
    these in Admin → Notifications → Templates.

The migration is idempotent: it uses get_or_create so re-running it on a
database that already has these rows does nothing.
"""

from django.db import migrations


TEMPLATES = [
    # (event_type, name, subject_template, body_html_template)
    (
        'ticket_submitted',
        'Ticket Submitted — Confirmation to Requester',
        'Your support ticket {{ticket_reference}} has been received',
        (
            '<p>Hi {{requester_name}},</p>'
            '<p>We\'ve received your support request and given it the reference '
            '<strong>{{ticket_reference}}</strong>.</p>'
            '<p>Subject: <em>{{ticket_subject}}</em><br>'
            'Category: {{category_name}}</p>'
            '<p>You can check the status of your ticket at any time by visiting '
            '<a href="{{helpdesk_url}}">{{helpdesk_url}}</a>.</p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'ticket_resolved',
        'Ticket Resolved — Notification to Requester',
        'Your support ticket {{ticket_reference}} has been resolved',
        (
            '<p>Hi {{requester_name}},</p>'
            '<p>Good news — your ticket <strong>{{ticket_reference}}</strong> '
            '(<em>{{ticket_subject}}</em>) has been marked as resolved.</p>'
            '{% if resolution_note %}'
            '<p><strong>Resolution note:</strong> {{resolution_note}}</p>'
            '{% endif %}'
            '<p>If the issue is still happening, just reply to this email or '
            'open a new ticket at <a href="{{helpdesk_url}}">{{helpdesk_url}}</a>.</p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'ticket_assigned',
        'Ticket Assigned — Notification to Assignee',
        'You have been assigned ticket {{ticket_reference}}',
        (
            '<p>Hi {{assignee_name}},</p>'
            '<p>Ticket <strong>{{ticket_reference}}</strong> has been assigned to you.</p>'
            '<p>Subject: <em>{{ticket_subject}}</em><br>'
            'Requester: {{requester_name}}</p>'
            '<p>View the ticket: <a href="{{helpdesk_url}}">{{helpdesk_url}}</a></p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'ticket_reply',
        'Staff Reply — Notification to Requester',
        'New reply on your ticket {{ticket_reference}}',
        (
            '<p>Hi {{requester_name}},</p>'
            '<p>{{staff_name}} has replied to your ticket '
            '<strong>{{ticket_reference}}</strong> '
            '(<em>{{ticket_subject}}</em>).</p>'
            '<p>{{reply_body}}</p>'
            '<p>View the full conversation: '
            '<a href="{{helpdesk_url}}">{{helpdesk_url}}</a></p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'status_changed',
        'Status Changed — Notification to Requester',
        'Your ticket {{ticket_reference}} status has changed',
        (
            '<p>Hi {{requester_name}},</p>'
            '<p>The status of your ticket <strong>{{ticket_reference}}</strong> '
            '(<em>{{ticket_subject}}</em>) has been updated.</p>'
            '<p>Status: <strong>{{old_status}}</strong> → <strong>{{new_status}}</strong></p>'
            '<p><a href="{{helpdesk_url}}">View your ticket</a></p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'waiting_requester',
        'Waiting for Requester — Action Required',
        'Action required on your ticket {{ticket_reference}}',
        (
            '<p>Hi {{requester_name}},</p>'
            '<p>Your ticket <strong>{{ticket_reference}}</strong> '
            '(<em>{{ticket_subject}}</em>) is waiting for your response.</p>'
            '<p>Please reply or update your ticket so our team can continue '
            'helping you.</p>'
            '<p><a href="{{helpdesk_url}}">View your ticket</a></p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'priority_changed',
        'Priority Changed — Notification',
        'Priority updated on ticket {{ticket_reference}}',
        (
            '<p>Hi {{requester_name}},</p>'
            '<p>The priority of your ticket <strong>{{ticket_reference}}</strong> '
            '(<em>{{ticket_subject}}</em>) has been updated.</p>'
            '<p>Priority: <strong>{{old_priority}}</strong> → '
            '<strong>{{new_priority}}</strong></p>'
            '{% if reason %}<p>Reason: {{reason}}</p>{% endif %}'
            '<p><a href="{{helpdesk_url}}">View your ticket</a></p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'account_recovery',
        'Account Recovery — Credentials Email',
        'Your IIC college account recovery credentials — {{ticket_reference}}',
        (
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
            '<td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;font-size:1.1rem;letter-spacing:.15em;">{{backup_code}}</td>'
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
    ),
    (
        'recovery_unable_to_verify',
        'Account Recovery — Unable to Verify Identity',
        'Account recovery update — {{ticket_reference}}',
        (
            '<p>Hi {{name}},</p>'
            '<p>Thank you for submitting an account recovery request. '
            'Unfortunately, our team was unable to verify your identity '
            'with the details provided and cannot process your request remotely.</p>'
            '<p>To resolve this, please visit the IIC IT &amp; NOC department '
            'in person with a valid college ID or other approved identification.</p>'
            '<p><strong>Office hours:</strong> Sunday–Friday, 10:00 AM – 4:00 PM<br>'
            '<strong>Email:</strong> <a href="mailto:{{support_email}}">{{support_email}}</a></p>'
            '<p>Your ticket (<strong>{{ticket_reference}}</strong>) remains open. '
            'Come see us and we\'ll sort it out straight away.</p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'ticket_stale',
        'Ticket Stale — SLA Breach Alert',
        '{% if is_escalation %}ESCALATION{% else %}SLA Breach{% endif %}: Ticket {{ticket_reference}} is overdue',
        (
            '<p>Hi,</p>'
            '<p>Ticket <strong>{{ticket_reference}}</strong> has been sitting in '
            '<strong>{{ticket_status}}</strong> status for <strong>{{age_hours}} hours</strong> '
            '(threshold: {{threshold_hours}}h).</p>'
            '<p><strong>Subject:</strong> {{ticket_subject}}<br>'
            '<strong>Requester:</strong> {{requester_name}}<br>'
            '<strong>Assignee:</strong> {{assignee_name}}<br>'
            '<strong>Category:</strong> {{category_name}}<br>'
            '<strong>Priority:</strong> {{ticket_priority}}</p>'
            '{% if is_escalation %}'
            '<p style="color:#991b1b;font-weight:700;">This ticket has exceeded the '
            'escalation threshold. Please action it urgently.</p>'
            '{% endif %}'
            '<p><a href="{{helpdesk_url}}">View ticket in helpdesk</a></p>'
            '<p>— IIC IT &amp; NOC Helpdesk (automated alert)</p>'
        ),
    ),
    (
        'email_verification',
        'Email Verification — Account Activation',
        'Verify your IIC IT Helpdesk account',
        (
            '<p>Hi {{name}},</p>'
            '<p>Thanks for registering for the IIC IT &amp; NOC Helpdesk. '
            'Click the link below to verify your email address '
            '(<strong>{{email}}</strong>) and activate your account.</p>'
            '<p style="margin:24px 0;">'
            '<a href="{{verify_url}}" style="background:#234395;color:#fff;'
            'padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">'
            'Verify email address</a></p>'
            '<p>This link expires in <strong>{{expires_hours}} hour(s)</strong>. '
            'Do not share it with anyone.</p>'
            '<p>If you did not create an account, you can safely ignore this email.</p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
    (
        'password_reset',
        'Password Reset — IIC IT Helpdesk',
        '[IIC IT Helpdesk] Reset your password',
        (
            '<p>Hi {{name}},</p>'
            '<p>We received a request to reset your IIC IT Helpdesk password. '
            'Click the button below to choose a new one.</p>'
            '<p style="margin:24px 0;">'
            '<a href="{{reset_url}}" style="background:#234395;color:#fff;'
            'padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">'
            'Reset my password</a></p>'
            '<p>This link expires in <strong>{{expiry_hours}} hour(s)</strong> '
            'and can only be used once.</p>'
            '<p>If you did not request a password reset, ignore this email — '
            'your password will not change.</p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    ),
]


def seed_templates(apps, schema_editor):
    EmailTemplate = apps.get_model('helpdesk', 'EmailTemplate')
    for event_type, name, subject, body in TEMPLATES:
        EmailTemplate.objects.get_or_create(
            event_type=event_type,
            name=name,
            defaults={
                'subject_template':    subject,
                'body_html_template':  body,
                'is_active':           True,
                'use_file_fallback':   True,   # use on-disk file by default;
                                               # admin turns this off to go live
                                               # with their custom DB copy
            },
        )


def unseed_templates(apps, schema_editor):
    EmailTemplate = apps.get_model('helpdesk', 'EmailTemplate')
    names = [name for _, name, _, _ in TEMPLATES]
    EmailTemplate.objects.filter(name__in=names).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('helpdesk', '0039_add_use_file_fallback_to_emailtemplate'),
    ]

    operations = [
        migrations.RunPython(seed_templates, reverse_code=unseed_templates),
    ]
