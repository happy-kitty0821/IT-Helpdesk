"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, Check, ChevronDown, ChevronUp,
  Layers, Plus, Save, Shield, Trash2, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { csrfToken } from "@/lib/auth";
import { ALL_ROLES } from "@/lib/admin-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoleConfig {
  role: string;
  is_grantable: boolean;
  description: string;
  updated_at: string;
}

interface InternScope {
  slug: string;
  description: string;
  is_active: boolean;
}

// ── Role metadata (colour + portal access label) ──────────────────────────────

const ROLE_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  administrator:       { text: "#991b1b", bg: "#fef2f2", border: "#fecaca" },
  service_lead:        { text: "#92400e", bg: "#fffbeb", border: "#fde68a" },
  it_agent:            { text: "#1e40af", bg: "#eff6ff", border: "#bfdbfe" },
  it_noc_intern:       { text: "#5b21b6", bg: "#f5f3ff", border: "#ddd6fe" },
  designated_approver: { text: "#065f46", bg: "#f0fdf4", border: "#bbf7d0" },
  content_editor:      { text: "#9a3412", bg: "#fff7ed", border: "#fed7aa" },
  faculty_staff:       { text: "#1e3a5f", bg: "#f0f9ff", border: "#bae6fd" },
  student:             { text: "#374151", bg: "#f9fafb", border: "#e5e7eb" },
  visitor:             { text: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" },
};

const PORTAL_ROLES = new Set([
  "administrator", "service_lead", "it_agent", "it_noc_intern",
  "designated_approver", "content_editor",
]);

function messageFrom(data: unknown): string {
  if (!data || typeof data !== "object") return "An error occurred.";
  const obj = data as Record<string, unknown>;
  if (typeof obj.detail === "string") return obj.detail;
  const first = Object.values(obj).flat().find((v) => typeof v === "string");
  return typeof first === "string" ? first : "An error occurred.";
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RolesPage() {
  const [configs, setConfigs] = useState<RoleConfig[]>([]);
  const [scopes, setScopes]   = useState<InternScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [notice, setNotice]   = useState("");
  const [saving, setSaving]   = useState<string | null>(null);

  // Inline edit state per role
  const [editDesc, setEditDesc]   = useState<Record<string, string>>({});
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  // Intern scope add form
  const [newSlug, setNewSlug]     = useState("");
  const [newDesc, setNewDesc]     = useState("");
  const [addingScope, setAddingScope] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const [roleRes, scopeRes] = await Promise.all([
        fetch("/api/v1/admin/settings/roles/", { credentials: "include", cache: "no-store" }),
        fetch("/api/v1/admin/settings/intern-scope/", { credentials: "include", cache: "no-store" }),
      ]);
      const roleData: RoleConfig[] = roleRes.ok ? await roleRes.json() : [];
      const scopeData: InternScope[] = scopeRes.ok ? await scopeRes.json() : [];
      setConfigs(Array.isArray(roleData) ? roleData : []);
      setScopes(Array.isArray(scopeData) ? scopeData : []);
      // Seed edit drafts
      const descs: Record<string, string> = {};
      (Array.isArray(roleData) ? roleData : []).forEach((c: RoleConfig) => { descs[c.role] = c.description; });
      setEditDesc(descs);
    } catch {
      setError("Could not load role settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Toggle grantable ──────────────────────────────────────────────────────

  async function toggleGrantable(role: string, current: boolean) {
    setSaving(role);
    setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/settings/roles/${role}/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ is_grantable: !current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfigs(prev => prev.map(c => c.role === role ? { ...c, ...(data as RoleConfig) } : c));
        setNotice(`${role} updated.`);
      } else { setError(messageFrom(data)); }
    } catch { setError("Network error."); }
    finally { setSaving(null); }
  }

  // ── Save description ──────────────────────────────────────────────────────

  async function saveDescription(role: string) {
    setSaving(`desc-${role}`);
    setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/settings/roles/${role}/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ description: editDesc[role] ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfigs(prev => prev.map(c => c.role === role ? { ...c, ...(data as RoleConfig) } : c));
        setNotice("Description saved.");
      } else { setError(messageFrom(data)); }
    } catch { setError("Network error."); }
    finally { setSaving(null); }
  }

  // ── Intern scope ──────────────────────────────────────────────────────────

  async function toggleScopeActive(slug: string, current: boolean) {
    setSaving(`scope-${slug}`);
    try {
      const token = await csrfToken();
      await fetch(`/api/v1/admin/settings/intern-scope/${slug}/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ is_active: !current }),
      });
      setScopes(prev => prev.map(s => s.slug === slug ? { ...s, is_active: !current } : s));
    } catch { setError("Network error."); }
    finally { setSaving(null); }
  }

  async function deleteScope(slug: string) {
    if (!confirm(`Remove "${slug}" from intern scope?`)) return;
    setSaving(`scope-del-${slug}`);
    try {
      const token = await csrfToken();
      await fetch(`/api/v1/admin/settings/intern-scope/${slug}/`, {
        method: "DELETE", credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      setScopes(prev => prev.filter(s => s.slug !== slug));
      setNotice(`"${slug}" removed from intern scope.`);
    } catch { setError("Network error."); }
    finally { setSaving(null); }
  }

  async function addScope() {
    const slug = newSlug.trim();
    if (!slug) return;
    setAddingScope(true);
    try {
      const token = await csrfToken();
      const res = await fetch("/api/v1/admin/settings/intern-scope/", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ slug, description: newDesc.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setScopes(prev => [...prev.filter(s => s.slug !== slug), data as InternScope]);
        setNewSlug(""); setNewDesc("");
        setNotice(`"${slug}" added to intern scope.`);
      } else { setError(messageFrom(data)); }
    } catch { setError("Network error."); }
    finally { setAddingScope(false); }
  }

  function toggleExpand(role: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });
  }

  // ── Build full list — merge ALL_ROLES with fetched configs ────────────────

  const configMap = Object.fromEntries(configs.map(c => [c.role, c]));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>Roles</h1>
          <p>Configure which roles can be granted and customise their descriptions.</p>
        </div>
        <div className="user-summary">
          <span><Shield aria-hidden="true" /><strong>{configs.filter(c => c.is_grantable).length}</strong> grantable</span>
          <span><Layers aria-hidden="true" /><strong>{scopes.filter(s => s.is_active).length}</strong> intern scopes</span>
        </div>
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
        <div className="admin-loading">Loading role settings…</div>
      ) : (
        <>
          {/* ── Role cards ── */}
          <section aria-label="Role configuration">
            <h2 style={{ fontSize: "1rem", color: "#1e293b", marginBottom: 14, marginTop: 0 }}>
              Role definitions
            </h2>
            <div style={{ display: "grid", gap: 10 }}>
              {ALL_ROLES.map(({ value: role, label }) => {
                const cfg = configMap[role];
                const isGrantable = cfg?.is_grantable ?? true;
                const color = ROLE_COLOR[role] ?? { text: "#374151", bg: "#f9fafb", border: "#e5e7eb" };
                const isOpen = expanded.has(role);
                const isSavingThis = saving === role || saving === `desc-${role}`;

                return (
                  <motion.div
                    key={role}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      background: "#fff",
                      border: `1px solid ${color.border}`,
                      borderRadius: 14,
                      overflow: "hidden",
                    }}
                  >
                    {/* Card header */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      alignItems: "center",
                      gap: 12,
                      padding: "14px 18px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        <span style={{
                          display: "inline-block", borderRadius: 999,
                          padding: "3px 10px", fontSize: ".74rem", fontWeight: 800,
                          color: color.text, background: color.bg, flexShrink: 0,
                        }}>
                          {label}
                        </span>
                        {PORTAL_ROLES.has(role) && (
                          <span style={{ fontSize: ".72rem", color: "#94a3b8", fontStyle: "italic" }}>
                            Staff portal access
                          </span>
                        )}
                      </div>

                      {/* Grantable toggle */}
                      <label
                        style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: ".83rem", fontWeight: 700, color: isGrantable ? "#166534" : "#6b7280", flexShrink: 0 }}
                        title={isGrantable ? "Click to disable granting this role" : "Click to allow granting this role"}
                      >
                        <input
                          type="checkbox"
                          checked={isGrantable}
                          disabled={isSavingThis || role === "administrator"}
                          onChange={() => toggleGrantable(role, isGrantable)}
                          style={{ width: 16, height: 16 }}
                        />
                        {isGrantable ? "Grantable" : "Disabled"}
                      </label>

                      {/* Expand toggle */}
                      <button
                        onClick={() => toggleExpand(role)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`}
                        style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 8, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}
                      >
                        {isOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                      </button>
                    </div>

                    {/* Expanded body — description editor */}
                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          style={{ overflow: "hidden" }}
                        >
                          <div style={{ borderTop: `1px solid ${color.border}`, padding: "14px 18px", background: color.bg }}>
                            <label style={{ display: "grid", gap: 6, fontSize: ".85rem", fontWeight: 700, color: "#374151" }}>
                              Description
                              <textarea
                                rows={2}
                                value={editDesc[role] ?? (cfg?.description ?? "")}
                                onChange={(e) => setEditDesc(prev => ({ ...prev, [role]: e.target.value }))}
                                maxLength={300}
                                placeholder="Short description shown in the user management panel"
                                style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: ".85rem", fontWeight: 400, resize: "vertical", fontFamily: "inherit" }}
                              />
                            </label>
                            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                              <button
                                className="primary-button"
                                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: ".83rem" }}
                                onClick={() => saveDescription(role)}
                                disabled={saving === `desc-${role}`}
                              >
                                {saving === `desc-${role}` ? "Saving…" : <><Save size={13} aria-hidden="true" /> Save description</>}
                              </button>
                            </div>
                            {!isGrantable && role !== "administrator" && (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "flex-start", gap: 8, background: "#fef3c7", borderRadius: 8, padding: "8px 12px", fontSize: ".8rem", color: "#92400e" }}>
                                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                                This role is disabled — it cannot be assigned to new users. Existing grants remain active until revoked.
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* ── Intern category scope ── */}
          <section aria-label="IT NOC Intern category scope" style={{ marginTop: 36 }}>
            <h2 style={{ fontSize: "1rem", color: "#1e293b", marginBottom: 4, marginTop: 0 }}>
              IT NOC Intern scope
            </h2>
            <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: ".85rem" }}>
              Service category slugs that IT NOC Interns can access. Tickets in other categories are hidden from them.
            </p>

            <div style={{ background: "#fff", border: "1px solid #dbe2ee", borderRadius: 14, overflow: "hidden" }}>
              {scopes.length === 0 ? (
                <p style={{ padding: "20px", color: "#94a3b8", textAlign: "center", margin: 0 }}>
                  No scopes configured — interns will see all tickets.
                </p>
              ) : (
                scopes.map((scope, i) => (
                  <motion.div
                    key={scope.slug}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 18px",
                      borderTop: i > 0 ? "1px solid #f1f5f9" : "none",
                    }}
                  >
                    <div>
                      <code style={{ fontSize: ".85rem", fontWeight: 700, color: "#234395", background: "#eef2ff", borderRadius: 5, padding: "2px 7px" }}>
                        {scope.slug}
                      </code>
                      {scope.description && (
                        <span style={{ marginLeft: 10, fontSize: ".8rem", color: "#64748b" }}>{scope.description}</span>
                      )}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".82rem", fontWeight: 700, color: scope.is_active ? "#166534" : "#94a3b8", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={scope.is_active}
                        disabled={saving === `scope-${scope.slug}`}
                        onChange={() => toggleScopeActive(scope.slug, scope.is_active)}
                        style={{ width: 15, height: 15 }}
                      />
                      {scope.is_active ? "Active" : "Inactive"}
                    </label>
                    <button
                      onClick={() => deleteScope(scope.slug)}
                      disabled={saving === `scope-del-${scope.slug}`}
                      aria-label={`Remove ${scope.slug}`}
                      style={{ width: 32, height: 32, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer" }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </motion.div>
                ))
              )}

              {/* Add scope row */}
              <div style={{ borderTop: "1px solid #f1f5f9", padding: "12px 18px", background: "#f8fafc", display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
                <div>
                  <label style={{ display: "grid", gap: 4, fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>
                    Category slug
                    <input
                      type="text"
                      value={newSlug}
                      onChange={(e) => setNewSlug(e.target.value)}
                      placeholder="e.g. device-support"
                      style={{ border: "1px solid #94a3b8", borderRadius: 7, padding: "7px 9px", fontSize: ".85rem" }}
                      onKeyDown={(e) => e.key === "Enter" && addScope()}
                    />
                  </label>
                </div>
                <div>
                  <label style={{ display: "grid", gap: 4, fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>
                    Description <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                    <input
                      type="text"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="e.g. Laptop & device support"
                      style={{ border: "1px solid #94a3b8", borderRadius: 7, padding: "7px 9px", fontSize: ".85rem" }}
                      onKeyDown={(e) => e.key === "Enter" && addScope()}
                    />
                  </label>
                </div>
                <button
                  className="primary-button"
                  onClick={addScope}
                  disabled={addingScope || !newSlug.trim()}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: ".83rem", alignSelf: "flex-end" }}
                >
                  {addingScope ? "Adding…" : <><Plus size={14} aria-hidden="true" /> Add</>}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
