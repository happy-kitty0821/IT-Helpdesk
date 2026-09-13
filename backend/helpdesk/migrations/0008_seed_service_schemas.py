from django.db import migrations


SCHEMAS = {
    "account-recovery": [
        {"key": "issue_type", "label": "Issue type", "type": "select", "required": True, "options": ["Password reset", "Account locked", "MFA issue", "Other"], "order": 0},
        {"key": "college_id", "label": "College ID", "type": "text", "required": True, "order": 1},
        {"key": "alternative_contact", "label": "Alternative contact email", "type": "email", "required": True, "order": 2},
    ],
    "device-support": [
        {"key": "device_type", "label": "Device type", "type": "select", "required": True, "options": ["Laptop", "Desktop", "Tablet", "Other"], "order": 0},
        {"key": "device_model", "label": "Device model", "type": "text", "required": False, "order": 1},
        {"key": "operating_system", "label": "Operating system", "type": "select", "required": True, "options": ["Windows", "macOS", "Linux", "Other"], "order": 2},
        {"key": "issue_details", "label": "Issue details", "type": "textarea", "required": True, "order": 3},
        {"key": "asset_serial", "label": "Asset / serial number", "type": "text", "required": False, "order": 4},
    ],
    "id-card-replacement": [
        {"key": "college_id", "label": "College ID", "type": "text", "required": True, "order": 0},
        {"key": "reason", "label": "Reason", "type": "select", "required": True, "options": ["Lost", "Damaged", "Other"], "order": 1},
        {"key": "programme_department", "label": "Programme / department", "type": "text", "required": True, "order": 2},
    ],
    "wifi-issue": [
        {"key": "building", "label": "Building", "type": "text", "required": True, "order": 0},
        {"key": "floor_room", "label": "Floor / room", "type": "text", "required": False, "order": 1},
        {"key": "ssid", "label": "SSID (network name)", "type": "text", "required": False, "order": 2},
        {"key": "device_os", "label": "Device OS", "type": "select", "required": True, "options": ["Windows", "macOS", "Android", "iOS", "Other"], "order": 3},
        {"key": "symptoms", "label": "Symptoms", "type": "textarea", "required": True, "order": 4},
    ],
    "cctv-review": [
        {"key": "incident_purpose", "label": "Incident purpose", "type": "textarea", "required": True, "order": 0},
        {"key": "location", "label": "Location", "type": "text", "required": True, "order": 1},
        {"key": "requested_time_window", "label": "Requested time window", "type": "text", "required": True, "order": 2},
    ],
    "general-support": [
        {"key": "subcategory", "label": "Subcategory", "type": "select", "required": True, "options": ["Classroom equipment", "Printing", "Software", "Other"], "order": 0},
    ],
}


def seed_schemas(apps, schema_editor):
    ServiceCategory = apps.get_model("helpdesk", "ServiceCategory")
    for slug, form_schema in SCHEMAS.items():
        ServiceCategory.objects.filter(slug=slug).update(form_schema=form_schema)


def reverse_seed_schemas(apps, schema_editor):
    ServiceCategory = apps.get_model("helpdesk", "ServiceCategory")
    ServiceCategory.objects.filter(slug__in=SCHEMAS.keys()).update(form_schema=[])


class Migration(migrations.Migration):

    dependencies = [
        ("helpdesk", "0007_service_form_schema"),
    ]

    operations = [
        migrations.RunPython(seed_schemas, reverse_seed_schemas, atomic=True),
    ]
