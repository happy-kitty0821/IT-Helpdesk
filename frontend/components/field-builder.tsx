"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldDefinition, FieldType } from "@/lib/services";

interface FieldBuilderProps {
  schema: FieldDefinition[];
  onChange: (schema: FieldDefinition[]) => void;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text",     label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "select",   label: "Dropdown" },
  { value: "email",    label: "Email" },
  { value: "phone",    label: "Phone" },
  { value: "checkbox", label: "Checkbox" },
];

const TYPE_COLORS: Record<FieldType, string> = {
  text:     "badge-text",
  textarea: "badge-textarea",
  select:   "badge-select",
  email:    "badge-email",
  phone:    "badge-phone",
  checkbox: "badge-checkbox",
};

/** Recomputes the `order` property for each field based on array position. */
function withOrder(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.map((f, i) => ({ ...f, order: i }));
}

export function FieldBuilder({ schema, onChange }: FieldBuilderProps) {
  const [draft, setDraft] = useState<FieldDefinition[]>(() => withOrder(schema));
  // Track which row indexes are expanded
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Used to skip the effect when the change comes from inside this component
  const internalChange = useRef(false);

  // Sync draft when the schema prop changes externally (JSON comparison)
  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false;
      return;
    }
    if (JSON.stringify(schema) !== JSON.stringify(draft)) {
      setDraft(withOrder(schema));
      setExpanded(new Set());
    }
    // draft intentionally omitted — we only re-sync when schema changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  /** Commit draft mutation, mark it as internal, and fire onChange. */
  function commit(next: FieldDefinition[]) {
    const ordered = withOrder(next);
    internalChange.current = true;
    setDraft(ordered);
    onChange(ordered);
  }

  function toggleExpand(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function addField() {
    const next = [
      ...draft,
      {
        key: "",
        label: "",
        type: "text" as FieldType,
        required: false,
        order: draft.length,
      },
    ];
    const ordered = withOrder(next);
    internalChange.current = true;
    setDraft(ordered);
    onChange(ordered);
    // Auto-expand the new row
    setExpanded((prev) => new Set(prev).add(ordered.length - 1));
  }

  function deleteField(index: number) {
    const next = draft.filter((_, i) => i !== index);
    // Shift expanded indexes down
    setExpanded((prev) => {
      const next2 = new Set<number>();
      for (const idx of prev) {
        if (idx < index) next2.add(idx);
        else if (idx > index) next2.add(idx - 1);
        // idx === index is removed
      }
      return next2;
    });
    commit(next);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...draft];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    // Update expanded set to follow the swapped rows
    setExpanded((prev) => {
      const next2 = new Set(prev);
      const hadPrev = next2.has(index - 1);
      const hadCurr = next2.has(index);
      if (hadPrev) next2.add(index); else next2.delete(index);
      if (hadCurr) next2.add(index - 1); else next2.delete(index - 1);
      return next2;
    });
    commit(next);
  }

  function moveDown(index: number) {
    if (index === draft.length - 1) return;
    const next = [...draft];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setExpanded((prev) => {
      const next2 = new Set(prev);
      const hadCurr = next2.has(index);
      const hadNext = next2.has(index + 1);
      if (hadCurr) next2.add(index + 1); else next2.delete(index + 1);
      if (hadNext) next2.add(index); else next2.delete(index);
      return next2;
    });
    commit(next);
  }

  function updateField(index: number, patch: Partial<FieldDefinition>) {
    const next = draft.map((f, i) => (i === index ? { ...f, ...patch } : f));
    commit(next);
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
          return (
            <div key={index} className="field-row">
              {/* ── Header (always visible) ── */}
              <div
                className="field-row-header"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggleExpand(index)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleExpand(index)}
              >
                <div className="field-row-summary">
                  <span className={`field-type-badge ${TYPE_COLORS[field.type]}`}>
                    {field.type}
                  </span>
                  <span className="field-row-label">
                    {field.label || <em className="field-row-unnamed">Unnamed field</em>}
                  </span>
                  {field.required && (
                    <span className="field-row-required" aria-label="Required field">*</span>
                  )}
                </div>

                <div className="field-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="field-move-btn"
                    title="Move up"
                    disabled={index === 0}
                    aria-label={`Move ${field.label || "field"} up`}
                    onClick={() => moveUp(index)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="field-move-btn"
                    title="Move down"
                    disabled={index === sortedDraft.length - 1}
                    aria-label={`Move ${field.label || "field"} down`}
                    onClick={() => moveDown(index)}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="field-delete-btn"
                    title="Delete field"
                    aria-label={`Delete ${field.label || "field"}`}
                    onClick={() => deleteField(index)}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* ── Expanded body ── */}
              {isOpen && (
                <div className="field-row-body">
                  <div className="field-row-grid">
                    {/* Key */}
                    <label className="field-row-input-label">
                      <span>Key</span>
                      <input
                        type="text"
                        value={field.key}
                        maxLength={64}
                        placeholder="machine_key"
                        onChange={(e) => updateField(index, { key: e.target.value })}
                      />
                    </label>

                    {/* Label */}
                    <label className="field-row-input-label">
                      <span>Label</span>
                      <input
                        type="text"
                        value={field.label}
                        maxLength={255}
                        placeholder="Human-readable label"
                        onChange={(e) => updateField(index, { label: e.target.value })}
                      />
                    </label>

                    {/* Type */}
                    <label className="field-row-input-label">
                      <span>Type</span>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateField(index, {
                            type: e.target.value as FieldType,
                            // Clear options when switching away from select
                            options: e.target.value === "select" ? (field.options ?? []) : undefined,
                          })
                        }
                      >
                        {FIELD_TYPES.map(({ value, label: lbl }) => (
                          <option key={value} value={value}>{lbl}</option>
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

                    {/* Placeholder */}
                    <label className="field-row-input-label">
                      <span>Placeholder</span>
                      <input
                        type="text"
                        value={field.placeholder ?? ""}
                        maxLength={255}
                        placeholder="Optional hint shown inside the input"
                        onChange={(e) =>
                          updateField(index, { placeholder: e.target.value || undefined })
                        }
                      />
                    </label>

                    {/* Help text */}
                    <label className="field-row-input-label field-row-full">
                      <span>Help text</span>
                      <input
                        type="text"
                        value={field.help_text ?? ""}
                        maxLength={1000}
                        placeholder="Optional guidance shown beneath the input"
                        onChange={(e) =>
                          updateField(index, { help_text: e.target.value || undefined })
                        }
                      />
                    </label>

                    {/* Options — only for select type */}
                    {field.type === "select" && (
                      <label className="field-row-input-label field-row-full">
                        <span>Options <small>(one per line)</small></span>
                        <textarea
                          rows={4}
                          value={(field.options ?? []).join("\n")}
                          placeholder={"Option A\nOption B\nOption C"}
                          onChange={(e) =>
                            updateField(index, {
                              options: e.target.value
                                .split("\n")
                                .map((s) => s.trimEnd())
                                .filter((s) => s.length > 0),
                            })
                          }
                        />
                      </label>
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
