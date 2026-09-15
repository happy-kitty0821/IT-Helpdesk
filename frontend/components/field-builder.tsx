"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldDefinition, FieldType } from "@/lib/services";

interface FieldBuilderProps {
  schema: FieldDefinition[];
  onChange: (schema: FieldDefinition[]) => void;
}

const FIELD_TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: "text",     label: "Short text",  hint: "Single-line text input" },
  { value: "textarea", label: "Long text",   hint: "Multi-line text area" },
  { value: "select",   label: "Dropdown",    hint: "Select one option from a list" },
  { value: "email",    label: "Email",       hint: "Validated email address" },
  { value: "phone",    label: "Phone",       hint: "Phone / contact number" },
  { value: "checkbox", label: "Checkbox",    hint: "True / false toggle" },
  { value: "file",     label: "File upload", hint: "PDF or image (max 10 MB)" },
];

const TYPE_COLORS: Record<FieldType, string> = {
  text:     "badge-text",
  textarea: "badge-textarea",
  select:   "badge-select",
  email:    "badge-email",
  phone:    "badge-phone",
  checkbox: "badge-checkbox",
  file:     "badge-file",
};

function withOrder(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.map((f, i) => ({ ...f, order: i }));
}

// Ensure a blank new field for a given type has sensible defaults
function blankField(type: FieldType, index: number): FieldDefinition {
  const base: FieldDefinition = {
    key: "",
    label: "",
    type,
    required: false,
    order: index,
  };
  if (type === "select") base.options = [];
  return base;
}

// When changing type, preserve common fields but clear type-specific ones
function coerceToType(field: FieldDefinition, newType: FieldType): FieldDefinition {
  const next: FieldDefinition = {
    ...field,
    type: newType,
  };
  if (newType === "select") {
    next.options = field.options ?? [];
  } else {
    delete next.options;
  }
  return next;
}

export function FieldBuilder({ schema, onChange }: FieldBuilderProps) {
  const [draft, setDraft] = useState<FieldDefinition[]>(() => withOrder(schema));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const internalChange = useRef(false);

  // Sync draft when the schema prop changes externally
  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false;
      return;
    }
    if (JSON.stringify(schema) !== JSON.stringify(draft)) {
      setDraft(withOrder(schema));
      setExpanded(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  function commit(next: FieldDefinition[]) {
    const ordered = withOrder(next);
    internalChange.current = true;
    setDraft(ordered);
    onChange(ordered);
  }

  function toggleExpand(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  function addField() {
    const next = [...draft, blankField("text", draft.length)];
    const ordered = withOrder(next);
    internalChange.current = true;
    setDraft(ordered);
    onChange(ordered);
    setExpanded((prev) => new Set(prev).add(ordered.length - 1));
  }

  function deleteField(index: number) {
    const next = draft.filter((_, i) => i !== index);
    setExpanded((prev) => {
      const s = new Set<number>();
      for (const idx of prev) {
        if (idx < index) s.add(idx);
        else if (idx > index) s.add(idx - 1);
      }
      return s;
    });
    commit(next);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...draft];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setExpanded((prev) => {
      const s = new Set(prev);
      const a = s.has(index - 1), b = s.has(index);
      b ? s.add(index - 1) : s.delete(index - 1);
      a ? s.add(index) : s.delete(index);
      return s;
    });
    commit(next);
  }

  function moveDown(index: number) {
    if (index === draft.length - 1) return;
    const next = [...draft];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setExpanded((prev) => {
      const s = new Set(prev);
      const a = s.has(index), b = s.has(index + 1);
      b ? s.add(index) : s.delete(index);
      a ? s.add(index + 1) : s.delete(index + 1);
      return s;
    });
    commit(next);
  }

  function updateField(index: number, patch: Partial<FieldDefinition>) {
    commit(draft.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function changeType(index: number, newType: FieldType) {
    commit(draft.map((f, i) => (i === index ? coerceToType(f, newType) : f)));
  }

  const sortedDraft = [...draft].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div className="field-builder">
      {sortedDraft.length === 0 ? (
        <p className="field-builder-empty">
          No fields yet. Use &ldquo;Add field&rdquo; to build your form schema.
        </p>
      ) : (
        sortedDraft.map((field, index) => {
          const isOpen = expanded.has(index);
          const typeInfo = FIELD_TYPES.find((t) => t.value === field.type);

          return (
            <div key={index} className="field-row">
              {/* ── Collapsed header ── */}
              <div
                className="field-row-header"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} field: ${field.label || "Unnamed field"}`}
                onClick={() => toggleExpand(index)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleExpand(index)}
              >
                <div className="field-row-summary">
                  <span className={`field-type-badge ${TYPE_COLORS[field.type] ?? ""}`}>
                    {typeInfo?.label ?? field.type}
                  </span>
                  <span className="field-row-label">
                    {field.label || <em className="field-row-unnamed">Unnamed field</em>}
                  </span>
                  {field.required && (
                    <span className="field-row-required" aria-label="Required">*</span>
                  )}
                  {field.type === "select" && (field.options?.length ?? 0) === 0 && (
                    <span style={{ fontSize: ".72rem", color: "#b91c1c", background: "#fee2e2", borderRadius: 4, padding: "1px 6px", marginLeft: 4 }}>
                      ⚠ No options
                    </span>
                  )}
                </div>

                <div className="field-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button" className="field-move-btn" title="Move up"
                    disabled={index === 0}
                    aria-label={`Move ${field.label || "field"} up`}
                    onClick={() => moveUp(index)}
                  >▲</button>
                  <button
                    type="button" className="field-move-btn" title="Move down"
                    disabled={index === sortedDraft.length - 1}
                    aria-label={`Move ${field.label || "field"} down`}
                    onClick={() => moveDown(index)}
                  >▼</button>
                  <button
                    type="button" className="field-delete-btn" title="Delete field"
                    aria-label={`Delete ${field.label || "field"}`}
                    onClick={() => deleteField(index)}
                  >✕</button>
                </div>
              </div>

              {/* ── Expanded body ── */}
              {isOpen && (
                <div className="field-row-body">
                  <div className="field-row-grid">

                    {/* Label */}
                    <label className="field-row-input-label">
                      <span>Label</span>
                      <input
                        type="text"
                        value={field.label}
                        maxLength={255}
                        placeholder="Human-readable label shown to the user"
                        onChange={(e) => updateField(index, { label: e.target.value })}
                      />
                    </label>

                    {/* Key */}
                    <label className="field-row-input-label">
                      <span>Key <small style={{ color: "#94a3b8" }}>(machine name)</small></span>
                      <input
                        type="text"
                        value={field.key}
                        maxLength={64}
                        placeholder="e.g. college_id"
                        onChange={(e) => updateField(index, { key: e.target.value })}
                      />
                    </label>

                    {/* Type */}
                    <label className="field-row-input-label">
                      <span>Type</span>
                      <select
                        value={field.type}
                        onChange={(e) => changeType(index, e.target.value as FieldType)}
                      >
                        {FIELD_TYPES.map(({ value, label: lbl, hint }) => (
                          <option key={value} value={value} title={hint}>{lbl}</option>
                        ))}
                      </select>
                    </label>

                    {/* Required */}
                    <label className="field-row-input-label field-row-checkbox-label">
                      <span>Required</span>
                      <input
                        type="checkbox"
                        checked={field.required ?? false}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                      />
                    </label>

                    {/* Placeholder — not useful for checkbox or file */}
                    {field.type !== "checkbox" && field.type !== "file" && (
                      <label className="field-row-input-label">
                        <span>Placeholder</span>
                        <input
                          type="text"
                          value={field.placeholder ?? ""}
                          maxLength={255}
                          placeholder="Hint shown inside the input"
                          onChange={(e) => updateField(index, { placeholder: e.target.value || undefined })}
                        />
                      </label>
                    )}

                    {/* Help text */}
                    <label className="field-row-input-label field-row-full">
                      <span>Help text <small style={{ color: "#94a3b8" }}>(optional)</small></span>
                      <input
                        type="text"
                        value={field.help_text ?? ""}
                        maxLength={1000}
                        placeholder="Guidance shown beneath the input"
                        onChange={(e) => updateField(index, { help_text: e.target.value || undefined })}
                      />
                    </label>

                    {/* ── Dropdown options ── */}
                    {field.type === "select" && (
                      <div className="field-row-input-label field-row-full">
                        <label htmlFor={`options-${index}`}>
                          <span>
                            Options{" "}
                            <small style={{ color: "#94a3b8" }}>(one per line, at least one required)</small>
                          </span>
                        </label>
                        <textarea
                          id={`options-${index}`}
                          rows={5}
                          value={(field.options ?? []).join("\n")}
                          placeholder={"Option A\nOption B\nOption C"}
                          style={{
                            border: (field.options?.length ?? 0) === 0 ? "1px solid #fca5a5" : undefined,
                            borderRadius: 8,
                          }}
                          onChange={(e) => {
                            const opts = e.target.value
                              .split("\n")
                              .map((s) => s.trimEnd())
                              .filter((s) => s.length > 0);
                            updateField(index, { options: opts });
                          }}
                        />
                        {(field.options?.length ?? 0) === 0 && (
                          <p style={{ margin: "4px 0 0", color: "#b91c1c", fontSize: ".78rem" }}>
                            Add at least one option — the schema cannot be saved with an empty dropdown.
                          </p>
                        )}
                        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: ".76rem" }}>
                          {field.options?.length ?? 0} option{(field.options?.length ?? 0) !== 1 ? "s" : ""} defined
                        </p>
                      </div>
                    )}

                    {/* ── File upload info ── */}
                    {field.type === "file" && (
                      <div className="field-row-input-label field-row-full">
                        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px", fontSize: ".82rem", color: "#166534" }}>
                          <strong>Accepted formats:</strong> PDF, JPEG, PNG, GIF, WebP<br />
                          <strong>Maximum size:</strong> 10 MB per file<br />
                          <span style={{ color: "#64748b" }}>
                            The uploaded file will be stored securely and linked to the ticket.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      <button type="button" className="field-builder-add" onClick={addField}>
        + Add field
      </button>
    </div>
  );
}
