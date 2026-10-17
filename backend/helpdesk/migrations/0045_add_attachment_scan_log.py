from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('helpdesk', '0044_add_attachment_scan_event_type'),
    ]

    operations = [
        migrations.CreateModel(
            name='AttachmentScanLog',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('attachment', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='scan_logs',
                    to='helpdesk.ticketattachment',
                )),
                ('ticket_ref', models.CharField(
                    blank=True, default='', max_length=20,
                    help_text='Ticket reference at time of scan.',
                )),
                ('file_name', models.CharField(
                    blank=True, default='', max_length=255,
                    help_text='Original file name at time of scan.',
                )),
                ('scan_type', models.CharField(
                    choices=[('magic_bytes', 'Magic Bytes'), ('virustotal', 'VirusTotal')],
                    max_length=20,
                )),
                ('result', models.CharField(
                    choices=[
                        ('clean',    'Clean'),
                        ('infected', 'Infected'),
                        ('error',    'Error'),
                        ('skipped',  'Skipped'),
                    ],
                    db_index=True,
                    max_length=20,
                )),
                ('detail', models.TextField(blank=True, default='')),
                ('engine_count', models.PositiveIntegerField(
                    blank=True, null=True,
                    help_text='Total AV engines checked (VirusTotal only).',
                )),
                ('scanned_at', models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={
                'verbose_name': 'Attachment scan log',
                'verbose_name_plural': 'Attachment scan logs',
                'ordering': ['-scanned_at'],
            },
        ),
    ]
