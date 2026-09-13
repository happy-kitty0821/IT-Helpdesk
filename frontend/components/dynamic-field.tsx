"use client";

import type { FieldDefinition } from "@/lib/services";

interface DynamicFieldProps {
  field: FieldDefinition;
  value: string | boolean;
  onChange: (key: string, value: string | boolean) => void;
  error?: string;
}

/**
 * Renders a single FieldDefinition as the correct HTML input element.
 * Supports: text, textarea, select, email, phone, checkbox.
 */
export function DynamicField({ field, value, onChange, error }: DynamicFieldProps) {
  const { key, label, type, required, options, placeholder, help_text } = field;

  // Build aria-describedby from whichever helpers are present
  const describedByParts: string[] = [];
  if (help_text) describedByParts.push(`${key}-help`);
  if (error)     describedByParts.push(`${key}-error`);
  const describedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  const commonProps = {
    id: key,
    name: key,
    required: required ?? false,
    "aria-describedby": describedBy,
    "aria-invalid": error ? (true as const) : undefined,
  } as const;

  let control: React.ReactNode;

  if (type === "checkbox") {
    control = (
      <input
        {...commonProps}
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(key, e.target.checked)}
      />
    );
  } else if (type === "textarea") {
    control = (
      <textarea
        {...commonProps}
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder || undefined}
        rows={4}
        onChange={(e) => onChange(key, e.target.value)}
      />
    );
  } else if (type === "select") {
    control = (
      <select
        {...commonProps}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(key, e.target.value)}
      >
        <option value="" disabled>
          {placeholder || `Select ${label.toLowerCase()}`}
        </option>
        {(options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  } else {
    // text | email | phone
    const inputType = type === "phone" ? "tel" : type;
    control = (
      <input
        {...commonProps}
        type={inputType}
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder || undefined}
        onChange={(e) => onChange(key, e.target.value)}
      />
    );
  }

  return (
    <div className="ticket-form-field">
      {type === "checkbox" ? (
        /* Checkbox: place the input before the label text in a flex row */
        <label htmlFor={key} className="ticket-form-field__checkbox-label">
          {control}
          {label}
          {required && <span aria-hidden="true" className="ticket-form-field__required">*</span>}
        </label>
      ) : (
        <label htmlFor={key}>
          {label}
          {required && <span aria-hidden="true" className="ticket-form-field__required">*</span>}
          {control}
        </label>
      )}

      {help_text && (
        <small id={`${key}-help`} className="ticket-form-field__help">
          {help_text}
        </small>
      )}

      {error && (
        <span
          id={`${key}-error`}
          role="alert"
          className="field-error"
        >
          {error}
        </span>
      )}
    </div>
  );
}
