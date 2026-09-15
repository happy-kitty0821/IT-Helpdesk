"""
Validators for dynamic-service-forms feature.

validate_form_schema  — validates a ServiceCategory.form_schema array
validate_extra_fields — validates a Ticket.extra_fields dict against the category schema
"""

import re

from rest_framework.exceptions import ValidationError

# ── Constants ────────────────────────────────────────────────────────────────

VALID_TYPES = {"text", "textarea", "select", "email", "phone", "checkbox", "file"}

_EMAIL_RE = re.compile(r"^[^@]+@[^@]+\.[^@]+$")
_PHONE_RE = re.compile(r"^[\d\s\+\-\(\)]+$")


# ── validate_form_schema ─────────────────────────────────────────────────────

def validate_form_schema(value):
    """
    Validate a form_schema array.

    Raises rest_framework.exceptions.ValidationError when any rule is violated.
    Collects ALL per-element errors before raising so the caller gets the full
    picture in one response.
    """
    errors = []

    # 1. Must be a list
    if not isinstance(value, list):
        raise ValidationError({"form_schema": ["form_schema must be a JSON array."]})

    # 2. At most 50 elements
    if len(value) > 50:
        raise ValidationError({"form_schema": ["form_schema may contain at most 50 fields."]})

    seen_keys = {}  # key → first index, for duplicate detection

    for i, element in enumerate(value):
        # Determine a human-readable identifier for error messages.
        # Use the key value if it looks valid; fall back to positional notation.
        raw_key = element.get("key") if isinstance(element, dict) else None
        identifier = raw_key if (raw_key and isinstance(raw_key, str) and raw_key.strip()) else f"[{i}]"

        def field_error(msg):
            errors.append(f"Field {identifier}: {msg}")

        if not isinstance(element, dict):
            field_error("each field definition must be a JSON object.")
            continue

        # ── key ──────────────────────────────────────────────────────────────
        key = element.get("key")
        if key is None or not isinstance(key, str) or not key.strip():
            field_error("key is required and must be a non-empty string.")
        elif len(key) > 64:
            field_error("key must be at most 64 characters.")
        else:
            # Valid key — track for duplicate detection
            if key in seen_keys:
                field_error(f"duplicate key '{key}' (first seen at index {seen_keys[key]}).")
            else:
                seen_keys[key] = i

        # ── label ────────────────────────────────────────────────────────────
        label = element.get("label")
        if label is None or not isinstance(label, str) or not label.strip():
            field_error("label is required and must be a non-empty string.")
        elif len(label) > 255:
            field_error("label must be at most 255 characters.")

        # ── type ─────────────────────────────────────────────────────────────
        field_type = element.get("type")
        if field_type is None or not isinstance(field_type, str):
            field_error(f"type is required and must be one of: {', '.join(sorted(VALID_TYPES))}.")
        elif field_type not in VALID_TYPES:
            field_error(f"type '{field_type}' is invalid; must be one of: {', '.join(sorted(VALID_TYPES))}.")
        else:
            # ── options (select only) ─────────────────────────────────────
            options = element.get("options")
            if field_type == "select":
                if not isinstance(options, list) or len(options) == 0:
                    field_error("options is required for select fields and must be a non-empty array.")
                elif len(options) > 50:
                    field_error("options may contain at most 50 items.")
                else:
                    for j, opt in enumerate(options):
                        if not isinstance(opt, str) or not opt.strip():
                            field_error(f"options[{j}] must be a non-empty string.")
                        elif len(opt) > 255:
                            field_error(f"options[{j}] must be at most 255 characters.")
            # For non-select types, options may be absent or empty — no error.

        # ── optional attributes ───────────────────────────────────────────────
        placeholder = element.get("placeholder")
        if placeholder is not None:
            if not isinstance(placeholder, str):
                field_error("placeholder must be a string.")
            elif len(placeholder) > 255:
                field_error("placeholder must be at most 255 characters.")

        help_text = element.get("help_text")
        if help_text is not None:
            if not isinstance(help_text, str):
                field_error("help_text must be a string.")
            elif len(help_text) > 1000:
                field_error("help_text must be at most 1000 characters.")

        required = element.get("required")
        if required is not None and not isinstance(required, bool):
            field_error("required must be a boolean.")

        order = element.get("order")
        if order is not None:
            if not isinstance(order, int) or isinstance(order, bool):
                field_error("order must be an integer.")
            elif not (0 <= order <= 999):
                field_error("order must be between 0 and 999.")

    if errors:
        raise ValidationError({"form_schema": errors})


# ── validate_extra_fields ────────────────────────────────────────────────────

def validate_extra_fields(extra_fields, form_schema, file_keys=None):
    """
    Validate extra_fields dict against the category's form_schema.

    file_keys: set of field keys that were uploaded as multipart files.
               Required for validating required `file` type fields.

    Raises rest_framework.exceptions.ValidationError when any rule is violated.
    Collects ALL per-key errors before raising.
    """
    errors = {}  # key → error message
    if file_keys is None:
        file_keys = set()

    if not isinstance(extra_fields, dict):
        raise ValidationError({"extra_fields": ["extra_fields must be a JSON object."]})

    # Build a lookup dict for fast access
    schema_by_key = {field["key"]: field for field in form_schema if isinstance(field, dict) and "key" in field}

    # 1. Reject unknown keys (ignore file type fields — they're not in extra_fields)
    non_file_keys = {k: v for k, v in schema_by_key.items() if v.get("type") != "file"}
    for key in extra_fields:
        if key not in non_file_keys:
            errors[key] = f"Unrecognised field '{key}'."

    # 2. Per-field validation
    for field in form_schema:
        if not isinstance(field, dict):
            continue
        key = field.get("key")
        if not key:
            continue

        field_type = field.get("type")
        is_required = field.get("required", False)
        value = extra_fields.get(key)

        # File fields: only check required presence via file_keys
        if field_type == "file":
            if is_required and key not in file_keys:
                errors[key] = "A file is required for this field."
            continue

        # Required field checks
        if is_required:
            if field_type == "checkbox":
                if key not in extra_fields:
                    errors[key] = "This field is required."
            else:
                if key not in extra_fields or value == "" or value is None:
                    errors[key] = "This field is required."
                    continue

        # Type-specific validation (only when a value was actually submitted)
        if key in extra_fields and value is not None and value != "":
            if field_type == "select":
                options = field.get("options", [])
                if value not in options:
                    errors[key] = f"Value must be one of: {', '.join(options)}."

            elif field_type == "email":
                if not isinstance(value, str) or not _EMAIL_RE.match(value):
                    errors[key] = "Enter a valid email address (local@domain.tld)."

            elif field_type == "phone":
                if not isinstance(value, str) or not _PHONE_RE.match(value) or not (1 <= len(value) <= 20):
                    errors[key] = (
                        "Enter a valid phone number (digits, spaces, +, -, (, ) only; 1–20 characters)."
                    )

        # Value length limit (applies to all non-file types)
        if key in extra_fields and value is not None:
            if len(str(value)) > 2000:
                errors[key] = "Value must be at most 2000 characters."

    if errors:
        raise ValidationError({"extra_fields": errors})


# ── Quick smoke test ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Should not raise
    validate_form_schema([
        {"key": "college_id", "label": "College ID", "type": "text", "required": True, "order": 0}
    ])
    print("validate_form_schema: basic valid schema — OK")

    # Select field with valid options
    validate_form_schema([
        {
            "key": "issue_type",
            "label": "Issue type",
            "type": "select",
            "required": True,
            "options": ["Password reset", "Account locked", "MFA issue", "Other"],
            "order": 0,
        }
    ])
    print("validate_form_schema: select field — OK")

    # Should raise — not a list
    try:
        validate_form_schema("not a list")
        print("FAIL: expected ValidationError for non-list")
    except ValidationError as exc:
        print(f"validate_form_schema: non-list raises — OK ({exc.detail})")

    # Should raise — more than 50 fields
    try:
        validate_form_schema([{"key": f"k{i}", "label": f"L{i}", "type": "text"} for i in range(51)])
        print("FAIL: expected ValidationError for >50 fields")
    except ValidationError as exc:
        print(f"validate_form_schema: >50 fields raises — OK")

    # Should raise — duplicate keys
    try:
        validate_form_schema([
            {"key": "same", "label": "A", "type": "text"},
            {"key": "same", "label": "B", "type": "text"},
        ])
        print("FAIL: expected ValidationError for duplicate keys")
    except ValidationError as exc:
        print(f"validate_form_schema: duplicate key raises — OK")

    # validate_extra_fields — valid
    schema = [{"key": "college_id", "label": "College ID", "type": "text", "required": True}]
    validate_extra_fields({"college_id": "IIC2024001"}, schema)
    print("validate_extra_fields: valid extra_fields — OK")

    # validate_extra_fields — required field missing
    try:
        validate_extra_fields({}, schema)
        print("FAIL: expected ValidationError for missing required field")
    except ValidationError as exc:
        print(f"validate_extra_fields: missing required field raises — OK")

    # validate_extra_fields — unknown key
    try:
        validate_extra_fields({"unknown_key": "value"}, [])
        print("FAIL: expected ValidationError for unknown key")
    except ValidationError as exc:
        print(f"validate_extra_fields: unknown key raises — OK")

    print("\nAll smoke tests passed.")
