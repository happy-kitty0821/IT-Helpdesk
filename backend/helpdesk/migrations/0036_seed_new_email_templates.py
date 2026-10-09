"""
Seed default EmailTemplate rows for the three new event types:
  ticket_reply        — notify requester when staff posts a public reply
  waiting_requester   — notify requester when ticket moves to waiting_requester
  priority_changed    — notify assigned staff when requester promotes priority
"""
from django.db import migrations


TEMPLATES = [
    {
        'event_type': 'ticket_reply',
        'name':     'Staff Reply — Default',
        'subject':  '[IIC Helpdesk] New reply on your ticket {{ticket_reference}}',
        'body':     (
            '<p>Hi {{requester_name}},</p>'
            '<p>The IT team has replied to your support request '
            '<strong>{{ticket_reference}}: {{ticket_subject}}</strong>.</p>'
            '<blockquote style="border-left:4px solid #234395;padding-left:14px;color:#334155;">'
            '{{reply_body}}'
            '</blockquote>'
            '<p>You can view the full conversation and send a reply here:<br>'
            '<a href="{{helpdesk_url}}/tickets/{{ticket_reference}}">View ticket</a></p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    },
    {
        'event_type': 'waiting_requester',
        'name':     'Waiting for Requester — Default',
        'subject':  '[IIC Helpdesk] Action needed on your ticket {{ticket_reference}}',
        'body':     (
            '<p>Hi {{requester_name}},</p>'
            '<p>Your support request <strong>{{ticket_reference}}: {{ticket_subject}}</strong> '
            'is waiting for more information from you.</p>'
            '<p>Please visit the helpdesk and reply to the IT team so we can continue '
            'helping you:</p>'
            '<p><a href="{{helpdesk_url}}/tickets/{{ticket_reference}}">View ticket</a></p>'
            '<p>If we don\'t hear back, the ticket may be closed automatically.</p>'
            '<p>— IIC IT &amp; NOC Department</p>'
        ),
    },
    {
        'event_type': 'priority_changed',
        'name':     'Priority Escalated by Requester — Default',
        'subject':  '[IIC Helpdesk] Priority escalated on {{ticket_reference}}',
        'body':     (
            '<p>Hi,</p>'
            '<p>The priority of ticket <strong>{{ticket_reference}}: {{ticket_subject}}</strong> '
            'has been escalated to <strong>{{new_priority}}</strong> '
            'by the requester ({{requester_name}}).</p>'
            '{% if reason %}'
            '<p><em>Reason given: {{reason}}</em></p>'
            '{% endif %}'
            '<p><a href="{{helpdesk_url}}/admin/tickets">View in staff portal</a></p>'
            '<p>— IIC IT Helpdesk (automated)</p>'
        ),
    },
]


def seed(apps, schema_editor):
    EmailTemplate = apps.get_model('helpdesk', 'EmailTemplate')
    for t in TEMPLATES:
        EmailTemplate.objects.get_or_create(
            event_type=t['event_type'],
            defaults={
                'name':                t['name'],
                'subject_template':    t['subject'],
                'body_html_template':  t['body'],
                'is_active':           True,
            },
        )


def unseed(apps, schema_editor):
    EmailTemplate = apps.get_model('helpdesk', 'EmailTemplate')
    EmailTemplate.objects.filter(
        event_type__in=['ticket_reply', 'waiting_requester', 'priority_changed']
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('helpdesk', '0035_notification_event_types'),
    ]

    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
