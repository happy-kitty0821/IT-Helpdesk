"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown, ArrowUp, LayoutGrid, ListChecks,
  Pencil, Plus, Sparkles, Trash2, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  adminGetServices, adminSaveService,
  type AdminService, type ServiceStage,
} from "@/lib/admin-api";
import type { FieldDefinition } from "@/lib/services";
import { FieldBuilder } from "@/components/field-builder";

// ── Seed stage presets ────────────────────────────────────────────────────────

const SEED_STAGES: Record<string, ServiceStage[]> = {
  "id-card-replacement": [
    { key: "received",        label: "Received",          icon: "📥", description: "Your request has been received and is awaiting review." },
    { key: "details-verified",label: "Details Verified",  icon: "✅", description: "Your details have been verified by the IT team." },
    { key: "id-generated",    label: "ID Generated",      icon: "🪪", description: "Your new ID card has been generated." },
    { key: "sent-for-printing",label:"Sent for Printing", icon: "🖨️", description: "Your ID card has been sent to the print queue." },
    { key: "ready-to-collect",label: "Ready to Collect",  icon: "🎉", description: "Your ID card is ready. Please collect it from the IT helpdesk." },
  ],
  "account-recovery": [
    { key: "request-received",  label: "Request Received",  icon: "📥", description: "Your account recovery request has been received." },
    { key: "identity-verified", label: "Identity Verified", icon: "🔍", description: "Your identity has been verified." },
    { key: "account-reset",     label: "Account Reset",     icon: "🔑", description: "Your account has been reset and credentials prepared." },
    { key: "confirmation-sent", label: "Confirmation Sent", icon: "📧", description: "Recovery credentials have been emailed to you." },
  ],
  "college-account-recovery": [
    { key: "request-received",  label: "Request Received",  icon: "📥", description: "Your account recovery request has been received." },
    { key: "identity-verified", label: "Identity Verified", icon: "🔍", description: "Your identity has been verified." },
    { key: "account-reset",     label: "Account Reset",     icon: "🔑", description: "Your account has been reset and credentials prepared." },
    { key: "confirmation-sent", label: "Confirmation Sent", icon: "📧", description: "Recovery credentials have been emailed to you." },
  ],
  "laptop-device-support": [
    { key: "received",    label: "Request Received", icon: "📥", description: "Your device support request has been logged." },
    { key: "diagnosing",  label: "Diagnosing",       icon: "🔎", description: "The IT team is diagnosing the issue." },
    { key: "in-repair",   label: "In Repair",        icon: "🛠️", description: "Your device is being repaired or configured." },
    { key: "ready",       label: "Ready",            icon: "✅", description: "Your device is ready for collection." },
  ],
  "wi-fi-issue": [
    { key: "received",      label: "Report Received",   icon: "📥", description: "Your Wi-Fi issue report has been received." },
    { key: "investigating", label: "Investigating",     icon: "🔍", description: "The NOC team is investigating the issue." },
    { key: "resolved",      label: "Resolved",          icon: "✅", description: "The Wi-Fi issue has been resolved." },
  ],
  "wifi-issue": [
    { key: "received",      label: "Report Received",   icon: "📥", description: "Your Wi-Fi issue report has been received." },
    { key: "investigating", label: "Investigating",     icon: "🔍", description: "The NOC team is investigating the issue." },
    { key: "resolved",      label: "Resolved",          icon: "✅", description: "The Wi-Fi issue has been resolved." },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const defaultDraft = {
  name: "",
  summary: "",
  audience: "public" as AdminService["audience"],
  icon: "",
  sort_order: 0,
  is_active: true,
  form_schema: [] as FieldDefinition[],
  stages: [] as ServiceStage[],
};

type SchemaFieldError = { index?: number; key?: string; error: string };

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

// ── StageBuilder ──────────────────────────────────────────────────────────────

function StageBuilder({
  stages,
  onChange,
}: {
  stages: ServiceStage[];
  onChange: (stages: ServiceStage[]) => void;
}) {
  function addStage() {
    onChange([...stages, { key: `stage-${stages.length + 1}`, label: "", icon: "", description: "" }]);
  }

  function updateStage(idx: number, patch: Partial<ServiceStage>) {
    const next = stages.map((s, i) => {
      if (i !== idx) return s;
      const updated = { ...s, ...patch };
      // Auto-derive key from label unless user manually changed it
      if (patch.label !== undefined && s.key === slugify(s.label)) {
        updated.key = slugify(patch.label);
      }
      return updated;
    });
    onChange(next);
  }

  function removeStage(idx: number) {
    onChange(stages.filter((_, i) => i !== idx));
  }

  function moveStage(idx: number, dir: -1 | 1) {
    const next = [...stages];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div>
      {stages.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: ".85rem", margin: "0 0 12px", textAlign: "center", padding: "16px 0", background: "#f8fafc", borderRadius: 9, border: "1px dashed #cbd5e1" }}>
          No stages defined. Add one below or use a preset.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {stages.map((stage, idx) => (
            <motion.div
              key={idx}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              style={{
                background: "#f8fafc", border: "1px solid #e2e8f0",
                borderRadius: 10, padding: "12px 14px",
              }}
            >
              {/* Top row: icon + label + move + delete */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                <input
                  type="text"
                  value={stage.icon ?? ""}
                  onChange={(e) => updateStage(idx, { icon: e.target.value })}
                  placeholder="Icon"
                  maxLength={4}
                  aria-label={`Stage ${idx + 1} icon`}
                  style={{
                    width: 48, textAlign: "center", border: "1px solid #cbd5e1",
                    borderRadius: 7, padding: "7px 6px", fontSize: "1rem",
                    background: "#fff",
                  }}
                />
                <input
                  type="text"
                  value={stage.label}
                  onChange={(e) => updateStage(idx, { label: e.target.value })}
                  placeholder="Stage label (e.g. Details Verified)"
                  required
                  aria-label={`Stage ${idx + 1} label`}
                  style={{
                    flex: 1, border: "1px solid #cbd5e1", borderRadius: 7,
                    padding: "7px 10px", fontSize: ".9rem", background: "#fff",
                  }}
                />
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => moveStage(idx, -1)}
                    disabled={idx === 0}
                    aria-label="Move stage up"
                    style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 6, padding: "5px 7px", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.4 : 1 }}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStage(idx, 1)}
                    disabled={idx === stages.length - 1}
                    aria-label="Move stage down"
                    style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 6, padding: "5px 7px", cursor: idx === stages.length - 1 ? "not-allowed" : "pointer", opacity: idx === stages.length - 1 ? 0.4 : 1 }}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStage(idx)}
                    aria-label={`Remove stage ${idx + 1}`}
                    style={{ border: "1px solid #fecaca", background: "#fff", borderRadius: 6, padding: "5px 7px", cursor: "pointer", color: "#991b1b" }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Key (editable) */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: ".72rem", color: "#94a3b8", fontWeight: 700, minWidth: 30 }}>key</span>
                <input
                  type="text"
                  value={stage.key}
                  onChange={(e) => updateStage(idx, { key: e.target.value })}
                  placeholder="stage-key"
                  aria-label={`Stage ${idx + 1} key`}
                  style={{
                    flex: 1, border: "1px solid #e2e8f0", borderRadius: 6,
                    padding: "4px 8px", fontSize: ".78rem", fontFamily: "monospace",
                    background: "#fff", color: "#475569",
                  }}
                />
              </div>

              {/* Description */}
              <input
                type="text"
                value={stage.description ?? ""}
                onChange={(e) => updateStage(idx, { description: e.target.value })}
                placeholder="Short description shown to the requester (optional)"
                aria-label={`Stage ${idx + 1} description`}
                style={{
                  width: "100%", border: "1px solid #e2e8f0", borderRadius: 7,
                  padding: "6px 10px", fontSize: ".82rem", background: "#fff",
                }}
              />
            </motion.div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addStage}
        style={{
          width: "100%", border: "1px dashed #94a3b8", background: "transparent",
          borderRadius: 9, padding: "9px 14px", cursor: "pointer", color: "#475569",
          fontSize: ".85rem", fontWeight: 700, display: "flex", alignItems: "center",
          justifyContent: "center", gap: 7,
        }}
      >
        <Plus size={15} aria-hidden="true" /> Add stage
      </button>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceManagement() {
  const [services, setServices] = useState<AdminService[]>([]);
  const [editing, setEditing] = useState<AdminService | null>(null);
  const [creating, setCreating] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savingSchema, setSavingSchema] = useState(false);
  const [savingStages, setSavingStages] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [schemaErrors, setSchemaErrors] = useState<SchemaFieldError[]>([]);

  // Draft fields
  const [draftName, setDraftName] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftAudience, setDraftAudience] = useState<AdminService["audience"]>("public");
  const [draftIcon, setDraftIcon] = useState("");
  const [draftSortOrder, setDraftSortOrder] = useState(0);
  const [draftIsActive, setDraftIsActive] = useState(true);
  const [draftSchema, setDraftSchema] = useState<FieldDefinition[]>([]);
  const [draftStages, setDraftStages] = useState<ServiceStage[]>([]);

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
    setDraftStages(service.stages ?? []);
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
    setDraftStages(defaultDraft.stages);
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

  // Which seed preset applies (match by slug)
  const seedKey = editing?.slug ? (SEED_STAGES[editing.slug] ? editing.slug : null) : null;

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
      if (reason instanceof Error) setError(reason.message);
    } finally {
      setSavingSchema(false);
    }
  }

  // ── Save stages ───────────────────────────────────────────────────────────

  async function saveStages() {
    if (!editingId) {
      setError("Save the category details first before setting stages.");
      return;
    }
    // Validate: every stage must have a non-empty label and key
    const invalid = draftStages.some((s) => !s.label.trim() || !s.key.trim());
    if (invalid) {
      setError("All stages must have a label and a key before saving.");
      return;
    }
    setError("");
    setNotice("");
    setSavingStages(true);
    try {
      const saved = await adminSaveService({ stages: draftStages }, editingId);
      setDraftStages(saved.stages ?? []);
      setEditing((prev) => prev ? { ...prev, stages: saved.stages ?? [] } : prev);
      setNotice("Stages saved.");
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Stages could not be saved.");
    } finally {
      setSavingStages(false);
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
          <p>Manage service categories, dynamic form fields, and ticket progress stages.</p>
        </div>
        <button className="primary-button" onClick={openCreate} aria-label="New category">
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
          <span>Stages</span>
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
              <span style={{ color: "#64748b", fontSize: ".88rem" }}>
                {(service.stages?.length ?? 0) > 0 ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <ListChecks size={13} aria-hidden="true" style={{ color: "#234395" }} />
                    {service.stages.length} stage{service.stages.length !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span style={{ color: "#cbd5e1" }}>—</span>
                )}
              </span>
              <button aria-label={`Edit ${service.name}`} onClick={() => openEditor(service)}>
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

            <form onSubmit={(e) => { e.preventDefault(); saveDetails(); }} style={{ display: "contents" }}>
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

                  {creating ? (
                    <p style={{ color: "#64748b", fontSize: ".85rem", margin: "0 0 12px" }}>
                      Save the category details first to enable schema editing.
                    </p>
                  ) : (
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

                {/* ── Section 3: Progress stages ── */}
                <div className="schema-section">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>
                        <ListChecks size={15} style={{ verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />
                        Progress stages
                      </h3>
                      <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: ".82rem" }}>
                        Stages shown as a visual progress tracker on the requester's ticket page.
                      </p>
                    </div>

                    {/* Seed preset button */}
                    {seedKey && (
                      <button
                        type="button"
                        title={`Load default stages for "${editing?.name}"`}
                        onClick={() => setDraftStages(SEED_STAGES[seedKey])}
                        style={{
                          border: "1px solid #a5b4fc", background: "#eef2ff", color: "#3730a3",
                          borderRadius: 8, padding: "6px 11px", fontSize: ".78rem", fontWeight: 700,
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                          flexShrink: 0,
                        }}
                      >
                        <Sparkles size={13} aria-hidden="true" /> Use defaults
                      </button>
                    )}
                  </div>

                  {creating ? (
                    <p style={{ color: "#64748b", fontSize: ".85rem", margin: 0 }}>
                      Save the category details first to enable stage editing.
                    </p>
                  ) : (
                    <>
                      <StageBuilder stages={draftStages} onChange={setDraftStages} />

                      <div className="editor-actions" style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={saveStages}
                          disabled={savingStages}
                        >
                          {savingStages ? "Saving…" : "Save stages"}
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
