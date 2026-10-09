"use client";

import React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  Eye, EyeOff, Loader2, Pencil, Plus, Search,
  ShieldCheck, ShieldOff, Trash2, UserPlus, UserRound, Users, X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  adminSave, getUserRoles, grantRole, revokeRole,
  ALL_ROLES, type ManagedUser, type RoleGrant, type RoleValue,
} from "@/lib/admin-api";
import { csrfToken, type AuthUser } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PagedUsers {
  count: number; num_pages: number; page: number;
  page_size: number; next: string | null; previous: string | null;
  results: ManagedUser[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(user: ManagedUser) {
  const v = user.name || user.username;
  return v.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

// ── UserAvatar — Google picture with initials fallback ────────────────────────

function UserAvatar({
  user, size = 38, radius = 11,
}: { user: ManagedUser; size?: number; radius?: number }) {
  const [err, setErr] = React.useState(false);
  const ini = initials(user);
  const suspended = user.is_suspended;
  const showImg = !!user.avatar_url && !err;

  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: radius,
    flexShrink: 0, display: "grid", placeItems: "center",
    overflow: "hidden",
  };

  if (showImg) {
    return (
      <span className={`user-avatar${suspended ? " user-avatar--suspended" : ""}`}
        style={{ ...base, background: "transparent", padding: 0 }}>
        <img
          src={user.avatar_url}
          alt={user.name}
          onError={() => setErr(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </span>
    );
  }

  return (
    <span className={`user-avatar${suspended ? " user-avatar--suspended" : ""}`} style={base}>
      {ini || <UserRound size={Math.round(size * 0.47)} aria-hidden="true" />}
    </span>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}

function messageFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r)) {
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  return "The change could not be saved.";
}

// ── Small sub-components ──────────────────────────────────────────────────────

function UserStatusChip({ user }: { user: ManagedUser }) {
  if (user.is_suspended)
    return <span className="user-status-chip user-status-chip--suspended"><ShieldOff size={11} aria-hidden="true" /> Suspended</span>;
  if (user.is_active)
    return <span className="user-status-chip user-status-chip--active"><CheckCircle2 size={11} aria-hidden="true" /> Active</span>;
  return <span className="user-status-chip user-status-chip--inactive"><CheckCircle2 size={11} aria-hidden="true" /> Inactive</span>;
}

function RoleBadge({ roles }: { roles: RoleValue[] }) {
  if (roles.includes("administrator"))       return <span className="role-badge role-badge--admin"><ShieldCheck size={11} aria-hidden="true" /> Administrator</span>;
  if (roles.includes("service_lead"))        return <span className="role-badge role-badge--staff">Service Lead</span>;
  if (roles.includes("it_agent"))            return <span className="role-badge role-badge--staff">IT Agent</span>;
  if (roles.includes("it_noc_intern"))       return <span className="role-badge role-badge--staff">IT NOC Intern</span>;
  if (roles.includes("content_editor"))      return <span className="role-badge role-badge--staff">Content Editor</span>;
  if (roles.includes("designated_approver")) return <span className="role-badge role-badge--staff">Designated Approver</span>;
  if (roles.includes("faculty_staff"))       return <span className="role-badge role-badge--staff">Staff</span>;
  if (roles.includes("student"))             return <span className="role-badge role-badge--member">Student</span>;
  return <span className="role-badge role-badge--member">Visitor</span>;
}

const PAGE_SIZES = [10, 20, 50, 100];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UserManagement() {

  // ── List ──────────────────────────────────────────────────────────────────
  const [users, setUsers]       = useState<ManagedUser[]>([]);
  const [totalCount, setCount]  = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery]       = useState("");
  const [dq, setDq]             = useState("");
  const [listLoading, setLL]    = useState(false);

  // ── Editor ────────────────────────────────────────────────────────────────
  const [editing, setEditing]           = useState<ManagedUser | null>(null);
  const [grants, setGrants]             = useState<RoleGrant[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving]             = useState(false);

  // ── Suspension ────────────────────────────────────────────────────────────
  const [suspending, setSuspending]            = useState(false);
  const [suspendReason, setSuspendReason]      = useState("");
  const [showSuspendForm, setShowSuspendForm]  = useState(false);

  // ── Django backend access (superuser-only) ────────────────────────────────
  const [viewerIsSuperuser,  setViewerIsSuperuser]  = useState(false);
  const [settingSuperuser,   setSettingSuperuser]   = useState(false);

  // ── Delete ────────────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting]                   = useState(false);

  // ── Add user modal ────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", username: "", first_name: "", last_name: "", password: "", confirm_password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [addRoles, setAddRoles]         = useState<Set<RoleValue>>(new Set());
  const [addErrors, setAddErrors]       = useState<Record<string, string>>({});
  const [addSaving, setAddSaving]       = useState(false);

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [error, setError]   = useState("");
  const [notice, setNotice] = useState("");

  // ── Debounce ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setDq(query); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadPage = useCallback(async (p: number, ps: number, q: string) => {
    setLL(true);
    try {
      const params = new URLSearchParams({ page: String(p), page_size: String(ps) });
      if (q) params.set("q", q);
      const res = await fetch(`/api/v1/admin/users/?${params}`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Could not load users.");
      const data = await res.json() as PagedUsers;
      setUsers(data.results); setCount(data.count);
      setNumPages(data.num_pages); setPage(data.page);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load."); }
    finally { setLL(false); }
  }, []);

  useEffect(() => { loadPage(page, pageSize, dq); }, [page, pageSize, dq, loadPage]);

  // Load viewer's own superuser flag once on mount
  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: AuthUser | null) => { if (d) setViewerIsSuperuser(d.is_superuser ?? false); })
      .catch(() => {});
  }, []);

  const activeRoles = useMemo<Set<RoleValue>>(
    () => new Set(grants.map((g) => g.role as RoleValue)), [grants]
  );

  // ── Editor open/close ─────────────────────────────────────────────────────
  async function openEditor(user: ManagedUser) {
    setEditing(user); setGrants([]); setLoadingRoles(true);
    setError(""); setShowSuspendForm(false); setSuspendReason(""); setShowDeleteConfirm(false);
    try { setGrants(await getUserRoles(user.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load roles."); }
    finally { setLoadingRoles(false); }
  }

  function closeEditor() {
    setEditing(null); setGrants([]); setShowSuspendForm(false);
    setSuspendReason(""); setShowDeleteConfirm(false);
  }

  // ── Save profile ──────────────────────────────────────────────────────────
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const desired = new Set(ALL_ROLES.map((r) => r.value).filter((v) => form.get(`role_${v}`) === "on")) as Set<RoleValue>;
    const toGrant  = [...desired].filter((r) => !activeRoles.has(r));
    const toRevoke = [...activeRoles].filter((r) => !desired.has(r));
    try {
      await adminSave<ManagedUser>("users", {
        first_name: form.get("first_name"), last_name: form.get("last_name"),
        is_active:  form.get("is_active") === "on",
      }, editing.id);
      await Promise.all([...toGrant.map((r) => grantRole(editing.id, r)), ...toRevoke.map((r) => revokeRole(editing.id, r))]);
      closeEditor(); setNotice(`${editing.name} updated.`);
      loadPage(page, pageSize, dq);
    } catch (e) { setError(e instanceof Error ? e.message : "User could not be updated."); }
    finally { setSaving(false); }
  }

  // ── Suspend ───────────────────────────────────────────────────────────────
  async function handleSuspend(doSuspend: boolean) {
    if (!editing) return;
    setSuspending(true); setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/users/${editing.id}/suspend/`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ suspend: doSuspend, reason: suspendReason }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not update suspension.");
      setNotice(doSuspend ? `${editing.name} has been suspended.` : `${editing.name} has been reinstated.`);
      closeEditor(); loadPage(page, pageSize, dq);
    } catch (e) { setError(e instanceof Error ? e.message : "Suspension could not be updated."); }
    finally { setSuspending(false); }
  }

  // ── Set / clear Django backend access (superuser-only) ────────────────────
  async function handleSetSuperuser(grant: boolean) {
    if (!editing) return;
    setSettingSuperuser(true); setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/users/${editing.id}/set-superuser/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ is_superuser: grant }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Could not update Django backend access.");
      } else {
        const updated = { ...editing, is_superuser: grant };
        setEditing(updated);
        setUsers((prev) => prev.map((u) => u.id === editing.id ? { ...u, is_superuser: grant } : u));
        setNotice(grant
          ? `${editing.name} can now access the Django backend panel.`
          : `Django backend access removed from ${editing.name}.`);
      }
    } catch { setError("A network error occurred."); }
    finally { setSettingSuperuser(false); }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!editing) return;
    setDeleting(true); setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/users/${editing.id}/delete/`, {
        method: "DELETE", credentials: "include", headers: { "X-CSRFToken": token },
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not delete user.");
      setNotice(typeof data.detail === "string" ? data.detail : `${editing.name} deleted.`);
      closeEditor(); loadPage(page, pageSize, dq);
    } catch (e) {
      setError(e instanceof Error ? e.message : "User could not be deleted.");
      setShowDeleteConfirm(false);
    } finally { setDeleting(false); }
  }

  // ── Create user ───────────────────────────────────────────────────────────
  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddSaving(true); setAddErrors({});
    try {
      const token = await csrfToken();
      const res = await fetch("/api/v1/admin/users/", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ ...addForm, initial_roles: [...addRoles] }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) errs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        setAddErrors(Object.keys(errs).length ? errs : { _: messageFrom(data) }); return;
      }
      const created = data as ManagedUser;
      setShowAddModal(false);
      setAddForm({ email: "", username: "", first_name: "", last_name: "", password: "", confirm_password: "" });
      setShowPassword(false); setAddRoles(new Set());
      setNotice(`Account for ${created.name || created.username} created.`);
      setPage(1); loadPage(1, pageSize, dq);
    } catch { setAddErrors({ _: "A network error occurred." }); }
    finally { setAddSaving(false); }
  }

  function toggleAddRole(role: RoleValue) {
    setAddRoles((prev) => { const n = new Set(prev); if (n.has(role)) n.delete(role); else n.add(role); return n; });
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeCount    = users.filter((u) => u.is_active && !u.is_suspended).length;
  const suspendedCount = users.filter((u) => u.is_suspended).length;
  const adminCount     = users.filter((u) => u.roles?.includes("administrator")).length;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="admin-content" style={{
      maxWidth:    editing ? "calc(100% - 500px - 24px)" : undefined,
      marginLeft:  editing ? 0 : undefined,
      marginRight: editing ? 0 : undefined,
      transition:  "max-width 280ms ease",
    }}>

      {/* ── Page header ── */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>User management</h1>
          <p>Review college accounts, manage roles, suspend or remove users.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <div className="user-summary">
            <span className="user-summary-chip"><Users size={15} aria-hidden="true" /><strong>{totalCount}</strong> total</span>
            <span className="user-summary-chip"><ShieldCheck size={15} aria-hidden="true" /><strong>{adminCount}</strong> admin</span>
            <span className="user-summary-chip"><CheckCircle2 size={15} aria-hidden="true" /><strong>{activeCount}</strong> active</span>
            {suspendedCount > 0 && (
              <span className="user-summary-chip user-summary-chip--danger">
                <ShieldOff size={15} aria-hidden="true" /><strong>{suspendedCount}</strong> suspended
              </span>
            )}
          </div>
          <button className="primary-button" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: ".85rem" }}
            onClick={() => { setShowAddModal(true); setAddErrors({}); }}>
            <UserPlus size={15} aria-hidden="true" /> Add user
          </button>
        </div>
      </header>

      {/* ── Feedback ── */}
      <AnimatePresence mode="wait">
        {notice && <motion.p key="n" className="admin-notice" role="status" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{notice}</motion.p>}
        {error  && <motion.p key="e" className="admin-error"  role="alert"  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error}</motion.p>}
      </AnimatePresence>

      {/* ── Toolbar ── */}
      <div className="user-toolbar">
        <div className="user-toolbar-search">
          <Search aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, username, or email" aria-label="Search users" />
        </div>
        <span className="user-toolbar-meta">{listLoading ? "Loading…" : `${totalCount} result${totalCount !== 1 ? "s" : ""}`}</span>
        <div className="user-toolbar-divider" aria-hidden="true" />
        <label className="user-toolbar-pagesize">
          Per page
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* ── Table ── */}
      <section className="user-table" aria-label="College users" aria-busy={listLoading}>
        <div className="user-table-head" aria-hidden="true">
          <span>User</span>
          <span>Role</span>
          <span>Last sign-in</span>
          <span>Status</span>
          <span />
        </div>

        {listLoading && users.length === 0 ? (
          <div className="user-table-empty" aria-live="polite">
            <Loader2 className="spin" size={32} aria-hidden="true" />
            <p>Loading users…</p>
          </div>
        ) : users.length === 0 ? (
          <div className="user-table-empty">
            <UserRound aria-hidden="true" />
            <p>No users match this search.</p>
          </div>
        ) : users.map((user, index) => (
          <motion.article
            key={user.id}
            className={`user-row${user.is_suspended ? " user-row--suspended" : ""}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.022, 0.14) }}
            style={{ opacity: listLoading ? 0.5 : 1, transition: "opacity 200ms, background 130ms" }}
          >
            {/* Identity */}
            <div className="user-identity">
              <UserAvatar user={user} />
              <div className="user-identity-info">
                <span className="user-identity-name">{user.name}</span>
                <span className="user-identity-email">{user.email}</span>
                <span className="user-identity-username">@{user.username}</span>
              </div>
            </div>

            {/* Role */}
            <div><RoleBadge roles={user.roles ?? []} /></div>

            {/* Last sign-in */}
            <span style={{ color: "#64748b", fontSize: ".83rem" }}>{formatDate(user.last_login)}</span>

            {/* Status */}
            <div><UserStatusChip user={user} /></div>

            {/* Edit button */}
            <button className="user-row-btn" aria-label={`Edit ${user.name}`} onClick={() => openEditor(user)}>
              <Pencil size={15} aria-hidden="true" />
            </button>
          </motion.article>
        ))}
      </section>

      {/* ── Pagination ── */}
      {numPages > 1 && (
        <div className="user-pagination">
          <span className="user-pagination-info">
            Page <strong>{page}</strong> of <strong>{numPages}</strong>
            {" · "}{totalCount} user{totalCount !== 1 ? "s" : ""}
          </span>
          <div className="user-pagination-controls">
            <button className="upg-btn" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">«</button>
            <button className="upg-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page">
              <ChevronLeft size={14} aria-hidden="true" /> Prev
            </button>
            {Array.from({ length: numPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === numPages || Math.abs(p - page) <= 2)
              .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                acc.push(p); return acc;
              }, [])
              .map((p, i) => p === "…"
                ? <span key={`e${i}`} className="upg-ellipsis">…</span>
                : <button key={p} className={`upg-btn${p === page ? " upg-btn--active" : ""}`}
                    onClick={() => setPage(p as number)} aria-current={p === page ? "page" : undefined}>
                    {p}
                  </button>
              )}
            <button className="upg-btn" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page === numPages} aria-label="Next page">
              Next <ChevronRight size={14} aria-hidden="true" />
            </button>
            <button className="upg-btn" onClick={() => setPage(numPages)} disabled={page === numPages} aria-label="Last page">»</button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Add user modal
      ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showAddModal && (
          <>
            {/* Backdrop */}
            <motion.div key="add-bd" className="ann-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !addSaving && setShowAddModal(false)} />

            {/* Centering wrapper */}
            <div style={{ position: "fixed", inset: 0, zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
              <motion.div key="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title"
                initial={{ opacity: 0, scale: .96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: .96, y: 10 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
                style={{ background: "#fff", borderRadius: 18, boxShadow: "0 24px 64px rgba(15,23,42,.22)", width: "min(92vw, 560px)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", pointerEvents: "all" }}>

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px 14px", borderBottom: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ background: "#eef2ff", borderRadius: 10, padding: 8, display: "grid", placeItems: "center" }}>
                      <UserPlus size={18} style={{ color: "#234395" }} aria-hidden="true" />
                    </div>
                    <div>
                      <h2 id="add-user-title" style={{ margin: 0, fontSize: ".95rem", fontWeight: 800 }}>Add new user</h2>
                      <p style={{ margin: 0, fontSize: ".76rem", color: "#64748b" }}>Create an account manually.</p>
                    </div>
                  </div>
                  <button onClick={() => !addSaving && setShowAddModal(false)} aria-label="Close"
                    style={{ border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 4, display: "grid", placeItems: "center" }}>
                    <X size={20} />
                  </button>
                </div>

                {/* Body */}
                <form id="add-user-form" onSubmit={submitAdd} style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                  <div style={{ padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 14 }}>

                    {addErrors._ && <p style={{ margin: 0, color: "#991b1b", background: "#fee2e2", borderRadius: 8, padding: "9px 12px", fontSize: ".85rem" }} role="alert">{addErrors._}</p>}

                    {/* Email + Username */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {([
                        { id: "add-email",    label: "Email address", key: "email"    as const, type: "email",  ph: "user@iic.edu.np", req: true },
                        { id: "add-username", label: "Username",      key: "username" as const, type: "text",   ph: "john.doe",        req: true },
                      ] as const).map(({ id, label, key, type, ph, req }) => (
                        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label htmlFor={id} style={{ fontSize: ".78rem", fontWeight: 700, color: "#374151", display: "flex", gap: 4 }}>
                            {label}{req && <span style={{ color: "#ef4444" }}>*</span>}
                          </label>
                          <input id={id} type={type} required={req} value={addForm[key]}
                            onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={ph} autoComplete="off"
                            style={{ border: `1.5px solid ${addErrors[key] ? "#f87171" : "#e2e8f0"}`, borderRadius: 8, padding: "9px 11px", fontSize: ".88rem", width: "100%", boxSizing: "border-box" as const }} />
                          {addErrors[key] && <span style={{ color: "#dc2626", fontSize: ".74rem" }}>{addErrors[key]}</span>}
                        </div>
                      ))}
                    </div>

                    {/* First + Last name */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {([
                        { id: "add-first", label: "First name", key: "first_name" as const, ph: "John" },
                        { id: "add-last",  label: "Last name",  key: "last_name"  as const, ph: "Doe"  },
                      ] as const).map(({ id, label, key, ph }) => (
                        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label htmlFor={id} style={{ fontSize: ".78rem", fontWeight: 700, color: "#374151" }}>{label}</label>
                          <input id={id} type="text" value={addForm[key]}
                            onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={ph}
                            style={{ border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "9px 11px", fontSize: ".88rem", width: "100%", boxSizing: "border-box" as const }} />
                        </div>
                      ))}
                    </div>

                    {/* Initial roles */}
                    <div>
                      <p style={{ margin: "0 0 7px", fontSize: ".78rem", fontWeight: 700, color: "#374151" }}>
                        Initial roles <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                      </p>
                      <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden" }}>
                        {ALL_ROLES.map((role, i) => (
                          <label key={role.value} style={{
                            display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", padding: "9px 11px",
                            background: addRoles.has(role.value) ? "#eef2ff" : "#fff",
                            borderBottom: i < ALL_ROLES.length - 2 ? "1px solid #f1f5f9" : "none",
                            borderRight: i % 2 === 0 ? "1px solid #f1f5f9" : "none",
                            transition: "background 110ms",
                          }}>
                            <input type="checkbox" checked={addRoles.has(role.value)} onChange={() => toggleAddRole(role.value)}
                              style={{ marginTop: 3, flexShrink: 0, accentColor: "#234395" }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", fontSize: ".81rem", fontWeight: 700, color: addRoles.has(role.value) ? "#234395" : "#1e293b", lineHeight: 1.3 }}>{role.label}</span>
                              <span style={{ display: "block", fontSize: ".7rem", color: "#94a3b8", lineHeight: 1.4, marginTop: 1 }}>{role.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Password */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {([
                        { id: "add-pwd",     label: "Password",         key: "password"         as const, ph: "Min 8 characters" },
                        { id: "add-confirm", label: "Confirm password",  key: "confirm_password" as const, ph: "Repeat password"  },
                      ] as const).map(({ id, label, key, ph }) => (
                        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label htmlFor={id} style={{ fontSize: ".78rem", fontWeight: 700, color: "#374151" }}>{label}</label>
                          <div style={{ position: "relative" }}>
                            <input id={id} type={showPassword ? "text" : "password"} value={addForm[key]}
                              onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                              placeholder={ph} autoComplete="new-password"
                              style={{ border: `1.5px solid ${addErrors[key] ? "#f87171" : "#e2e8f0"}`, borderRadius: 8, padding: "9px 36px 9px 11px", fontSize: ".88rem", width: "100%", boxSizing: "border-box" as const }} />
                            <button type="button" onClick={() => setShowPassword((v) => !v)}
                              aria-label={showPassword ? "Hide password" : "Show password"}
                              style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 2, display: "flex" }}>
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                          {addErrors[key] && <span style={{ color: "#dc2626", fontSize: ".74rem" }}>{addErrors[key]}</span>}
                        </div>
                      ))}
                    </div>

                    <p style={{ margin: 0, fontSize: ".74rem", color: "#94a3b8", background: "#f8fafc", borderRadius: 8, padding: "8px 12px", lineHeight: 1.55 }}>
                      Set a password for direct login. Leave blank for Google SSO-only access.
                    </p>
                  </div>
                </form>

                {/* Footer */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "13px 22px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", flexShrink: 0 }}>
                  <button type="button" className="secondary-button" onClick={() => !addSaving && setShowAddModal(false)} disabled={addSaving}>Cancel</button>
                  <button type="submit" form="add-user-form" className="primary-button" disabled={addSaving}
                    style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {addSaving ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Creating…</> : <><Plus size={13} aria-hidden="true" /> Create account</>}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════════
          Delete confirmation dialog
      ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showDeleteConfirm && editing && (
          <>
            <motion.div key="del-bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 1100 }}
              onClick={() => !deleting && setShowDeleteConfirm(false)} />
            <div style={{ position: "fixed", inset: 0, zIndex: 1101, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
              <motion.div role="dialog" aria-modal="true" aria-labelledby="del-title"
                initial={{ opacity: 0, scale: .94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: .94 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}
                style={{ background: "#fff", borderRadius: 16, boxShadow: "0 24px 64px rgba(15,23,42,.3)", width: "min(92vw, 440px)", padding: "26px 26px 22px", pointerEvents: "all" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 18 }}>
                  <div style={{ background: "#fee2e2", borderRadius: 12, padding: 10, flexShrink: 0, display: "grid", placeItems: "center" }}>
                    <AlertTriangle size={22} style={{ color: "#dc2626" }} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 id="del-title" style={{ margin: "0 0 6px", fontSize: "1rem", fontWeight: 800 }}>Delete account permanently?</h2>
                    <p style={{ margin: 0, color: "#475569", fontSize: ".87rem", lineHeight: 1.6 }}>
                      This will permanently remove <strong>{editing.name}</strong> ({editing.email}) and all their data.
                      This action <strong>cannot be undone</strong>.
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" className="secondary-button" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
                  <button type="button" onClick={handleDelete} disabled={deleting}
                    style={{ border: 0, borderRadius: 9, padding: "10px 18px", background: "#dc2626", color: "#fff", fontWeight: 750, fontFamily: "inherit", cursor: deleting ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 7, opacity: deleting ? .7 : 1 }}>
                    {deleting ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Deleting…</> : <><Trash2 size={14} aria-hidden="true" /> Yes, delete account</>}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════════
          Account editor side-panel
      ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {editing && (
          <motion.aside key={editing.id} className="editor-panel user-editor"
            initial={{ opacity: 0, x: 28, scale: .985 }} animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }} transition={{ type: "spring", stiffness: 340, damping: 32 }}>

            {/* Header */}
            <header>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <UserAvatar user={editing} size={44} radius={13} />
                <div style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: ".72rem", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: ".1em", color: "#64748b",
                    marginBottom: 2 }}>Account controls</span>
                  <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 800,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {editing.name}
                    {editing.is_suspended && <span className="user-suspended-pill" style={{ marginLeft: 8 }}>Suspended</span>}
                  </h2>
                </div>
              </div>
              <button className="user-editor-close" aria-label="Close" onClick={closeEditor}>
                <X aria-hidden="true" />
              </button>
            </header>

            {/* Scrollable form */}
            <form onSubmit={submit}>
              <div className="user-editor-body">

                {/* Identity (read-only) */}
                <div className="user-editor-id-block">
                  <div className="user-editor-id-item">
                    <span>Username</span>
                    <strong>@{editing.username}</strong>
                  </div>
                  <div className="user-editor-id-item">
                    <span>Email</span>
                    <strong>{editing.email}</strong>
                  </div>
                </div>

                {/* Name fields */}
                <div className="user-editor-names">
                  <div className="user-editor-field">
                    <label htmlFor="ep-fname">First name</label>
                    <input id="ep-fname" name="first_name" defaultValue={editing.first_name} maxLength={150} placeholder="First name" />
                  </div>
                  <div className="user-editor-field">
                    <label htmlFor="ep-lname">Last name</label>
                    <input id="ep-lname" name="last_name" defaultValue={editing.last_name} maxLength={150} placeholder="Last name" />
                  </div>
                </div>

                {/* Account status */}
                <div className="perm-section">
                  <div className="perm-section-header">Account status</div>
                  <label className="perm-checkbox-row">
                    <input type="checkbox" name="is_active" defaultChecked={editing.is_active} />
                    <div className="perm-checkbox-text">
                      <strong>Active account</strong>
                      <small>Allow this user to sign in.</small>
                    </div>
                  </label>
                </div>

                {/* Role assignments */}
                <div className="perm-section">
                  <div className="perm-section-header">
                    Role assignments
                    {loadingRoles && <Loader2 className="spin" size={13} aria-label="Loading roles" />}
                  </div>
                  <div className="perm-roles-list">
                    {ALL_ROLES.map((role) => (
                      <label key={role.value} className={`perm-checkbox-row${activeRoles.has(role.value) ? " perm-checkbox-row--active" : ""}`}>
                        <input type="checkbox" name={`role_${role.value}`}
                          defaultChecked={activeRoles.has(role.value)}
                          key={`${role.value}-${activeRoles.has(role.value)}`}
                          disabled={loadingRoles} />
                        <div className="perm-checkbox-text">
                          <strong>{role.label}</strong>
                          <small>{role.description}</small>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <p className="account-date">Account created {formatDate(editing.date_joined)}</p>

                {/* Suspension */}
                <div className="perm-section">
                  <div className="perm-section-header">Suspension</div>

                  <div className="susp-row">
                    <div className={`susp-row-text${editing.is_suspended ? " susp-row-text--active" : ""}`}>
                      <strong>{editing.is_suspended ? "Account is suspended" : "Suspend account"}</strong>
                      <small>{editing.is_suspended ? "User is blocked from signing in." : "Block this user from signing in immediately."}</small>
                    </div>
                    {editing.is_suspended ? (
                      <button type="button" disabled={suspending} onClick={() => handleSuspend(false)}
                        style={{ border: "1px solid #86efac", borderRadius: 8, padding: "6px 12px", background: "#f0fdf4", color: "#166534", cursor: "pointer", fontSize: ".8rem", fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
                        {suspending ? <Loader2 size={12} className="spin" aria-hidden="true" /> : <CheckCircle2 size={12} aria-hidden="true" />}
                        Reinstate
                      </button>
                    ) : (
                      <button type="button" onClick={() => setShowSuspendForm((v) => !v)}
                        style={{ border: "1px solid #fca5a5", borderRadius: 8, padding: "6px 12px", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: ".8rem", fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
                        <ShieldOff size={12} aria-hidden="true" /> Suspend
                      </button>
                    )}
                  </div>

                  {editing.is_suspended && editing.suspension_reason && (
                    <div className="susp-reason-display">
                      <strong>Reason: </strong>{editing.suspension_reason}
                    </div>
                  )}

                  <AnimatePresence>
                    {showSuspendForm && !editing.is_suspended && (
                      <motion.div key="susp" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                        <div className="susp-form-wrap">
                          <label>
                            Reason <span style={{ fontWeight: 400, color: "#94a3b8" }}>(shown to user)</span>
                            <textarea rows={3} maxLength={500} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                              placeholder="e.g. Violation of acceptable use policy — please visit the IT & NOC helpdesk counter." />
                          </label>
                          <div className="susp-form-actions">
                            <button type="button" className="secondary-button" style={{ fontSize: ".82rem" }}
                              onClick={() => { setShowSuspendForm(false); setSuspendReason(""); }}>Cancel</button>
                            <button type="button" className="btn-suspend-confirm" disabled={suspending} onClick={() => handleSuspend(true)}>
                              {suspending ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Suspending…</> : <><ShieldOff size={13} aria-hidden="true" /> Confirm suspension</>}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── Django backend access (visible only to superusers) ── */}
                {viewerIsSuperuser && activeRoles.has("administrator") && editing.id !== undefined && (
                  <div className="perm-section">
                    <div className="perm-section-header" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <ShieldCheck size={13} style={{ color: "#7c3aed" }} aria-hidden="true" />
                      Django backend access
                    </div>

                    <div style={{
                      background: editing.is_superuser ? "#f5f3ff" : "#f8fafc",
                      border: `1px solid ${editing.is_superuser ? "#ddd6fe" : "#e2e8f0"}`,
                      borderRadius: 9, padding: "12px 14px",
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div>
                          <p style={{ margin: "0 0 3px", fontWeight: 750, fontSize: ".84rem",
                            color: editing.is_superuser ? "#5b21b6" : "#374151" }}>
                            {editing.is_superuser ? "Superuser — Django /admin/ access granted" : "Application admin only"}
                          </p>
                          <p style={{ margin: 0, fontSize: ".76rem", color: "#64748b", lineHeight: 1.55 }}>
                            {editing.is_superuser
                              ? "This user can access the Django backend panel at /admin/."
                              : "This user can use the Next.js admin panel but cannot access the Django backend."}
                          </p>
                        </div>
                        {editing.id !== undefined && (
                          <button
                            type="button"
                            disabled={settingSuperuser}
                            onClick={() => handleSetSuperuser(!editing.is_superuser)}
                            style={{
                              flexShrink: 0, border: `1px solid ${editing.is_superuser ? "#ddd6fe" : "#e2e8f0"}`,
                              borderRadius: 8, padding: "6px 11px", fontFamily: "inherit",
                              background: editing.is_superuser ? "#ede9fe" : "#f1f5f9",
                              color: editing.is_superuser ? "#6d28d9" : "#475569",
                              cursor: settingSuperuser ? "wait" : "pointer",
                              fontSize: ".78rem", fontWeight: 700,
                              display: "flex", alignItems: "center", gap: 5,
                              opacity: settingSuperuser ? 0.6 : 1,
                            }}
                          >
                            {settingSuperuser
                              ? <><Loader2 size={12} className="spin" aria-hidden="true" /> Updating…</>
                              : editing.is_superuser
                              ? <><ShieldOff size={12} aria-hidden="true" /> Revoke backend access</>
                              : <><ShieldCheck size={12} aria-hidden="true" /> Grant backend access</>
                            }
                          </button>
                        )}
                      </div>
                    </div>

                    <p style={{ margin: "7px 0 0", fontSize: ".72rem", color: "#94a3b8", lineHeight: 1.55 }}>
                      Only superusers can change this setting. The user must hold the Administrator role.
                    </p>
                  </div>
                )}

              </div>

              {/* Footer — Delete left, Save/Cancel right */}
              <div className="user-editor-footer">
                <button type="button" className="btn-danger-ghost" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>
                <div className="user-editor-footer-right">
                  <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
                  <button type="submit" className="primary-button" disabled={saving || loadingRoles}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
