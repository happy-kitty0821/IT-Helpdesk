from django.db import migrations


def seed_services(apps, schema_editor):
    ServiceCategory = apps.get_model('helpdesk', 'ServiceCategory')
    rows = [
        ('College account recovery', 'account-recovery', 'Recover access to your IIC college account safely.', 'public', 'key-round'),
        ('Laptop & device support', 'device-support', 'Get help diagnosing laptop, software, and device problems.', 'all', 'laptop'),
        ('ID card replacement', 'id-card-replacement', 'Report a lost or damaged college ID card.', 'all', 'badge'),
        ('Wi-Fi issue', 'wifi-issue', 'Report weak signal, connection failures, or campus Wi-Fi problems.', 'all', 'wifi'),
        ('CCTV review request', 'cctv-review', 'Request an authorized review for a campus incident.', 'staff', 'camera'),
        ('General IT support', 'general-support', 'Ask for help with classroom equipment, printing, or software.', 'all', 'life-buoy'),
    ]
    for order, (name, slug, summary, audience, icon) in enumerate(rows, start=1):
        ServiceCategory.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name,
                'summary': summary,
                'audience': audience,
                'icon': icon,
                'sort_order': order,
                'is_active': True,
            },
        )


def remove_seeded_services(apps, schema_editor):
    ServiceCategory = apps.get_model('helpdesk', 'ServiceCategory')
    ServiceCategory.objects.filter(slug__in=[
        'account-recovery', 'device-support', 'id-card-replacement',
        'wifi-issue', 'cctv-review', 'general-support',
    ]).delete()


class Migration(migrations.Migration):
    dependencies = [('helpdesk', '0001_initial')]
    operations = [migrations.RunPython(seed_services, remove_seeded_services)]
