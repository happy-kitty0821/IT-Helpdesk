from django.db import migrations

TEMPLATES = [
    {
        'event_type': 'ticket_submitted',
        'name': 'Ticket Submitted Confirmation',
        'subject_template': 'Your request {{ticket_reference}} has been received',
        'body_html_template': '''<p>Hi {{requester_name}},</p>
<p>Thank you for contacting the IIC IT & NOC Helpdesk. Your support request has been received and logged.</p>
<p><strong>Reference:</strong> {{ticket_reference}}<br>
<strong>Subject:</strong> {{ticket_subject}}<br>
<strong>Category:</strong> {{category_name}}</p>
<p>Our team will review your request and respond as soon as possible during college hours.</p>
<p>You can track your request at: <a href="{{helpdesk_url}}">{{helpdesk_url}}</a></p>
<p>Best regards,<br>IIC IT &amp; NOC Team</p>''',
    },
    {
        'event_type': 'ticket_resolved',
        'name': 'Ticket Resolved Notification',
        'subject_template': 'Your request {{ticket_reference}} has been resolved',
        'body_html_template': '''<p>Hi {{requester_name}},</p>
<p>We are pleased to inform you that your support request has been resolved.</p>
<p><strong>Reference:</strong> {{ticket_reference}}<br>
<strong>Subject:</strong> {{ticket_subject}}</p>
<p><strong>Resolution:</strong><br>{{resolution_note}}</p>
<p>If you have any further questions or the issue recurs, please do not hesitate to contact us.</p>
<p>Best regards,<br>IIC IT &amp; NOC Team</p>''',
    },
    {
        'event_type': 'ticket_assigned',
        'name': 'Ticket Assignment Notification',
        'subject_template': 'Ticket {{ticket_reference}} has been assigned to you',
        'body_html_template': '''<p>Hi {{assignee_name}},</p>
<p>A support request has been assigned to you.</p>
<p><strong>Reference:</strong> {{ticket_reference}}<br>
<strong>Subject:</strong> {{ticket_subject}}<br>
<strong>Requested by:</strong> {{requester_name}}</p>
<p>Please review and respond to this request at your earliest convenience.</p>
<p>View ticket: <a href="{{helpdesk_url}}">{{helpdesk_url}}</a></p>
<p>Best regards,<br>IIC IT &amp; NOC Team</p>''',
    },
    {
        'event_type': 'status_changed',
        'name': 'Ticket Status Update',
        'subject_template': 'Update on your request {{ticket_reference}}',
        'body_html_template': '''<p>Hi {{requester_name}},</p>
<p>There has been an update to your support request.</p>
<p><strong>Reference:</strong> {{ticket_reference}}<br>
<strong>Subject:</strong> {{ticket_subject}}<br>
<strong>Status changed:</strong> {{old_status}} → {{new_status}}</p>
<p>You can view your request at: <a href="{{helpdesk_url}}">{{helpdesk_url}}</a></p>
<p>Best regards,<br>IIC IT &amp; NOC Team</p>''',
    },
    {
        'event_type': 'account_recovery',
        'name': 'Account Recovery Request',
        'subject_template': 'Account recovery request received — IIC IT Helpdesk',
        'body_html_template': '''<p>Hi {{requester_name}},</p>
<p>We have received an account recovery request for <strong>{{college_email}}</strong>.</p>
<p>Our IT team will verify your identity using approved college records and contact you to assist with account recovery. This process is manual to ensure the security of your account.</p>
<p><strong>Important:</strong> We will never ask for your password, one-time codes, or recovery codes.</p>
<p>If you did not submit this request, please contact us immediately at <a href="mailto:{{support_email}}">{{support_email}}</a>.</p>
<p>Helpdesk: <a href="{{helpdesk_url}}">{{helpdesk_url}}</a></p>
<p>Best regards,<br>IIC IT &amp; NOC Team</p>''',
    },
]


def seed_templates(apps, schema_editor):
    EmailTemplate = apps.get_model('helpdesk', 'EmailTemplate')
    for t in TEMPLATES:
        EmailTemplate.objects.get_or_create(
            event_type=t['event_type'],
            defaults={
                'name': t['name'],
                'subject_template': t['subject_template'],
                'body_html_template': t['body_html_template'],
                'is_active': True,
            }
        )


def reverse_seed(apps, schema_editor):
    EmailTemplate = apps.get_model('helpdesk', 'EmailTemplate')
    EmailTemplate.objects.filter(
        event_type__in=[t['event_type'] for t in TEMPLATES]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('helpdesk', '0010_notification_channels'),
    ]
    operations = [
        migrations.RunPython(seed_templates, reverse_seed, atomic=True),
    ]
