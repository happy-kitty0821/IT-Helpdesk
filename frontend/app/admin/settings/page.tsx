"use client";

import { AnimatePresence, motion } from "motion/react";
import { Eye, EyeOff, Save, Settings } from "lucide-react";
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

const DEFAULTS: TicketFormSettings = {
  subject_visible: true,  subject_required: true,  subject_min_len: 5,  subject_max_len: 150,
  description_visible: true, description_required: true, description_min_len: 20, description_max_len: 5000,
  impact_visible: true, impact_required: true,
  updated_at: "",
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

// ── Field row component ───────────────────────────────────────────────────────

function FieldRow({
  label,
  hint,
  visible,
  required,
  minLen,
  maxLen,
  showLengths,
  onVisible,
  onRequired,
  onMinLen,
  onMaxLen,
}: {
  label: string;
  hint?: string;
  visible: boolean;
  required: boolean;
  minLen?: number;
  maxLen?: number;
  showLengths: boolean;
  onVisible: (v: boolean) => void;
  onRequired: (v: boolean) => void;
  onMinLen?: (v: number) => void;
  onMaxLen?: (v: number) => void;
}) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #dbe2ee", borderRadius: 14,
      overflow: "hidden", opacity: visible ? 1 : 0.55,
    }}>
      {/* Header row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 16, padding: "14px 18px" }}>
        <div>
          <strong style={{ fontSize: ".9rem", color: "#1e293b" }}>{label}</strong>
          {hint && <p style={{ margin: "2px 0 0", fontSize: ".78rem", color: "#64748b" }}>{hint}</p>}
        </div>

        {/* Visible toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: ".83rem", fontWeight: 700, color: visible ? "#166534" : "#94a3b8", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => onVisible(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          {visible
            ? <><Eye size={13} aria-hidden="true" /> Visible</>
            : <><EyeOff size={13} aria-hidden="true" /> Hidden</>
          }
        </label>

        {/* Required toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: ".83rem", fontWeight: 700, color: required && visible ? "#1e40af" : "#94a3b8", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={required}
            disabled={!visible}
            onChange={(e) => onRequired(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          Required
        </label>
      </div>

      {/* Length settings (only for subject + description) */}
      {showLengths && visible && onMinLen && onMaxLen && (
        <div style={{ borderTop: "1px solid #f1f5f9", padding: "12px 18px", background: "#f8fafc", display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            Min characters
            <input
              type="number"
              min={0}
              max={(maxLen ?? 9999) - 1}
              value={minLen ?? 0}
              onChange={(e) => onMinLen(Math.max(0, Number(e.target.value)))}
              style={{ width: 90, border: "1px solid #94a3b8", borderRadius: 7, padding: "6px 9px", fontSize: ".88rem" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            Max characters
            <input
              type="number"
              min={(minLen ?? 0) + 1}
              max={99999}
              value={maxLen ?? 9999}
              onChange={(e) => onMaxLen(Math.max((minLen ?? 0) + 1, Number(e.target.value)))}
              style={{ width: 110, border: "1px solid #94a3b8", borderRadius: 7, padding: "6px 9px", fontSize: ".88rem" }}
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <span style={{ fontSize: ".75rem", color: "#94a3b8" }}>
              Current: {minLen}–{maxLen} characters
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<TicketFormSettings>(DEFAULTS);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState("");

  useEffect(() => {
    fetch("/api/v1/admin/settings/ticket-form/", { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? r.json() : DEFAULTS)
      .then((data) => setSettings({ ...DEFAULTS, ...(data as Partial<TicketFormSettings>) }))
      .catch(() => setSettings(DEFAULTS))
      .finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof TicketFormSettings>(key: K, value: TicketFormSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const body = { ...settings };
      delete (body as Partial<TicketFormSettings>).updated_at;
      const res = await fetch("/api/v1/admin/settings/ticket-form/", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSettings({ ...DEFAULTS, ...(data as Partial<TicketFormSettings>) });
        setNotice("Settings saved. The ticket form will reflect these changes immediately.");
      } else {
        setError(messageFrom(data));
      }
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>Settings</h1>
          <p>Control which fields appear on the ticket submission form and their validation rules.</p>
        </div>
        <Settings size={28} style={{ color: "#234395", opacity: .5 }} aria-hidden="true" />
      </header>

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

      {loading ? (
        <div className="admin-loading">Loading settings…</div>
      ) : (
        <>
          {/* ── Ticket form fields ── */}
          <section aria-label="Ticket form field settings">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1rem", color: "#1e293b" }}>Ticket submission form</h2>
                <p style={{ margin: "3px 0 0", fontSize: ".83rem", color: "#64748b" }}>
                  Toggle visibility, mark fields as required, and set character limits. Changes apply to all new tickets immediately.
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <FieldRow
                label="Subject"
                hint="A short one-line summary of the issue."
                visible={settings.subject_visible}
                required={settings.subject_required}
                minLen={settings.subject_min_len}
                maxLen={settings.subject_max_len}
                showLengths
                onVisible={(v) => patch("subject_visible", v)}
                onRequired={(v) => patch("subject_required", v)}
                onMinLen={(v) => patch("subject_min_len", v)}
                onMaxLen={(v) => patch("subject_max_len", v)}
              />

              <FieldRow
                label="Description"
                hint="Detailed explanation of the issue."
                visible={settings.description_visible}
                required={settings.description_required}
                minLen={settings.description_min_len}
                maxLen={settings.description_max_len}
                showLengths
                onVisible={(v) => patch("description_visible", v)}
                onRequired={(v) => patch("description_required", v)}
                onMinLen={(v) => patch("description_min_len", v)}
                onMaxLen={(v) => patch("description_max_len", v)}
              />

              <FieldRow
                label="Impact"
                hint="Priority selector — how many people are affected."
                visible={settings.impact_visible}
                required={settings.impact_required}
                showLengths={false}
                onVisible={(v) => patch("impact_visible", v)}
                onRequired={(v) => patch("impact_required", v)}
              />
            </div>

            {/* Live preview summary */}
            <div style={{ marginTop: 16, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 18px" }}>
              <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: ".83rem", color: "#475569" }}>Form preview</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: ".78rem" }}>
                {[
                  { key: "subject",     label: "Subject",     vis: settings.subject_visible,     req: settings.subject_required },
                  { key: "description", label: "Description", vis: settings.description_visible, req: settings.description_required },
                  { key: "impact",      label: "Impact",      vis: settings.impact_visible,      req: settings.impact_required },
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
          </section>

          {/* ── Save button ── */}
          <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
            <button
              className="primary-button"
              onClick={save}
              disabled={saving}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 22px" }}
            >
              {saving
                ? "Saving…"
                : <><Save size={16} aria-hidden="true" /> Save settings</>
              }
            </button>
          </div>
        </>
      )}
    </div>
  );
}
