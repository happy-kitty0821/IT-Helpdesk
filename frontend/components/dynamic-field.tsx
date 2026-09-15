"use client";

import type { FieldDefinition } from "@/lib/services";

const ACCEPTED_FILE_TYPES = "application/pdf,image/jpeg,image/png,image/gif,image/webp";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

interface DynamicFieldProps {
  field: FieldDefinition;
  /** For non-file fields: string | boolean. For file fields: File | null. */
  value: string | boolean | File | null;
  onChange: (key: string, value: string | boolean | File | null) => void;
  error?: string;
}

/**
 * Renders a single FieldDefinition as the correct HTML input.
 * Supports: text, textarea, select, email, phone, checkbox, file.
 */
export function DynamicField({ field, value, onChange, error }: DynamicFieldProps) {
  const { key, label, type, required, options, placeholder, help_text } = field;

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
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else if (type === "file") {
    const fileValue = value instanceof File ? value : null;
    control = (
      <div>
        <input
          {...commonProps}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          style={{ display: "block", width: "100%" }}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (file) {
              if (file.size > MAX_FILE_BYTES) {
                // Let the parent surface the error via validation
                onChange(key, null);
                // Trigger a synthetic error by passing a sentinel — handled in form
                e.target.value = "";
                return;
              }
            }
            onChange(key, file);
          }}
        />
        {fileValue && (
          <p style={{ margin: "6px 0 0", fontSize: ".78rem", color: "#166534", display: "flex", alignItems: "center", gap: 5 }}>
            ✓ {fileValue.name}{" "}
            <span style={{ color: "#64748b" }}>({(fileValue.size / 1024).toFixed(0)} KB)</span>
            <button
              type="button"
              onClick={() => onChange(key, null)}
              style={{ marginLeft: 4, border: 0, background: "transparent", color: "#991b1b", cursor: "pointer", fontSize: ".78rem", fontWeight: 700 }}
              aria-label={`Remove ${fileValue.name}`}
            >
              ✕ Remove
            </button>
          </p>
        )}
        <p style={{ margin: "4px 0 0", fontSize: ".75rem", color: "#64748b" }}>
          PDF, JPEG, PNG, GIF or WebP · max 10 MB
        </p>
      </div>
    );
  } else {
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
        <span id={`${key}-error`} role="alert" className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
