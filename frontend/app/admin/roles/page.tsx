"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, ChevronDown, ChevronUp,
  Download, FileSpreadsheet,
  Layers, Plus, Save, Shield, Ticket, Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { csrfToken } from "@/lib/auth";
import { ALL_ROLES } from "@/lib/admin-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoleConfig {
  role: string;
  is_grantable: boolean;
  can_export: boolean;
  description: string;
  updated_at: string;
}

interface InternScope {
  slug: string;
  description: string;
  is_active: boolean;
}

interface ServiceCategory {
  id: number;
  name: string;
  slug: string;
  audience: string;
}

// ── Static ticket-access matrix ───────────────────────────────────────────────
// Describes what each role can see out-of-the-box.
// "scoped" means restricted to InternCategoryScope rows.

type AccessLevel = "all" | "scoped" | "own-only" | "none";

const ROLE_TICKET_ACCESS: Record<string, { level: AccessLevel; note: string }> = {
  administrator:       { level: "all",      note: "Sees every ticket across all categories." },
  service_lead:        { level: "all",      note: "Sees every ticket; can triage, assign and escalate." },
  it_agent:            { level: "all",      note: "Sees every ticket; works assigned queues." },
  it_noc_intern:       { level: "scoped",   note: "Sees only tickets in the categories below." },
  designated_approver: { level: "all",      note: "Sees every ticket for approval review." },
  content_editor:      { level: "none",     note: "No ticket access — manages guides and software only." },
  faculty_staff:       { level: "own-only", note: "Sees only tickets they submitted themselves." },
  student:             { level: "own-only", note: "Sees only tickets they submitted themselves." },
  visitor:             { level: "own-only", note: "Unauthenticated — sees nothing until signed in." },
};

const ACCESS_BADGE: Record<AccessLevel, { label: string; text: string; bg: string }> = {
  "all":      { label: "All tickets",       text: "#166534", bg: "#dcfce7" },
  "scoped":   { label: "Scoped categories", text: "#5b21b6", bg: "#ede9fe" },
  "own-only": { label: "Own tickets only",  text: "#92400e", bg: "#fef3c7" },
  "none":     { label: "No ticket access",  text: "#6b7280", bg: "#f1f5f9" },
};

// ── Role card colours ─────────────────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const [configs, setConfigs]   = useState<RoleConfig[]>([]);
  const [scopes, setScopes]     = useState<InternScope[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState("");
  const [saving, setSaving]     = useState<string | null>(null);

  const [editDesc, setEditDesc] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Inline add-scope state (per role card; only it_noc_intern uses it)
  const [newSlug, setNewSlug]   = useState("");
  const [newDesc, setNewDesc]   = useState("");
  const [addingScope, setAddingScope] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const [roleRes, scopeRes, catRes] = await Promise.all([
        fetch("/api/v1/admin/settings/roles/",      { credentials: "include", cache: "no-store" }),
        fetch("/api/v1/admin/settings/intern-scope/",{ credentials: "include", cache: "no-store" }),
        fetch("/api/v1/admin/services/",             { credentials: "include", cache: "no-store" }),
      ]);
      const roleData: RoleConfig[]      = roleRes.ok  ? await roleRes.json()  : [];
      const scopeData: InternScope[]    = scopeRes.ok ? await scopeRes.json() : [];
      const catData: ServiceCategory[]  = catRes.ok   ? await catRes.json()   : [];

      setConfigs(Array.isArray(roleData) ? roleData : []);
      setScopes(Array.isArray(scopeData) ? scopeData : []);
      setCategories(Array.isArray(catData) ? catData : []);

      const descs: Record<string, string> = {};
      (Array.isArray(roleData) ? roleData : []).forEach((c: RoleConfig) => {
        descs[c.role] = c.description;
      });
      setEditDesc(descs);
    } catch {
      setError("Could not load role settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toggleExpand(role: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });
  }

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

  async function toggleCanExport(role: string, current: boolean) {
    setSaving(`export-${role}`);
    setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/settings/roles/${role}/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ can_export: !current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfigs(prev => prev.map(c => c.role === role ? { ...c, ...(data as RoleConfig) } : c));
        setNotice(`Export permission for "${role}" ${!current ? "enabled" : "disabled"}.`);
      } else { setError(messageFrom(data)); }
    } catch { setError("Network error."); }
    finally { setSaving(null); }
  }

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
      setNotice(`Scope "${slug}" ${!current ? "enabled" : "disabled"}.`);
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

  // Quick-add: toggle an existing category slug into/out of intern scope
  async function toggleCategoryInScope(slug: string, inScope: boolean) {
    if (inScope) {
      // Remove — find the scope row
      const existing = scopes.find(s => s.slug === slug);
      if (existing) await deleteScope(slug);
    } else {
      // Add
      setSaving(`scope-add-${slug}`);
      try {
        const catName = categories.find(c => c.slug === slug)?.name ?? slug;
        const token = await csrfToken();
        const res = await fetch("/api/v1/admin/settings/intern-scope/", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": token },
          body: JSON.stringify({ slug, description: catName }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setScopes(prev => [...prev.filter(s => s.slug !== slug), data as InternScope]);
          setNotice(`"${slug}" added to intern scope.`);
        } else { setError(messageFrom(data)); }
      } catch { setError("Network error."); }
      finally { setSaving(null); }
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const configMap  = Object.fromEntries(configs.map(c => [c.role, c]));
  const scopeSlugs = new Set(scopes.filter(s => s.is_active).map(s => s.slug));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>Roles</h1>
          <p>Configure role permissions, descriptions, and ticket visibility per role.</p>
        </div>
        <div className="user-summary">
          <span><Shield aria-hidden="true" /><strong>{configs.filter(c => c.is_grantable).length}</strong> grantable</span>
          <span><Layers aria-hidden="true" /><strong>{scopes.filter(s => s.is_active).length}</strong> intern scopes</span>
          <span><Ticket aria-hidden="true" /><strong>{categories.length}</strong> categories</span>
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
        <div style={{ display: "grid", gap: 10 }}>
          {ALL_ROLES.map(({ value: role, label }) => {
            const cfg          = configMap[role];
            const isGrantable  = cfg?.is_grantable ?? true;
            const color        = ROLE_COLOR[role] ?? { text: "#374151", bg: "#f9fafb", border: "#e5e7eb" };
            const isOpen       = expanded.has(role);
            const isSavingThis = saving === role || saving === `desc-${role}`;
            const access       = ROLE_TICKET_ACCESS[role] ?? { level: "own-only" as AccessLevel, note: "" };
            const accessBadge  = ACCESS_BADGE[access.level];

            return (
              <motion.div
                key={role}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ background: "#fff", border: `1px solid ${color.border}`, borderRadius: 14, overflow: "hidden" }}
              >
                {/* ── Card header ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: 12, padding: "13px 18px" }}>

                  {/* Role name + portal tag */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: ".74rem", fontWeight: 800, color: color.text, background: color.bg, flexShrink: 0 }}>
                      {label}
                    </span>
                    {PORTAL_ROLES.has(role) && (
                      <span style={{ fontSize: ".72rem", color: "#94a3b8", fontStyle: "italic" }}>Staff portal</span>
                    )}
                    {/* Ticket access badge (always visible in header) */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "2px 8px", fontSize: ".71rem", fontWeight: 700, color: accessBadge.text, background: accessBadge.bg }}>
                      <Ticket size={10} aria-hidden="true" />
                      {accessBadge.label}
                    </span>
                  </div>

                  {/* Grantable toggle */}
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: ".82rem", fontWeight: 700, color: isGrantable ? "#166534" : "#6b7280", flexShrink: 0 }}
                    title={isGrantable ? "Disable granting this role" : "Allow granting this role"}>
                    <input type="checkbox" checked={isGrantable}
                      disabled={isSavingThis || role === "administrator"}
                      onChange={() => toggleGrantable(role, isGrantable)}
                      style={{ width: 15, height: 15 }} />
                    {isGrantable ? "Grantable" : "Disabled"}
                  </label>

                  {/* Expand */}
                  <button onClick={() => toggleExpand(role)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`}
                    style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 8, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }}>
                    {isOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                  </button>
                </div>

                {/* ── Expanded body ── */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ borderTop: `1px solid ${color.border}`, background: color.bg }}>

                        {/* ── Description ── */}
                        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${color.border}` }}>
                          <label style={{ display: "grid", gap: 6, fontSize: ".85rem", fontWeight: 700, color: "#374151" }}>
                            Description
                            <textarea rows={2}
                              value={editDesc[role] ?? (cfg?.description ?? "")}
                              onChange={(e) => setEditDesc(prev => ({ ...prev, [role]: e.target.value }))}
                              maxLength={300}
                              placeholder="Short description shown in the user management panel"
                              style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: ".85rem", fontWeight: 400, resize: "vertical", fontFamily: "inherit" }}
                            />
                          </label>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                            {!isGrantable && role !== "administrator" && (
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, background: "#fef3c7", borderRadius: 7, padding: "6px 10px", fontSize: ".78rem", color: "#92400e" }}>
                                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                                Role is disabled — cannot be assigned to new users.
                              </div>
                            )}
                            <div style={{ marginLeft: "auto" }}>
                              <button className="primary-button"
                                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: ".83rem" }}
                                onClick={() => saveDescription(role)}
                                disabled={saving === `desc-${role}`}>
                                {saving === `desc-${role}` ? "Saving…" : <><Save size={13} aria-hidden="true" /> Save</>}
                              </button>
                            </div>
                          </div>

                          {/* ── Export permission ── */}
                          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${color.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                              <div>
                                <p style={{ margin: 0, fontWeight: 700, fontSize: ".85rem", color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
                                  <Download size={13} aria-hidden="true" style={{ color: "#234395" }} />
                                  Export / Download permission
                                </p>
                                <p style={{ margin: "2px 0 0", fontSize: ".76rem", color: "#64748b" }}>
                                  Allow users with this role to download the Excel ticket report.
                                  {role === "administrator" || role === "service_lead"
                                    ? " Enabled by default for this role."
                                    : ""}
                                </p>
                              </div>
                              <label style={{
                                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                                fontSize: ".83rem", fontWeight: 700, flexShrink: 0,
                                color: (cfg?.can_export ?? false) ? "#166534" : "#6b7280",
                              }}>
                                <input
                                  type="checkbox"
                                  checked={cfg?.can_export ?? false}
                                  disabled={saving === `export-${role}`}
                                  onChange={() => toggleCanExport(role, cfg?.can_export ?? false)}
                                  style={{ width: 16, height: 16 }}
                                />
                                {(cfg?.can_export ?? false) ? "Allowed" : "Not allowed"}
                              </label>
                            </div>
                            {(cfg?.can_export ?? false) && (
                              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: "#f0fdf4", borderRadius: 7, padding: "6px 10px", fontSize: ".77rem", color: "#166534" }}>
                                <FileSpreadsheet size={12} aria-hidden="true" />
                                Users with the <strong>{label}</strong> role can download ticket reports from the Tickets admin page.
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ── Ticket access section ── */}
                        <div style={{ padding: "14px 18px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                            <Ticket size={14} style={{ color: accessBadge.text }} aria-hidden="true" />
                            <strong style={{ fontSize: ".85rem", color: "#1e293b" }}>Ticket visibility</strong>
                            <span style={{ borderRadius: 999, padding: "2px 9px", fontSize: ".72rem", fontWeight: 700, color: accessBadge.text, background: accessBadge.bg }}>
                              {accessBadge.label}
                            </span>
                          </div>

                          <p style={{ margin: "0 0 12px", fontSize: ".82rem", color: "#64748b", lineHeight: 1.5 }}>
                            {access.note}
                          </p>

                          {/* Full access — show all categories as read-only chips */}
                          {access.level === "all" && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {categories.map(cat => (
                                <span key={cat.slug} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 999, padding: "3px 10px", fontSize: ".75rem", fontWeight: 700, color: "#166534" }}>
                                  {cat.name}
                                </span>
                              ))}
                              {categories.length === 0 && (
                                <span style={{ fontSize: ".78rem", color: "#94a3b8" }}>No categories configured yet.</span>
                              )}
                            </div>
                          )}

                          {/* Own-only or none — informational */}
                          {(access.level === "own-only" || access.level === "none") && (
                            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 14px", fontSize: ".8rem", color: "#475569" }}>
                              {access.level === "own-only"
                                ? "This role cannot access the staff portal ticket queue. Users can only see tickets they submitted via the public helpdesk."
                                : "This role has no ticket access whatsoever."}
                            </div>
                          )}

                          {/* Scoped — live editable category matrix */}
                          {access.level === "scoped" && (
                            <div>
                              <p style={{ margin: "0 0 10px", fontSize: ".78rem", color: "#64748b" }}>
                                Tick a category to include it in this role's ticket queue. Untick to remove it.
                              </p>

                              {/* Category checkboxes */}
                              <div style={{ display: "grid", gap: 6 }}>
                                {categories.map(cat => {
                                  const inScope  = scopeSlugs.has(cat.slug);
                                  const isBusy   = saving === `scope-add-${cat.slug}` || saving === `scope-del-${cat.slug}` || saving === `scope-${cat.slug}`;
                                  const scopeRow = scopes.find(s => s.slug === cat.slug);
                                  const isActive = scopeRow?.is_active ?? false;

                                  return (
                                    <div key={cat.slug} style={{
                                      display: "grid",
                                      gridTemplateColumns: "auto 1fr auto",
                                      alignItems: "center",
                                      gap: 10,
                                      padding: "8px 12px",
                                      background: inScope ? "#f5f3ff" : "#f8fafc",
                                      border: `1px solid ${inScope ? "#ddd6fe" : "#e2e8f0"}`,
                                      borderRadius: 9,
                                    }}>
                                      <input
                                        type="checkbox"
                                        checked={inScope}
                                        disabled={isBusy}
                                        onChange={() => toggleCategoryInScope(cat.slug, inScope)}
                                        style={{ width: 16, height: 16, accentColor: "#5b21b6", cursor: "pointer" }}
                                        aria-label={`${inScope ? "Remove" : "Add"} ${cat.name} from intern scope`}
                                      />
                                      <div>
                                        <span style={{ fontWeight: 700, fontSize: ".85rem", color: inScope ? "#5b21b6" : "#374151" }}>
                                          {cat.name}
                                        </span>
                                        <code style={{ marginLeft: 8, fontSize: ".72rem", color: "#94a3b8", background: "#f1f5f9", borderRadius: 4, padding: "1px 5px" }}>
                                          {cat.slug}
                                        </code>
                                        <span style={{ marginLeft: 8, fontSize: ".72rem", color: "#94a3b8", textTransform: "capitalize" }}>
                                          · audience: {cat.audience}
                                        </span>
                                      </div>
                                      {/* Active/inactive toggle for already-added scopes */}
                                      {scopeRow && (
                                        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: ".75rem", fontWeight: 700, color: isActive ? "#166534" : "#94a3b8", cursor: "pointer", whiteSpace: "nowrap" }}>
                                          <input
                                            type="checkbox"
                                            checked={isActive}
                                            disabled={isBusy}
                                            onChange={() => toggleScopeActive(cat.slug, isActive)}
                                            style={{ width: 14, height: 14 }}
                                          />
                                          {isActive ? "Active" : "Paused"}
                                        </label>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Custom slug add (for categories not in the list) */}
                              <details style={{ marginTop: 12 }}>
                                <summary style={{ fontSize: ".78rem", color: "#64748b", cursor: "pointer", fontWeight: 700 }}>
                                  + Add a custom slug not listed above
                                </summary>
                                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
                                  <label style={{ display: "grid", gap: 4, fontSize: ".78rem", fontWeight: 700, color: "#374151" }}>
                                    Slug
                                    <input type="text" value={newSlug} onChange={e => setNewSlug(e.target.value)}
                                      placeholder="e.g. custom-service"
                                      style={{ border: "1px solid #94a3b8", borderRadius: 7, padding: "6px 9px", fontSize: ".82rem" }}
                                      onKeyDown={e => e.key === "Enter" && addScope()} />
                                  </label>
                                  <label style={{ display: "grid", gap: 4, fontSize: ".78rem", fontWeight: 700, color: "#374151" }}>
                                    Description <span style={{ fontWeight: 400, color: "#94a3b8" }}>(opt.)</span>
                                    <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                                      placeholder="Display name"
                                      style={{ border: "1px solid #94a3b8", borderRadius: 7, padding: "6px 9px", fontSize: ".82rem" }}
                                      onKeyDown={e => e.key === "Enter" && addScope()} />
                                  </label>
                                  <button className="primary-button" onClick={addScope}
                                    disabled={addingScope || !newSlug.trim()}
                                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", fontSize: ".78rem", alignSelf: "flex-end" }}>
                                    {addingScope ? "Adding…" : <><Plus size={13} aria-hidden="true" /> Add</>}
                                  </button>
                                </div>
                              </details>

                              {/* Summary */}
                              <div style={{ marginTop: 10, fontSize: ".78rem", color: "#64748b" }}>
                                <strong>{scopes.filter(s => s.is_active).length}</strong> active scope{scopes.filter(s => s.is_active).length !== 1 ? "s" : ""} —
                                interns see tickets from: {scopes.filter(s => s.is_active).map(s => {
                                  const cat = categories.find(c => c.slug === s.slug);
                                  return cat?.name ?? s.slug;
                                }).join(", ") || "none"}
                              </div>
                            </div>
                          )}
                        </div>

                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
