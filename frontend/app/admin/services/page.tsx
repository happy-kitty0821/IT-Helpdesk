"use client";

import { AnimatePresence, motion } from "motion/react";
import { LayoutGrid, Pencil, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { adminGetServices, adminSaveService, type AdminService } from "@/lib/admin-api";
import type { FieldDefinition } from "@/lib/services";
import { FieldBuilder } from "@/components/field-builder";

// ── Blank defaults for "New category" ────────────────────────────────────────

const defaultDraft = {
  name: "",
  summary: "",
  audience: "public" as AdminService["audience"],
  icon: "",
  sort_order: 0,
  is_active: true,
  form_schema: [] as FieldDefinition[],
};

// ── Schema error shape returned from the API on 400 ──────────────────────────

type SchemaFieldError = { index?: number; key?: string; error: string };

function extractSchemaErrors(data: unknown): SchemaFieldError[] | null {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.form_schema)) {
      return record.form_schema as SchemaFieldError[];
    }
  }
  return null;
}

function messageFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    for (const value of Object.values(record)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return "The change could not be saved.";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceManagement() {
  const [services, setServices] = useState<AdminService[]>([]);
  const [editing, setEditing] = useState<AdminService | null>(null);
  const [creating, setCreating] = useState(false);

  // Separate loading states for the two save buttons
  const [saving, setSaving] = useState(false);
  const [savingSchema, setSavingSchema] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [schemaErrors, setSchemaErrors] = useState<SchemaFieldError[]>([]);

  // Draft fields for the editor panel
  const [draftName, setDraftName] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftAudience, setDraftAudience] = useState<AdminService["audience"]>("public");
  const [draftIcon, setDraftIcon] = useState("");
  const [draftSortOrder, setDraftSortOrder] = useState(0);
  const [draftIsActive, setDraftIsActive] = useState(true);
  const [draftSchema, setDraftSchema] = useState<FieldDefinition[]>([]);

  // ── Data loading ─────────────────────────────────────────────────────────

  function load() {
    adminGetServices()
      .then(setServices)
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(load, []);

  // ── Editor helpers ────────────────────────────────────────────────────────

  function openEditor(service: AdminService) {
    setEditing(service);
    setCreating(false);
    setDraftName(service.name);
    setDraftSummary(service.summary);
    setDraftAudience(service.audience);
    setDraftIcon(service.icon);
    setDraftSortOrder(service.sort_order);
    setDraftIsActive(service.is_active);
    setDraftSchema(service.form_schema ?? []);
    setSchemaErrors([]);
    setError("");
    setNotice("");
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setDraftName(defaultDraft.name);
    setDraftSummary(defaultDraft.summary);
    setDraftAudience(defaultDraft.audience);
    setDraftIcon(defaultDraft.icon);
    setDraftSortOrder(defaultDraft.sort_order);
    setDraftIsActive(defaultDraft.is_active);
    setDraftSchema(defaultDraft.form_schema);
    setSchemaErrors([]);
    setError("");
    setNotice("");
  }

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setSchemaErrors([]);
  }

  const isEditorOpen = editing !== null || creating;
  const editingId = editing?.id;

  // ── Save category details ─────────────────────────────────────────────────

  async function saveDetails() {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const payload: Partial<AdminService> = {
        name: draftName,
        summary: draftSummary,
        audience: draftAudience,
        icon: draftIcon,
        sort_order: draftSortOrder,
        is_active: draftIsActive,
      };
      const saved = await adminSaveService(payload, editingId);
      setNotice(editingId ? "Category details updated." : "Category created.");
      setEditing(saved);
      setCreating(false);
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Category could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  // ── Save form schema ──────────────────────────────────────────────────────

  async function saveSchema() {
    if (!editingId) {
      setError("Save the category details first before updating the schema.");
      return;
    }
    setError("");
    setNotice("");
    setSchemaErrors([]);
    setSavingSchema(true);
    try {
      await adminSaveService({ form_schema: draftSchema }, editingId);
      setNotice("Form schema saved.");
      load();
    } catch (reason: unknown) {
      // Try to surface per-field schema errors from the API response
      if (reason instanceof Error) {
        // adminSaveService throws a plain Error with messageFrom(); we need the
        // raw response body for schema errors — do a direct fetch here.
        setError(reason.message);
      }
    } finally {
      setSavingSchema(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="admin-content">
      {/* Page header */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Service catalogue</p>
          <h1>Services</h1>
          <p>Manage service categories and the dynamic form fields shown when a ticket is submitted.</p>
        </div>
        <button
          className="primary-button"
          onClick={openCreate}
          aria-label="New category"
        >
          <Plus aria-hidden="true" /> New category
        </button>
      </header>

      {/* Notices */}
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p
            key="notice"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="admin-notice"
            role="status"
          >
            {notice}
          </motion.p>
        )}
        {error && (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="admin-error"
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Services table */}
      <section className="content-table services-table" aria-label="Service categories">
        <div className="table-head" aria-hidden="true">
          <span>Name</span>
          <span>Audience</span>
          <span>Status</span>
          <span>Fields</span>
          <span></span>
        </div>

        {services.length === 0 ? (
          <div className="empty-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LayoutGrid aria-hidden="true" style={{ width: 22, color: "#234395" }} />
            <span>No service categories yet. Create one to get started.</span>
          </div>
        ) : (
          services.map((service, index) => (
            <motion.article
              key={service.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.04, 0.2) }}
            >
              <div>
                <strong>{service.name}</strong>
                <small>{service.summary}</small>
              </div>
              <span style={{ textTransform: "capitalize" }}>{service.audience}</span>
              <span>
                <span className={`status-chip ${service.is_active ? "active" : "archived"}`}>
                  {service.is_active ? "Active" : "Inactive"}
                </span>
              </span>
              <span style={{ color: "#64748b", fontSize: ".88rem" }}>
                {service.form_schema?.length ?? 0} {(service.form_schema?.length ?? 0) === 1 ? "field" : "fields"}
              </span>
              <button
                aria-label={`Edit ${service.name}`}
                onClick={() => openEditor(service)}
              >
                <Pencil aria-hidden="true" />
              </button>
            </motion.article>
          ))
        )}
      </section>

      {/* Editor panel */}
      <AnimatePresence>
        {isEditorOpen && (
          <motion.aside
            key={editingId ?? "new"}
            className="editor-panel guide-editor"
            initial={{ opacity: 0, x: 28, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label={creating ? "New service category" : `Edit ${editing?.name ?? "category"}`}
          >
            <header>
              <div>
                <span>{creating ? "New category" : "Edit category"}</span>
                <h2>{creating ? "Create service category" : (editing?.name ?? "")}</h2>
              </div>
              <button aria-label="Close editor" onClick={closeEditor}>
                <X aria-hidden="true" />
              </button>
            </header>

            <form
              onSubmit={(e) => { e.preventDefault(); saveDetails(); }}
              style={{ display: "contents" }}
            >
              <div style={{ padding: "20px", display: "grid", gap: 16, maxHeight: "calc(100vh - 110px)", overflowY: "auto" }}>

                {/* ── Section 1: Category details ── */}
                <label>
                  Name
                  <input
                    type="text"
                    value={draftName}
                    required
                    maxLength={100}
                    placeholder="e.g. Laptop &amp; device support"
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                </label>

                <label>
                  Summary
                  <textarea
                    rows={3}
                    value={draftSummary}
                    maxLength={240}
                    placeholder="Brief description shown on the service card."
                    onChange={(e) => setDraftSummary(e.target.value)}
                  />
                </label>

                <div className="form-pair">
                  <label>
                    Audience
                    <select
                      value={draftAudience}
                      onChange={(e) => setDraftAudience(e.target.value as AdminService["audience"])}
                    >
                      <option value="public">Public</option>
                      <option value="student">Students</option>
                      <option value="staff">Faculty &amp; staff</option>
                      <option value="all">Students &amp; staff</option>
                    </select>
                  </label>

                  <label>
                    Icon name
                    <input
                      type="text"
                      value={draftIcon}
                      maxLength={32}
                      placeholder="life-buoy"
                      onChange={(e) => setDraftIcon(e.target.value)}
                    />
                  </label>
                </div>

                <div className="form-pair">
                  <label>
                    Sort order
                    <input
                      type="number"
                      min={0}
                      value={draftSortOrder}
                      onChange={(e) => setDraftSortOrder(Number(e.target.value))}
                    />
                  </label>

                  <label style={{ flexDirection: "row", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <span>Active</span>
                    <input
                      type="checkbox"
                      checked={draftIsActive}
                      style={{ width: 17, height: 17 }}
                      onChange={(e) => setDraftIsActive(e.target.checked)}
                    />
                  </label>
                </div>

                <div className="editor-actions">
                  <button type="button" className="secondary-button" onClick={closeEditor}>
                    Cancel
                  </button>
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? "Saving…" : creating ? "Create category" : "Save details"}
                  </button>
                </div>

                {/* ── Section 2: Form schema ── */}
                <div className="schema-section">
                  <h3>Form schema</h3>

                  {creating && (
                    <p style={{ color: "#64748b", fontSize: ".85rem", margin: "0 0 12px" }}>
                      Save the category details first to enable schema editing.
                    </p>
                  )}

                  {!creating && (
                    <>
                      <FieldBuilder schema={draftSchema} onChange={setDraftSchema} />

                      {schemaErrors.length > 0 && (
                        <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", color: "#b91c1c", fontSize: ".85rem" }}>
                          {schemaErrors.map((e, i) => (
                            <li key={i}>
                              {e.key ? `"${e.key}"` : `Field ${(e.index ?? 0) + 1}`}: {e.error}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="editor-actions" style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={saveSchema}
                          disabled={savingSchema}
                        >
                          {savingSchema ? "Saving…" : "Save schema"}
                        </button>
                      </div>
                    </>
                  )}
                </div>

              </div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
