"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown, ArrowUp, Badge, Camera, CheckCircle2,
  GitBranch, KeyRound, Laptop, LayoutGrid, LifeBuoy,
  ListChecks, Pencil, Plus, Sparkles, Trash2, Wifi, X,
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
    { key: "received",          label: "Received",           icon: "📥", description: "Your request has been received and is awaiting review." },
    { key: "details-verified",  label: "Details Verified",   icon: "✅", description: "Your details have been verified by the IT team." },
    { key: "id-generated",      label: "ID Generated",       icon: "🪪", description: "Your new ID card has been generated." },
    { key: "sent-for-printing", label: "Sent for Printing",  icon: "🖨️", description: "Your ID card has been sent to the print queue." },
    { key: "ready-to-collect",  label: "Ready to Collect",   icon: "🎉", description: "Your ID card is ready. Please collect it from the IT helpdesk." },
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
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");
}

const defaultDraft = {
  name: "", summary: "",
  audience: "public" as AdminService["audience"],
  icon: "", sort_order: 0, is_active: true,
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

const AUDIENCE_META: Record<AdminService["audience"], { label: string; bg: string; color: string; dot: string }> = {
  public:  { label: "Public",          bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
  student: { label: "Students",        bg: "#eef2ff", color: "#3730a3", dot: "#818cf8" },
  staff:   { label: "Faculty & staff", bg: "#f0fdf4", color: "#15803d", dot: "#4ade80" },
  all:     { label: "All users",       bg: "#faf5ff", color: "#7c3aed", dot: "#c084fc" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SERVICE_ICONS: Record<string, React.ComponentType<any>> = {
  "key-round": KeyRound, laptop: Laptop, badge: Badge,
  wifi: Wifi, camera: Camera, "life-buoy": LifeBuoy,
};

function ServiceIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Icon = SERVICE_ICONS[name] ?? LifeBuoy;
  return <Icon aria-hidden="true" size={size} />;
}

// ── StageBuilder ──────────────────────────────────────────────────────────────

function StageBuilder({ stages, onChange }: { stages: ServiceStage[]; onChange: (s: ServiceStage[]) => void }) {
  function addStage() {
    onChange([...stages, { key: `stage-${stages.length + 1}`, label: "", icon: "", description: "" }]);
  }
  function updateStage(idx: number, patch: Partial<ServiceStage>) {
    onChange(stages.map((s, i) => {
      if (i !== idx) return s;
      const updated = { ...s, ...patch };
      if (patch.label !== undefined && s.key === slugify(s.label)) updated.key = slugify(patch.label);
      return updated;
    }));
  }
  function removeStage(idx: number) { onChange(stages.filter((_, i) => i !== idx)); }
  function moveStage(idx: number, dir: -1 | 1) {
    const next = [...stages]; const t = idx + dir;
    if (t < 0 || t >= next.length) return;
    [next[idx], next[t]] = [next[t], next[idx]]; onChange(next);
  }

  return (
    <div className="stage-builder">
      {stages.length === 0 ? (
        <div className="stage-empty">
          <GitBranch size={22} aria-hidden="true" />
          <p>No stages defined. Add one below or use a preset.</p>
        </div>
      ) : (
        <div className="stage-list">
          {stages.map((stage, idx) => (
            <motion.div key={idx} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="stage-row">

              {/* Step number */}
              <div className="stage-number">{idx + 1}</div>

              {/* Main fields */}
              <div className="stage-fields">
                <div className="stage-top-row">
                  <input type="text" value={stage.icon ?? ""} onChange={(e) => updateStage(idx, { icon: e.target.value })}
                    placeholder="📥" maxLength={4} aria-label={`Stage ${idx + 1} icon`} className="stage-icon-input" />
                  <input type="text" value={stage.label} onChange={(e) => updateStage(idx, { label: e.target.value })}
                    placeholder="Stage label" required aria-label={`Stage ${idx + 1} label`} className="stage-label-input" />
                </div>
                <div className="stage-key-row">
                  <span className="stage-key-label">key</span>
                  <input type="text" value={stage.key} onChange={(e) => updateStage(idx, { key: e.target.value })}
                    placeholder="stage-key" aria-label={`Stage ${idx + 1} key`} className="stage-key-input" />
                </div>
                <input type="text" value={stage.description ?? ""} onChange={(e) => updateStage(idx, { description: e.target.value })}
                  placeholder="Short description shown to the requester (optional)"
                  aria-label={`Stage ${idx + 1} description`} className="stage-desc-input" />
              </div>

              {/* Actions */}
              <div className="stage-actions">
                <button type="button" onClick={() => moveStage(idx, -1)} disabled={idx === 0}
                  aria-label="Move stage up" className="stage-btn" style={{ opacity: idx === 0 ? 0.35 : 1 }}>
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => moveStage(idx, 1)} disabled={idx === stages.length - 1}
                  aria-label="Move stage down" className="stage-btn" style={{ opacity: idx === stages.length - 1 ? 0.35 : 1 }}>
                  <ArrowDown size={13} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => removeStage(idx)} aria-label={`Remove stage ${idx + 1}`}
                  className="stage-btn stage-btn--danger">
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <button type="button" onClick={addStage} className="stage-add-btn">
        <Plus size={14} aria-hidden="true" /> Add stage
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

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

  const [activeTab, setActiveTab] = useState<"details" | "fields" | "stages">("details");

  const [draftName, setDraftName] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftAudience, setDraftAudience] = useState<AdminService["audience"]>("public");
  const [draftIcon, setDraftIcon] = useState("");
  const [draftSortOrder, setDraftSortOrder] = useState(0);
  const [draftIsActive, setDraftIsActive] = useState(true);
  const [draftSchema, setDraftSchema] = useState<FieldDefinition[]>([]);
  const [draftStages, setDraftStages] = useState<ServiceStage[]>([]);

  function load() {
    adminGetServices().then(setServices).catch((e: Error) => setError(e.message));
  }
  useEffect(load, []);

  function openEditor(service: AdminService) {
    setEditing(service); setCreating(false); setActiveTab("details");
    setDraftName(service.name); setDraftSummary(service.summary);
    setDraftAudience(service.audience); setDraftIcon(service.icon);
    setDraftSortOrder(service.sort_order); setDraftIsActive(service.is_active);
    setDraftSchema(service.form_schema ?? []); setDraftStages(service.stages ?? []);
    setSchemaErrors([]); setError(""); setNotice("");
  }

  function openCreate() {
    setEditing(null); setCreating(true); setActiveTab("details");
    setDraftName(defaultDraft.name); setDraftSummary(defaultDraft.summary);
    setDraftAudience(defaultDraft.audience); setDraftIcon(defaultDraft.icon);
    setDraftSortOrder(defaultDraft.sort_order); setDraftIsActive(defaultDraft.is_active);
    setDraftSchema(defaultDraft.form_schema); setDraftStages(defaultDraft.stages);
    setSchemaErrors([]); setError(""); setNotice("");
  }

  function closeEditor() { setEditing(null); setCreating(false); setSchemaErrors([]); }

  const isEditorOpen = editing !== null || creating;
  const editingId = editing?.id;
  const seedKey = editing?.slug ? (SEED_STAGES[editing.slug] ? editing.slug : null) : null;

  async function saveDetails() {
    setError(""); setNotice(""); setSaving(true);
    try {
      const saved = await adminSaveService({ name: draftName, summary: draftSummary, audience: draftAudience, icon: draftIcon, sort_order: draftSortOrder, is_active: draftIsActive }, editingId);
      setNotice(editingId ? "Category updated." : "Category created.");
      setEditing(saved); setCreating(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setSaving(false); }
  }

  async function saveSchema() {
    if (!editingId) { setError("Save details first."); return; }
    setError(""); setNotice(""); setSchemaErrors([]); setSavingSchema(true);
    try { await adminSaveService({ form_schema: draftSchema }, editingId); setNotice("Form schema saved."); load(); }
    catch (e: unknown) { if (e instanceof Error) setError(e.message); }
    finally { setSavingSchema(false); }
  }

  async function saveStages() {
    if (!editingId) { setError("Save details first."); return; }
    if (draftStages.some((s) => !s.label.trim() || !s.key.trim())) { setError("All stages need a label and key."); return; }
    setError(""); setNotice(""); setSavingStages(true);
    try {
      const saved = await adminSaveService({ stages: draftStages }, editingId);
      setDraftStages(saved.stages ?? []);
      setEditing((prev) => prev ? { ...prev, stages: saved.stages ?? [] } : prev);
      setNotice("Stages saved."); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setSavingStages(false); }
  }

  return (
    <div className={`admin-content${isEditorOpen ? " svc-panel-open" : ""}`}>

      {/* ── Page header ── */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Service catalogue</p>
          <h1>Services</h1>
          <p>Manage service categories, form fields, and ticket progress stages.</p>
        </div>
        <button className="primary-button svc-new-btn" onClick={openCreate}>
          <Plus size={16} aria-hidden="true" /> New category
        </button>
      </header>

      {/* ── Feedback ── */}
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p key="n" className="admin-notice" role="status"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 20 }}>
            <CheckCircle2 size={15} aria-hidden="true" /> {notice}
          </motion.p>
        )}
        {error && (
          <motion.p key="e" className="admin-error" role="alert"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ marginBottom: 20 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* ── Service card grid ── */}
      {services.length === 0 ? (
        <div className="svc-empty">
          <LayoutGrid size={30} aria-hidden="true" />
          <p>No service categories yet.</p>
          <button className="primary-button" onClick={openCreate} style={{ marginTop: 12, fontSize: ".88rem" }}>
            <Plus size={15} aria-hidden="true" /> Create first category
          </button>
        </div>
      ) : (
        <section className="svc-grid" aria-label="Service categories">
          {services.map((svc) => {
            const aud = AUDIENCE_META[svc.audience];
            const isSelected = editing?.id === svc.id;
            return (
              <motion.article key={svc.id} layout className={`svc-card${isSelected ? " svc-card--selected" : ""}`}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>

                {/* Top row: icon + status */}
                <div className="svc-card-top">
                  <div className="svc-card-icon">
                    <ServiceIcon name={svc.icon} size={22} />
                  </div>
                  <span className={`svc-card-status${svc.is_active ? " svc-card-status--active" : ""}`}>
                    {svc.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Name + summary */}
                <div className="svc-card-body">
                  <h3 className="svc-card-name">{svc.name}</h3>
                  <p className="svc-card-summary">{svc.summary || "No summary"}</p>
                </div>

                {/* Meta chips */}
                <div className="svc-card-meta">
                  <span className="svc-chip" style={{ background: aud.bg, color: aud.color }}>
                    <span className="svc-chip-dot" style={{ background: aud.dot }} aria-hidden="true" />
                    {aud.label}
                  </span>
                  <span className="svc-chip">
                    <ListChecks size={11} aria-hidden="true" />
                    {svc.form_schema?.length ?? 0} field{(svc.form_schema?.length ?? 0) !== 1 ? "s" : ""}
                  </span>
                  {(svc.stages?.length ?? 0) > 0 && (
                    <span className="svc-chip svc-chip--blue">
                      <GitBranch size={11} aria-hidden="true" />
                      {svc.stages.length} stage{svc.stages.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {/* Edit button */}
                <button className="svc-card-edit" onClick={() => openEditor(svc)} aria-label={`Edit ${svc.name}`}>
                  <Pencil size={14} aria-hidden="true" />
                  {isSelected ? "Editing" : "Edit"}
                </button>
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
            className="svc-editor"
            initial={{ opacity: 0, x: 32, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label={creating ? "New service category" : `Edit ${editing?.name ?? "category"}`}
          >
            {/* ── Panel header ── */}
            <div className="svc-editor-header">
              <div className="svc-editor-title">
                <div className="svc-editor-icon-wrap">
                  <ServiceIcon name={draftIcon || (editing?.icon ?? "")} size={18} />
                </div>
                <div>
                  <span className="svc-editor-eyebrow">{creating ? "New category" : "Edit category"}</span>
                  <h2 className="svc-editor-name">{creating ? "Create service" : (editing?.name ?? "")}</h2>
                </div>
              </div>
              <button className="svc-editor-close" aria-label="Close editor" onClick={closeEditor}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {/* ── Tab bar ── */}
            <div className="svc-tab-bar svc-tab-bar--editor">
              {(
                [
                  { key: "details" as const, label: "Details",     icon: <LayoutGrid size={14} aria-hidden="true" /> },
                  { key: "fields"  as const, label: "Form fields", icon: <ListChecks size={14} aria-hidden="true" /> },
                  { key: "stages"  as const, label: "Stages",      icon: <GitBranch  size={14} aria-hidden="true" /> },
                ]
              ).map((t) => (
                <button key={t.key} type="button"
                  className={`svc-tab${activeTab === t.key ? " active" : ""}`}
                  onClick={() => { if (!creating || t.key === "details") setActiveTab(t.key); }}
                  disabled={creating && t.key !== "details"}
                  title={creating && t.key !== "details" ? "Save details first" : undefined}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* ── Details tab ── */}
            {activeTab === "details" && (
              <>
                <form id="svc-details-form" onSubmit={(e) => { e.preventDefault(); saveDetails(); }}
                  className="svc-editor-body">
                  <div className="ep-form">

                    <div className="ep-field">
                      <label htmlFor="svc-name">Name <span className="ep-required">*</span></label>
                      <input id="svc-name" type="text" value={draftName} required maxLength={100}
                        placeholder="e.g. Laptop & device support"
                        onChange={(e) => setDraftName(e.target.value)} />
                    </div>

                    <div className="ep-field">
                      <label htmlFor="svc-summary">Summary</label>
                      <textarea id="svc-summary" rows={3} value={draftSummary} maxLength={240}
                        placeholder="Brief description shown on the service card."
                        onChange={(e) => setDraftSummary(e.target.value)} />
                    </div>

                    <div className="ep-row-2">
                      <div className="ep-field">
                        <label htmlFor="svc-audience">Audience</label>
                        <select id="svc-audience" value={draftAudience}
                          onChange={(e) => setDraftAudience(e.target.value as AdminService["audience"])}>
                          <option value="public">Public</option>
                          <option value="student">Students</option>
                          <option value="staff">Faculty &amp; staff</option>
                          <option value="all">Students &amp; staff</option>
                        </select>
                      </div>
                      <div className="ep-field">
                        <label htmlFor="svc-icon">Icon</label>
                        <div className="ep-icon-row">
                          <input id="svc-icon" type="text" value={draftIcon} maxLength={32}
                            placeholder="life-buoy" className="ep-input-flex"
                            onChange={(e) => setDraftIcon(e.target.value)} />
                          <div className="svc-icon-preview" aria-label="Icon preview">
                            <ServiceIcon name={draftIcon} size={18} />
                          </div>
                        </div>
                        <span className="ep-hint">key-round · laptop · badge · wifi · camera · life-buoy</span>
                      </div>
                    </div>

                    <div className="ep-row-2">
                      <div className="ep-field">
                        <label htmlFor="svc-sort">Sort order</label>
                        <input id="svc-sort" type="number" min={0} value={draftSortOrder}
                          onChange={(e) => setDraftSortOrder(Number(e.target.value))} />
                      </div>
                      <div className="ep-field">
                        <label>Status</label>
                        <button type="button" className={`svc-active-toggle${draftIsActive ? " svc-active-toggle--on" : ""}`}
                          onClick={() => setDraftIsActive((v) => !v)} aria-pressed={draftIsActive}>
                          <span className="svc-toggle-dot" aria-hidden="true" />
                          <span>{draftIsActive ? "Active" : "Inactive"}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
                <div className="svc-editor-footer">
                  <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
                  <button form="svc-details-form" className="primary-button" type="submit" disabled={saving}>
                    {saving ? "Saving…" : creating ? "Create category" : "Save details"}
                  </button>
                </div>
              </>
            )}

            {/* ── Form Fields tab ── */}
            {activeTab === "fields" && (
              <>
                <div className="svc-editor-body">
                  <div className="svc-tab-section">
                    <div className="svc-tab-section-header">
                      <h3>Form fields</h3>
                      <p>These fields appear on the ticket submission form for this service.</p>
                    </div>
                    {creating ? (
                      <div className="svc-tab-gate">Save category details first to edit form fields.</div>
                    ) : (
                      <>
                        <FieldBuilder schema={draftSchema} onChange={setDraftSchema} />
                        {schemaErrors.length > 0 && (
                          <ul className="svc-schema-errors">
                            {schemaErrors.map((e, i) => (
                              <li key={i}>{e.key ? `"${e.key}"` : `Field ${(e.index ?? 0) + 1}`}: {e.error}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {!creating && (
                  <div className="svc-editor-footer">
                    <button type="button" className="primary-button" onClick={saveSchema} disabled={savingSchema}>
                      {savingSchema ? "Saving…" : "Save schema"}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Stages tab ── */}
            {activeTab === "stages" && (
              <>
                <div className="svc-editor-body">
                  <div className="svc-tab-section">
                    <div className="svc-tab-section-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <h3>Progress stages</h3>
                        <p>Visual progress tracker shown on the requester&apos;s ticket page.</p>
                      </div>
                      {seedKey && (
                        <button type="button" className="svc-preset-btn"
                          onClick={() => setDraftStages(SEED_STAGES[seedKey])}
                          title={`Load defaults for "${editing?.name}"`}>
                          <Sparkles size={13} aria-hidden="true" /> Use defaults
                        </button>
                      )}
                    </div>
                    {creating ? (
                      <div className="svc-tab-gate">Save category details first to configure stages.</div>
                    ) : (
                      <StageBuilder stages={draftStages} onChange={setDraftStages} />
                    )}
                  </div>
                </div>
                {!creating && (
                  <div className="svc-editor-footer">
                    <button type="button" className="primary-button" onClick={saveStages} disabled={savingStages}>
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
