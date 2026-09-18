"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown, ArrowUp, Badge, Camera, GitBranch, KeyRound,
  Laptop, LayoutGrid, LifeBuoy, ListChecks,
  Pencil, Plus, Sparkles, Trash2, Wifi, X,
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
    { key: "received",         label: "Received",          icon: "📥", description: "Your request has been received and is awaiting review." },
    { key: "details-verified", label: "Details Verified",  icon: "✅", description: "Your details have been verified by the IT team." },
    { key: "id-generated",     label: "ID Generated",      icon: "🪪", description: "Your new ID card has been generated." },
    { key: "sent-for-printing",label: "Sent for Printing", icon: "🖨️", description: "Your ID card has been sent to the print queue." },
    { key: "ready-to-collect", label: "Ready to Collect",  icon: "🎉", description: "Your ID card is ready. Please collect it from the IT helpdesk." },
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
    { key: "received",   label: "Request Received", icon: "📥", description: "Your device support request has been logged." },
    { key: "diagnosing", label: "Diagnosing",       icon: "🔎", description: "The IT team is diagnosing the issue." },
    { key: "in-repair",  label: "In Repair",        icon: "🛠️", description: "Your device is being repaired or configured." },
    { key: "ready",      label: "Ready",            icon: "✅", description: "Your device is ready for collection." },
  ],
  "wi-fi-issue": [
    { key: "received",      label: "Report Received", icon: "📥", description: "Your Wi-Fi issue report has been received." },
    { key: "investigating", label: "Investigating",   icon: "🔍", description: "The NOC team is investigating the issue." },
    { key: "resolved",      label: "Resolved",        icon: "✅", description: "The Wi-Fi issue has been resolved." },
  ],
  "wifi-issue": [
    { key: "received",      label: "Report Received", icon: "📥", description: "Your Wi-Fi issue report has been received." },
    { key: "investigating", label: "Investigating",   icon: "🔍", description: "The NOC team is investigating the issue." },
    { key: "resolved",      label: "Resolved",        icon: "✅", description: "The Wi-Fi issue has been resolved." },
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

// ── Audience badge styles ─────────────────────────────────────────────────────

const AUDIENCE_BADGE: Record<AdminService["audience"], { label: string; bg: string; color: string }> = {
  public:  { label: "Public",           bg: "#f1f5f9", color: "#475569" },
  student: { label: "Students",         bg: "#eef2ff", color: "#3730a3" },
  staff:   { label: "Faculty & staff",  bg: "#f0fdf4", color: "#166534" },
  all:     { label: "All users",        bg: "#faf5ff", color: "#6d28d9" },
};


// -- Icon map (mirrors service-grid.tsx)
import type { LucideProps as _LP } from "lucide-react";

const SERVICE_ICONS: Record<string, React.ComponentType<_LP>> = {
  "key-round": KeyRound,
  laptop:      Laptop,
  badge:       Badge,
  wifi:        Wifi,
  camera:      Camera,
  "life-buoy": LifeBuoy,
};

function ServiceIcon({ name }: { name: string }) {
  const Icon = SERVICE_ICONS[name] ?? LifeBuoy;
  return <Icon aria-hidden="true" size={22} />;
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

              <input
                type="text"
                value={stage.description ?? ""}
                onChange={(e) => updateStage(idx, { description: e.target.value })}
                placeholder="Short description shown to the requester (optional)"
                aria-label={`Stage ${idx + 1} description`}
                style={{
                  width: "100%", border: "1px solid #e2e8f0", borderRadius: 7,
                  padding: "6px 10px", fontSize: ".82rem", background: "#fff",
                  boxSizing: "border-box",
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

// ── Inline styles helpers ─────────────────────────────────────────────────────

const fieldLabelStyle: React.CSSProperties = {
  fontSize: ".8rem", fontWeight: 700, color: "#374151", marginBottom: 4, display: "block",
};

const inputStyle: React.CSSProperties = {
  border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "9px 11px",
  fontSize: ".9rem", width: "100%", boxSizing: "border-box", background: "#fff",
  color: "#0f172a",
};

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

  // Tab state
  const [activeTab, setActiveTab] = useState<"details" | "fields" | "stages">("details");

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
    setActiveTab("details");
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
    setActiveTab("details");
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

      {/* ── Card grid ── */}
      {services.length === 0 ? (
        <div className="empty-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LayoutGrid aria-hidden="true" style={{ width: 22, color: "#234395" }} />
          <span>No service categories yet. Create one to get started.</span>
        </div>
      ) : (
        <section className="service-card-grid" aria-label="Service categories">
          {services.map((service, index) => {
            const aud = AUDIENCE_BADGE[service.audience];
            return (
              <motion.article
                key={service.id}
                className="service-card"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.04, 0.2) }}
              >
                {/* Card header row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {/* Icon square */}
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, background: "#eef2ff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#234395", flexShrink: 0,
                  }}>
                    <ServiceIcon name={service.icon} />
                  </div>
                  {/* Name + chip */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <strong style={{ fontSize: "1rem", lineHeight: 1.35 }}>{service.name}</strong>
                      <span className={`status-chip ${service.is_active ? "active" : "archived"}`} style={{ flexShrink: 0 }}>
                        {service.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <p style={{
                  margin: 0, fontSize: ".84rem", color: "#64748b", lineHeight: 1.5,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>
                  {service.summary || <em>No summary</em>}
                </p>

                {/* Footer row */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                  {/* Audience badge */}
                  <span style={{
                    fontSize: ".73rem", fontWeight: 700, borderRadius: 6, padding: "3px 8px",
                    background: aud.bg, color: aud.color,
                  }}>
                    {aud.label}
                  </span>

                  {/* Field count */}
                  <span style={{
                    fontSize: ".73rem", color: "#64748b", background: "#f1f5f9",
                    borderRadius: 6, padding: "3px 8px",
                  }}>
                    {service.form_schema?.length ?? 0} {(service.form_schema?.length ?? 0) === 1 ? "field" : "fields"}
                  </span>

                  {/* Stage count */}
                  {(service.stages?.length ?? 0) > 0 ? (
                    <span style={{
                      fontSize: ".73rem", color: "#234395", background: "#eef2ff",
                      borderRadius: 6, padding: "3px 8px",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                      <ListChecks size={11} aria-hidden="true" />
                      {service.stages.length} stage{service.stages.length !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span style={{ fontSize: ".73rem", color: "#cbd5e1", background: "#f8fafc", borderRadius: 6, padding: "3px 8px" }}>
                      No stages
                    </span>
                  )}

                  {/* Edit button — pushed right */}
                  <button
                    aria-label={`Edit ${service.name}`}
                    onClick={() => openEditor(service)}
                    style={{
                      marginLeft: "auto", border: "1px solid #e2e8f0", background: "#f8fafc",
                      borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "#475569",
                      display: "flex", alignItems: "center", gap: 5, fontSize: ".78rem", fontWeight: 600,
                    }}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                </div>
              </motion.article>
            );
          })}
        </section>
      )}

      {/* ── Editor panel ── */}
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
            style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}
          >
            {/* Fixed panel header */}
            <header style={{ borderBottom: "1px solid #e2e8f0", padding: "18px 22px 0", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <span style={{ fontSize: ".75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>
                    {creating ? "New category" : "Edit category"}
                  </span>
                  <h2 style={{ margin: "2px 0 0", fontSize: "1.05rem" }}>
                    {creating ? "Create service category" : (editing?.name ?? "")}
                  </h2>
                </div>
                <button
                  aria-label="Close editor"
                  onClick={closeEditor}
                  style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "#64748b" }}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              {/* Tab bar */}
              <div className="svc-tab-bar" style={{ margin: "0 -22px" }}>
                <button
                  type="button"
                  className={`svc-tab${activeTab === "details" ? " active" : ""}`}
                  onClick={() => setActiveTab("details")}
                >
                  <LayoutGrid aria-hidden="true" /> Details
                </button>
                <button
                  type="button"
                  className={`svc-tab${activeTab === "fields" ? " active" : ""}`}
                  onClick={() => { if (!creating) setActiveTab("fields"); }}
                  disabled={creating}
                  title={creating ? "Save details first" : undefined}
                >
                  <ListChecks aria-hidden="true" /> Form Fields
                </button>
                <button
                  type="button"
                  className={`svc-tab${activeTab === "stages" ? " active" : ""}`}
                  onClick={() => { if (!creating) setActiveTab("stages"); }}
                  disabled={creating}
                  title={creating ? "Save details first" : undefined}
                >
                  <GitBranch aria-hidden="true" /> Stages
                </button>
              </div>
            </header>

            {/* ── Details tab ── */}
            {activeTab === "details" && (
              <>
                <form
                  id="details-form"
                  onSubmit={(e) => { e.preventDefault(); saveDetails(); }}
                  style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "20px 22px" }}>
                    {/* Name */}
                    <div>
                      <label htmlFor="svc-name" style={fieldLabelStyle}>Name</label>
                      <input
                        id="svc-name"
                        type="text"
                        value={draftName}
                        required
                        maxLength={100}
                        placeholder="e.g. Laptop & device support"
                        onChange={(e) => setDraftName(e.target.value)}
                        style={inputStyle}
                      />
                    </div>

                    {/* Summary */}
                    <div>
                      <label htmlFor="svc-summary" style={fieldLabelStyle}>Summary</label>
                      <textarea
                        id="svc-summary"
                        rows={3}
                        value={draftSummary}
                        maxLength={240}
                        placeholder="Brief description shown on the service card."
                        onChange={(e) => setDraftSummary(e.target.value)}
                        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                      />
                    </div>

                    {/* Audience + Icon row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label htmlFor="svc-audience" style={fieldLabelStyle}>Audience</label>
                        <select
                          id="svc-audience"
                          value={draftAudience}
                          onChange={(e) => setDraftAudience(e.target.value as AdminService["audience"])}
                          style={inputStyle}
                        >
                          <option value="public">Public</option>
                          <option value="student">Students</option>
                          <option value="staff">Faculty &amp; staff</option>
                          <option value="all">Students &amp; staff</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="svc-icon" style={fieldLabelStyle}>Icon name</label>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            id="svc-icon"
                            type="text"
                            value={draftIcon}
                            maxLength={32}
                            placeholder="life-buoy"
                            onChange={(e) => setDraftIcon(e.target.value)}
                            style={{ ...inputStyle, flex: 1, width: "auto" }}
                          />
                          <div style={{
                            width: 40, height: 40, borderRadius: 8, background: "#eef2ff",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "1.1rem", flexShrink: 0, border: "1.5px solid #e2e8f0",
                          }}
                            aria-label="Icon preview"
                          >
                            <ServiceIcon name={draftIcon} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Sort order + Active row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label htmlFor="svc-sort" style={fieldLabelStyle}>Sort order</label>
                        <input
                          id="svc-sort"
                          type="number"
                          min={0}
                          value={draftSortOrder}
                          onChange={(e) => setDraftSortOrder(Number(e.target.value))}
                          style={inputStyle}
                        />
                      </div>

                      <div>
                        <span style={fieldLabelStyle}>Active</span>
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "9px 11px",
                          background: "#fff", cursor: "pointer",
                        }}
                          onClick={() => setDraftIsActive((v) => !v)}
                        >
                          <span style={{ fontSize: ".88rem", color: draftIsActive ? "#166534" : "#64748b" }}>
                            {draftIsActive ? "Enabled" : "Disabled"}
                          </span>
                          <input
                            type="checkbox"
                            checked={draftIsActive}
                            onChange={(e) => setDraftIsActive(e.target.checked)}
                            style={{ width: 18, height: 18, accentColor: "#234395", cursor: "pointer" }}
                            aria-label="Service active"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </form>

                {/* Footer */}
                <div style={{
                  borderTop: "1px solid #e2e8f0", padding: "14px 22px",
                  background: "#f8fafc", display: "flex", justifyContent: "flex-end",
                  gap: 10, flexShrink: 0,
                }}>
                  <button type="button" className="secondary-button" onClick={closeEditor}>
                    Cancel
                  </button>
                  <button
                    form="details-form"
                    className="primary-button"
                    type="submit"
                    disabled={saving}
                  >
                    {saving ? "Saving…" : creating ? "Create category" : "Save details"}
                  </button>
                </div>
              </>
            )}

            {/* ── Form Fields tab ── */}
            {activeTab === "fields" && (
              <>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <p style={{ margin: 0, fontSize: ".8rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em" }}>
                      Form fields
                    </p>

                    {creating ? (
                      <p style={{ color: "#64748b", fontSize: ".85rem", margin: 0 }}>
                        Save the category details first to enable schema editing.
                      </p>
                    ) : (
                      <>
                        <FieldBuilder schema={draftSchema} onChange={setDraftSchema} />

                        {schemaErrors.length > 0 && (
                          <ul style={{ margin: 0, padding: "0 0 0 18px", color: "#b91c1c", fontSize: ".85rem" }}>
                            {schemaErrors.map((e, i) => (
                              <li key={i}>
                                {e.key ? `"${e.key}"` : `Field ${(e.index ?? 0) + 1}`}: {e.error}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {!creating && (
                  <div style={{
                    borderTop: "1px solid #e2e8f0", padding: "14px 22px",
                    background: "#f8fafc", display: "flex", justifyContent: "flex-end",
                    gap: 10, flexShrink: 0,
                  }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={saveSchema}
                      disabled={savingSchema}
                    >
                      {savingSchema ? "Saving…" : "Save schema"}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Stages tab ── */}
            {activeTab === "stages" && (
              <>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* Section header + preset button */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <p style={{ margin: 0, fontSize: ".8rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em" }}>
                          Progress stages
                        </p>
                        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: ".82rem" }}>
                          Stages shown as a visual progress tracker on the requester&apos;s ticket page.
                        </p>
                      </div>

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
                      <StageBuilder stages={draftStages} onChange={setDraftStages} />
                    )}
                  </div>
                </div>

                {!creating && (
                  <div style={{
                    borderTop: "1px solid #e2e8f0", padding: "14px 22px",
                    background: "#f8fafc", display: "flex", justifyContent: "flex-end",
                    gap: 10, flexShrink: 0,
                  }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={saveStages}
                      disabled={savingStages}
                    >
                      {savingStages ? "Saving…" : "Save stages"}
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
