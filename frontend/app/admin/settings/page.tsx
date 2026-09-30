"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Eye, EyeOff, Globe, MapPin, Phone, Plus, Save, Settings, Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { csrfToken } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TicketFormSettings {
  subject_visible:      boolean;
  subject_required:     boolean;
  subject_min_len:      number;
  subject_max_len:      number;
  description_visible:  boolean;
  description_required: boolean;
  description_min_len:  number;
  description_max_len:  number;
  impact_visible:       boolean;
  impact_required:      boolean;
  updated_at:           string;
}

interface OfficeHourRow { day: string; hours: string; }

interface SiteSettings {
  support_email:         string;
  office_location:       string;
  office_phone:          string;
  office_hours:          OfficeHourRow[];
  walk_in_note:          string;
  accessibility_note:    string;
  account_recovery_note: string;
  institution_name:      string;
  department_name:       string;
  helpdesk_tagline:      string;
  updated_at:            string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const FORM_DEFAULTS: TicketFormSettings = {
  subject_visible: true,  subject_required: true,  subject_min_len: 5,  subject_max_len: 150,
  description_visible: true, description_required: true, description_min_len: 20, description_max_len: 5000,
  impact_visible: true, impact_required: true, updated_at: "",
};

const SITE_DEFAULTS: SiteSettings = {
  support_email:         "support@iic.edu.np",
  office_location:       "IT & NOC Department, Itahari International College, ING, Itahari, Sunsari, Nepal",
  office_phone:          "",
  office_hours:          [
    { day: "Sunday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Monday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Tuesday",   hours: "10:00 AM – 4:00 PM" },
    { day: "Wednesday", hours: "10:00 AM – 4:00 PM" },
    { day: "Thursday",  hours: "10:00 AM – 4:00 PM" },
    { day: "Friday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Saturday",  hours: "Closed" },
  ],
  walk_in_note:          "Walk-in support is available during office hours for urgent device issues, hardware drop-offs, and ID card replacements.",
  accessibility_note:    "",
  account_recovery_note: "If you are locked out of your IIC college account, please visit us in person with a valid college ID.",
  institution_name:      "Itahari International College",
  department_name:       "IT & NOC Department",
  helpdesk_tagline:      "Your first point of contact for IT support, account help, and self-service resources at IIC.",
  updated_at:            "",
};

function messageFrom(data: unknown): string {
  if (!data || typeof data !== "object") return "An error occurred.";
  const obj = data as Record<string, unknown>;
  if (typeof obj.detail === "string") return obj.detail;
  for (const v of Object.values(obj)) {
    const flat = Array.isArray(v) ? v : [v];
    const msg = flat.find((x) => typeof x === "string");
    if (msg) return String(msg);
  }
  return "An error occurred.";
}

// ── FieldRow (ticket form) ────────────────────────────────────────────────────

function FieldRow({
  label, hint, visible, required, minLen, maxLen, showLengths,
  onVisible, onRequired, onMinLen, onMaxLen,
}: {
  label: string; hint?: string;
  visible: boolean; required: boolean;
  minLen?: number; maxLen?: number; showLengths: boolean;
  onVisible: (v: boolean) => void;
  onRequired: (v: boolean) => void;
  onMinLen?: (v: number) => void;
  onMaxLen?: (v: number) => void;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #dbe2ee", borderRadius: 14, overflow: "hidden", opacity: visible ? 1 : 0.55 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 16, padding: "14px 18px" }}>
        <div>
          <strong style={{ fontSize: ".9rem", color: "#1e293b" }}>{label}</strong>
          {hint && <p style={{ margin: "2px 0 0", fontSize: ".78rem", color: "#64748b" }}>{hint}</p>}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: ".83rem", fontWeight: 700, color: visible ? "#166534" : "#94a3b8", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={visible} onChange={(e) => onVisible(e.target.checked)} style={{ width: 15, height: 15 }} />
          {visible ? <><Eye size={13} aria-hidden="true" /> Visible</> : <><EyeOff size={13} aria-hidden="true" /> Hidden</>}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: ".83rem", fontWeight: 700, color: required && visible ? "#1e40af" : "#94a3b8", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={required} disabled={!visible} onChange={(e) => onRequired(e.target.checked)} style={{ width: 15, height: 15 }} />
          Required
        </label>
      </div>
      {showLengths && visible && onMinLen && onMaxLen && (
        <div style={{ borderTop: "1px solid #f1f5f9", padding: "12px 18px", background: "#f8fafc", display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            Min characters
            <input type="number" min={0} max={(maxLen ?? 9999) - 1} value={minLen ?? 0}
              onChange={(e) => onMinLen(Math.max(0, Number(e.target.value)))}
              style={{ width: 90, border: "1px solid #94a3b8", borderRadius: 7, padding: "6px 9px", fontSize: ".88rem" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            Max characters
            <input type="number" min={(minLen ?? 0) + 1} max={99999} value={maxLen ?? 9999}
              onChange={(e) => onMaxLen(Math.max((minLen ?? 0) + 1, Number(e.target.value)))}
              style={{ width: 110, border: "1px solid #94a3b8", borderRadius: 7, padding: "6px 9px", fontSize: ".88rem" }} />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <span style={{ fontSize: ".75rem", color: "#94a3b8" }}>Current: {minLen}–{maxLen} characters</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {

  // ── Active tab ────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"form" | "contact">("form");

  // ── Ticket form state ─────────────────────────────────────────────────────
  const [formSettings,  setFormSettings]  = useState<TicketFormSettings>(FORM_DEFAULTS);
  const [formLoading,   setFormLoading]   = useState(true);
  const [formSaving,    setFormSaving]    = useState(false);

  // ── Site contact state ────────────────────────────────────────────────────
  const [siteSettings,  setSiteSettings]  = useState<SiteSettings>(SITE_DEFAULTS);
  const [siteLoading,   setSiteLoading]   = useState(true);
  const [siteSaving,    setSiteSaving]    = useState(false);

  // ── Shared feedback ───────────────────────────────────────────────────────
  const [error,  setError]  = useState("");
  const [notice, setNotice] = useState("");

  // ── Load both on mount ────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/v1/admin/settings/ticket-form/", { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? r.json() : FORM_DEFAULTS)
      .then((d) => setFormSettings({ ...FORM_DEFAULTS, ...(d as Partial<TicketFormSettings>) }))
      .catch(() => setFormSettings(FORM_DEFAULTS))
      .finally(() => setFormLoading(false));

    fetch("/api/v1/admin/settings/site/", { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? r.json() : SITE_DEFAULTS)
      .then((d) => {
        const merged = { ...SITE_DEFAULTS, ...(d as Partial<SiteSettings>) };
        if (!Array.isArray(merged.office_hours) || merged.office_hours.length === 0) {
          merged.office_hours = SITE_DEFAULTS.office_hours;
        }
        setSiteSettings(merged);
      })
      .catch(() => setSiteSettings(SITE_DEFAULTS))
      .finally(() => setSiteLoading(false));
  }, []);

  // ── Patch helpers ─────────────────────────────────────────────────────────
  function patchForm<K extends keyof TicketFormSettings>(key: K, value: TicketFormSettings[K]) {
    setFormSettings((prev) => ({ ...prev, [key]: value }));
  }
  function patchSite<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSiteSettings((prev) => ({ ...prev, [key]: value }));
  }

  // ── Save ticket form ──────────────────────────────────────────────────────
  async function saveForm() {
    setFormSaving(true); setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const body = { ...formSettings };
      delete (body as Partial<TicketFormSettings>).updated_at;
      const res = await fetch("/api/v1/admin/settings/ticket-form/", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFormSettings({ ...FORM_DEFAULTS, ...(data as Partial<TicketFormSettings>) });
        setNotice("Ticket form settings saved.");
      } else { setError(messageFrom(data)); }
    } catch { setError("Network error."); }
    finally { setFormSaving(false); }
  }

  // ── Save site settings ────────────────────────────────────────────────────
  async function saveSite() {
    setSiteSaving(true); setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const body = { ...siteSettings };
      delete (body as Partial<SiteSettings>).updated_at;
      const res = await fetch("/api/v1/admin/settings/site/", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSiteSettings({ ...SITE_DEFAULTS, ...(data as Partial<SiteSettings>) });
        setNotice("Contact settings saved. The /contact page will reflect these changes immediately.");
      } else { setError(messageFrom(data)); }
    } catch { setError("Network error."); }
    finally { setSiteSaving(false); }
  }

  // ── Office hours helpers ──────────────────────────────────────────────────
  function updateHourRow(i: number, key: "day" | "hours", value: string) {
    setSiteSettings((prev) => {
      const rows = [...prev.office_hours];
      rows[i] = { ...rows[i], [key]: value };
      return { ...prev, office_hours: rows };
    });
  }
  function addHourRow() {
    setSiteSettings((prev) => ({
      ...prev,
      office_hours: [...prev.office_hours, { day: "", hours: "" }],
    }));
  }
  function removeHourRow(i: number) {
    setSiteSettings((prev) => ({
      ...prev,
      office_hours: prev.office_hours.filter((_, idx) => idx !== i),
    }));
  }

  const loading = tab === "form" ? formLoading : siteLoading;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>Settings</h1>
          <p>Manage ticket form fields and the public contact page information.</p>
        </div>
        <Settings size={28} style={{ color: "#234395", opacity: .5 }} aria-hidden="true" />
      </header>

      {/* ── Feedback ── */}
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p key="n" className="admin-notice" role="status"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {notice}
          </motion.p>
        )}
        {error && (
          <motion.p key="e" className="admin-error" role="alert"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* ── Tab bar ── */}
      <div className="svc-tab-bar" style={{ marginBottom: 24 }}>
        <button className={`svc-tab${tab === "form"    ? " active" : ""}`} onClick={() => { setTab("form");    setError(""); setNotice(""); }}>
          <Settings size={14} aria-hidden="true" /> Ticket form
        </button>
        <button className={`svc-tab${tab === "contact" ? " active" : ""}`} onClick={() => { setTab("contact"); setError(""); setNotice(""); }}>
          <Globe size={14} aria-hidden="true" /> Contact &amp; office
        </button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading settings…</div>
      ) : (
        <>
          {/* ════════════════════════════════════════════════════════════════
              TAB: TICKET FORM
          ════════════════════════════════════════════════════════════════ */}
          {tab === "form" && (
            <section aria-label="Ticket form field settings">
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: "1rem", color: "#1e293b" }}>Ticket submission form</h2>
                <p style={{ margin: "3px 0 0", fontSize: ".83rem", color: "#64748b" }}>
                  Toggle visibility, mark fields as required, and set character limits. Changes apply immediately.
                </p>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <FieldRow label="Subject" hint="A short one-line summary of the issue."
                  visible={formSettings.subject_visible} required={formSettings.subject_required}
                  minLen={formSettings.subject_min_len} maxLen={formSettings.subject_max_len} showLengths
                  onVisible={(v) => patchForm("subject_visible", v)} onRequired={(v) => patchForm("subject_required", v)}
                  onMinLen={(v) => patchForm("subject_min_len", v)} onMaxLen={(v) => patchForm("subject_max_len", v)} />
                <FieldRow label="Description" hint="Detailed explanation of the issue."
                  visible={formSettings.description_visible} required={formSettings.description_required}
                  minLen={formSettings.description_min_len} maxLen={formSettings.description_max_len} showLengths
                  onVisible={(v) => patchForm("description_visible", v)} onRequired={(v) => patchForm("description_required", v)}
                  onMinLen={(v) => patchForm("description_min_len", v)} onMaxLen={(v) => patchForm("description_max_len", v)} />
                <FieldRow label="Impact" hint="Priority selector — how many people are affected."
                  visible={formSettings.impact_visible} required={formSettings.impact_required} showLengths={false}
                  onVisible={(v) => patchForm("impact_visible", v)} onRequired={(v) => patchForm("impact_required", v)} />
              </div>

              {/* Preview */}
              <div style={{ marginTop: 16, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 18px" }}>
                <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: ".83rem", color: "#475569" }}>Form preview</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: ".78rem" }}>
                  {[
                    { key: "subject",     label: "Subject",     vis: formSettings.subject_visible,     req: formSettings.subject_required },
                    { key: "description", label: "Description", vis: formSettings.description_visible, req: formSettings.description_required },
                    { key: "impact",      label: "Impact",      vis: formSettings.impact_visible,      req: formSettings.impact_required },
                  ].map(({ key, label, vis, req }) => (
                    <span key={key} style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "3px 10px", borderRadius: 999, fontWeight: 700,
                      background: vis ? (req ? "#dbeafe" : "#f0fdf4") : "#f1f5f9",
                      color: vis ? (req ? "#1e40af" : "#166534") : "#94a3b8",
                    }}>
                      {vis ? (req ? "✱" : "○") : "—"} {label}
                    </span>
                  ))}
                  <span style={{ color: "#94a3b8", alignSelf: "center" }}>✱ required &nbsp;○ optional &nbsp;— hidden</span>
                </div>
              </div>

              <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
                <button className="primary-button" onClick={saveForm} disabled={formSaving}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 22px" }}>
                  {formSaving ? "Saving…" : <><Save size={16} aria-hidden="true" /> Save form settings</>}
                </button>
              </div>
            </section>
          )}

          {/* ════════════════════════════════════════════════════════════════
              TAB: CONTACT & OFFICE
          ════════════════════════════════════════════════════════════════ */}
          {tab === "contact" && (
            <section aria-label="Contact and office settings" style={{ display: "flex", flexDirection: "column", gap: 28 }}>

              {/* ── Contact info ── */}
              <div style={{ background: "#fff", border: "1px solid #dbe2ee", borderRadius: 14, padding: "20px 22px" }}>
                <h2 style={{ margin: "0 0 16px", fontSize: ".95rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                  <MapPin size={16} style={{ color: "#234395" }} aria-hidden="true" /> Contact information
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".83rem", fontWeight: 700, color: "#374151" }}>
                    Support email <span style={{ fontWeight: 400, color: "#64748b" }}>(shown on contact page)</span>
                    <input type="email" value={siteSettings.support_email}
                      onChange={(e) => patchSite("support_email", e.target.value)}
                      style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 11px", fontSize: ".88rem" }} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".83rem", fontWeight: 700, color: "#374151" }}>
                    Office phone <span style={{ fontWeight: 400, color: "#64748b" }}>(optional)</span>
                    <input type="tel" value={siteSettings.office_phone}
                      onChange={(e) => patchSite("office_phone", e.target.value)}
                      placeholder="e.g. +977-25-123456"
                      style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 11px", fontSize: ".88rem" }} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".83rem", fontWeight: 700, color: "#374151", gridColumn: "1 / -1" }}>
                    Office location / address
                    <input type="text" value={siteSettings.office_location}
                      onChange={(e) => patchSite("office_location", e.target.value)}
                      placeholder="IT & NOC Department, IIC, Itahari, Sunsari, Nepal"
                      style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 11px", fontSize: ".88rem" }} />
                    <span style={{ fontSize: ".73rem", color: "#94a3b8" }}>
                      Separate with commas — each comma-separated segment becomes its own line on the contact page.
                    </span>
                  </label>
                </div>
              </div>

              {/* ── Institution branding ── */}
              <div style={{ background: "#fff", border: "1px solid #dbe2ee", borderRadius: 14, padding: "20px 22px" }}>
                <h2 style={{ margin: "0 0 16px", fontSize: ".95rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                  <Globe size={16} style={{ color: "#234395" }} aria-hidden="true" /> Institution &amp; footer text
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {([
                    { key: "institution_name" as const, label: "Institution name", ph: "Itahari International College" },
                    { key: "department_name"  as const, label: "Department name",  ph: "IT & NOC Department" },
                  ]).map(({ key, label, ph }) => (
                    <label key={key} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".83rem", fontWeight: 700, color: "#374151" }}>
                      {label}
                      <input type="text" value={siteSettings[key]}
                        onChange={(e) => patchSite(key, e.target.value)}
                        placeholder={ph}
                        style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 11px", fontSize: ".88rem" }} />
                    </label>
                  ))}
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".83rem", fontWeight: 700, color: "#374151", gridColumn: "1 / -1" }}>
                    Helpdesk tagline <span style={{ fontWeight: 400, color: "#64748b" }}>(shown in site footer)</span>
                    <input type="text" value={siteSettings.helpdesk_tagline}
                      onChange={(e) => patchSite("helpdesk_tagline", e.target.value)}
                      maxLength={200}
                      style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 11px", fontSize: ".88rem" }} />
                  </label>
                </div>
              </div>

              {/* ── Office hours ── */}
              <div style={{ background: "#fff", border: "1px solid #dbe2ee", borderRadius: 14, padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: ".95rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                    <Phone size={16} style={{ color: "#234395" }} aria-hidden="true" /> Office hours
                  </h2>
                  <button type="button" onClick={addHourRow}
                    style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #dbe2ee", borderRadius: 8, padding: "6px 12px", background: "#f8fafc", cursor: "pointer", fontSize: ".82rem", fontWeight: 700 }}>
                    <Plus size={13} aria-hidden="true" /> Add row
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {siteSettings.office_hours.map((row, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "center" }}>
                      <input type="text" value={row.day} placeholder="e.g. Monday"
                        onChange={(e) => updateHourRow(i, "day", e.target.value)}
                        style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "7px 11px", fontSize: ".88rem" }} />
                      <input type="text" value={row.hours} placeholder='e.g. 10:00 AM – 4:00 PM or "Closed"'
                        onChange={(e) => updateHourRow(i, "hours", e.target.value)}
                        style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "7px 11px", fontSize: ".88rem" }} />
                      <button type="button" onClick={() => removeHourRow(i)} aria-label={`Remove ${row.day}`}
                        style={{ width: 32, height: 32, border: "1px solid #fecaca", borderRadius: 7, background: "#fff", cursor: "pointer", color: "#dc2626", display: "grid", placeItems: "center" }}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
                <p style={{ margin: "10px 0 0", fontSize: ".75rem", color: "#94a3b8" }}>
                  Use &ldquo;Closed&rdquo; for the hours column on closed days. Leave empty to use the frontend defaults.
                </p>
              </div>

              {/* ── Notes ── */}
              <div style={{ background: "#fff", border: "1px solid #dbe2ee", borderRadius: 14, padding: "20px 22px" }}>
                <h2 style={{ margin: "0 0 16px", fontSize: ".95rem", fontWeight: 800 }}>
                  Contact page notes
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {([
                    { key: "account_recovery_note" as const, label: "Account recovery note", hint: "Shown in the blue info card on the contact page." },
                    { key: "walk_in_note"          as const, label: "Walk-in support note",   hint: "Shown in the yellow info card on the contact page." },
                    { key: "accessibility_note"    as const, label: "Accessibility note",      hint: "Leave blank to use the auto-generated email link fallback." },
                  ]).map(({ key, label, hint }) => (
                    <label key={key} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".83rem", fontWeight: 700, color: "#374151" }}>
                      {label} <span style={{ fontWeight: 400, color: "#64748b" }}>{hint}</span>
                      <textarea rows={3} value={siteSettings[key]}
                        onChange={(e) => patchSite(key, e.target.value)}
                        style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 11px", fontSize: ".85rem", fontFamily: "inherit", resize: "vertical" }} />
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="primary-button" onClick={saveSite} disabled={siteSaving}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 22px" }}>
                  {siteSaving ? "Saving…" : <><Save size={16} aria-hidden="true" /> Save contact settings</>}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
