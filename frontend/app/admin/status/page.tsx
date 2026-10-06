"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Activity, AlertTriangle, CheckCircle2, Construction,
  Loader2, Pencil, X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { csrfToken } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

type StatusValue = "operational" | "degraded" | "outage" | "maintenance";

interface ServiceStatusItem {
  id: number | null;
  category: number;
  category_name: string;
  category_slug: string;
  category_icon: string;
  status: StatusValue;
  status_label: string;
  message: string;
  incident_started_at: string | null;
  estimated_resolution: string | null;
  updated_by_name: string;
  updated_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_META: Record<StatusValue, {
  label: string; dotColor: string; pillBg: string; pillText: string;
  icon: React.ReactNode;
}> = {
  operational: { label: "Operational",  dotColor: "#22c55e", pillBg: "#dcfce7", pillText: "#166534", icon: <CheckCircle2 size={14} aria-hidden="true" /> },
  degraded:    { label: "Degraded",     dotColor: "#f59e0b", pillBg: "#fef3c7", pillText: "#92400e", icon: <AlertTriangle size={14} aria-hidden="true" /> },
  outage:      { label: "Outage",       dotColor: "#ef4444", pillBg: "#fee2e2", pillText: "#991b1b", icon: <AlertTriangle size={14} aria-hidden="true" /> },
  maintenance: { label: "Maintenance",  dotColor: "#6366f1", pillBg: "#eef2ff", pillText: "#3730a3", icon: <Construction size={14} aria-hidden="true" /> },
};

function messageFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r)) {
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  return "Could not save changes.";
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminStatusPage() {
  const [services, setServices] = useState<ServiceStatusItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState("");

  const [editing, setEditing]   = useState<ServiceStatusItem | null>(null);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState("");

  // Form state
  const [fStatus, setFStatus]   = useState<StatusValue>("operational");
  const [fMessage, setFMessage] = useState("");
  const [fStarted, setFStarted] = useState("");
  const [fEst, setFEst]         = useState("");

  // ── Load ──────────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/status/", {
        credentials: "include", cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load service statuses.");
      setServices(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Open editor ───────────────────────────────────────────────────────────

  function openEditor(svc: ServiceStatusItem) {
    setEditing(svc);
    setFStatus(svc.status);
    setFMessage(svc.message ?? "");
    setFStarted(svc.incident_started_at ? svc.incident_started_at.slice(0, 16) : "");
    setFEst(svc.estimated_resolution ? svc.estimated_resolution.slice(0, 16) : "");
    setFormError(""); setNotice("");
  }

  function closeEditor() {
    setEditing(null);
    setFormError("");
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true); setFormError("");

    const body: Record<string, unknown> = {
      status:  fStatus,
      message: fMessage,
    };
    // Send null to clear, or an ISO string if set
    body.incident_started_at    = fStarted ? fStarted : null;
    body.estimated_resolution   = fEst     ? fEst     : null;

    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/status/${editing.category}/`, {
        method:  "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(messageFrom(data));
      setNotice(`${editing.category_name} status updated.`);
      closeEditor();
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isOpen = editing !== null;

  return (
    <div
      className="admin-content"
      style={{
        maxWidth:      isOpen ? "calc(100% - 480px - 24px)" : undefined,
        marginLeft:    0,
        marginRight:   0,
      }}
    >
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Service Status</h1>
          <p>
            Manage the operational status shown on the public{" "}
            <a href="/status" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
              /status
            </a>{" "}
            page.
          </p>
        </div>
        <a href="/status" target="_blank" rel="noopener noreferrer"
          className="secondary-button"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: ".85rem", padding: "9px 16px" }}>
          <Activity size={15} aria-hidden="true" />
          View public page
        </a>
      </header>

      {/* Notices */}
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p key="n" className="admin-notice" role="status"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {notice}
          </motion.p>
        )}
        {error && !isOpen && (
          <motion.p key="e" className="admin-error" role="alert"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Services table */}
      {loading ? (
        <div className="empty-row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Loader2 className="spin" size={18} aria-hidden="true" /> Loading…
        </div>
      ) : services.length === 0 ? (
        <p className="empty-row">No active services found. Create service categories first.</p>
      ) : (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 14, overflow: "hidden",
        }}>
          {/* Header row */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 160px 180px 48px",
            gap: 16, padding: "10px 20px",
            background: "#f8fafc", borderBottom: "1px solid var(--border)",
            fontSize: ".75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em",
          }}>
            <span>Service</span><span>Status</span><span>Last updated</span><span />
          </div>

          {services.map((svc, i) => {
            const meta = STATUS_META[svc.status] ?? STATUS_META.operational;
            const isLast = i === services.length - 1;
            return (
              <div
                key={svc.category_slug}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 160px 180px 48px",
                  gap: 16, padding: "14px 20px", alignItems: "center",
                  borderBottom: isLast ? "none" : "1px solid var(--border)",
                  background: svc.status !== "operational" ? meta.pillBg + "55" : "transparent",
                }}
              >
                {/* Name */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: meta.dotColor, flexShrink: 0,
                      boxShadow: svc.status !== "operational"
                        ? `0 0 0 3px ${meta.pillBg}` : "none",
                    }}
                    aria-hidden="true"
                  />
                  <div>
                    <strong style={{ fontSize: ".9rem" }}>{svc.category_name}</strong>
                    {svc.message && (
                      <p style={{ margin: "2px 0 0", fontSize: ".76rem", color: "var(--muted)", fontStyle: "italic" }}>
                        {svc.message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Status pill */}
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: meta.pillBg, color: meta.pillText,
                  borderRadius: 999, padding: "4px 12px",
                  fontSize: ".78rem", fontWeight: 800,
                }}>
                  {meta.icon}
                  {meta.label}
                </span>

                {/* Updated at */}
                <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>
                  {svc.updated_by_name
                    ? `by ${svc.updated_by_name} · `
                    : ""
                  }
                  {new Date(svc.updated_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                </span>

                {/* Edit button */}
                <button
                  onClick={() => openEditor(svc)}
                  aria-label={`Edit ${svc.category_name} status`}
                  style={{
                    border: "1px solid var(--border)", borderRadius: 9,
                    padding: 8, background: "#fff", cursor: "pointer",
                    color: "var(--brand)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Editor panel ── */}
      <AnimatePresence>
        {editing && (
          <motion.aside
            key={editing.category}
            className="editor-panel guide-editor"
            style={{ width: 460 }}
            initial={{ opacity: 0, x: 28, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label="Edit service status"
          >
            <header>
              <div>
                <span>Service status</span>
                <h2>{editing.category_name}</h2>
              </div>
              <button aria-label="Close editor" onClick={closeEditor}>
                <X aria-hidden="true" />
              </button>
            </header>

            <form onSubmit={handleSave} style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
              <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>

                {formError && (
                  <p style={{ margin: 0, background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: ".85rem" }} role="alert">
                    {formError}
                  </p>
                )}

                {/* Status selector */}
                <div>
                  <label htmlFor="status-select">
                    Status <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                    {(["operational", "degraded", "outage", "maintenance"] as StatusValue[]).map((s) => {
                      const m = STATUS_META[s];
                      const selected = fStatus === s;
                      return (
                        <button
                          key={s} type="button"
                          onClick={() => setFStatus(s)}
                          style={{
                            border: `2px solid ${selected ? m.dotColor : "#e2e8f0"}`,
                            borderRadius: 10, padding: "10px 12px",
                            background: selected ? m.pillBg : "#fff",
                            cursor: "pointer", textAlign: "left",
                            display: "flex", alignItems: "center", gap: 8,
                            color: selected ? m.pillText : "#475569",
                            fontWeight: selected ? 700 : 500, fontSize: ".85rem",
                          }}
                        >
                          <span style={{ color: m.dotColor }}>{m.icon}</span>
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="status-message">
                    Message <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                  </label>
                  <input
                    id="status-message" type="text"
                    value={fMessage}
                    onChange={(e) => setFMessage(e.target.value)}
                    placeholder="e.g. Scheduled downtime until 14:00 NPT"
                    maxLength={500}
                  />
                  <small style={{ color: "#64748b", fontSize: ".75rem" }}>
                    Shown on the public status page below the service name.
                  </small>
                </div>

                {/* Incident times — only show when not operational */}
                {fStatus !== "operational" && (
                  <>
                    <div>
                      <label htmlFor="incident-started">Incident started</label>
                      <input
                        id="incident-started" type="datetime-local"
                        value={fStarted}
                        onChange={(e) => setFStarted(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="est-resolution">Estimated resolution</label>
                      <input
                        id="est-resolution" type="datetime-local"
                        value={fEst}
                        onChange={(e) => setFEst(e.target.value)}
                      />
                    </div>
                  </>
                )}

              </div>

              <div style={{
                borderTop: "1px solid #e2e8f0", padding: "14px 22px",
                background: "#f8fafc", display: "flex", justifyContent: "flex-end", gap: 10,
              }}>
                <button type="button" className="secondary-button" onClick={closeEditor}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={saving}
                  style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {saving
                    ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Saving…</>
                    : "Save status"
                  }
                </button>
              </div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
