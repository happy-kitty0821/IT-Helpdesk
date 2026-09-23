"use client";

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
import { csrfToken } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PagedUsers {
  count: number;
  num_pages: number;
  page: number;
  page_size: number;
  next: string | null;
  previous: string | null;
  results: ManagedUser[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(user: ManagedUser) {
  const value = user.name || user.username;
  return value.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
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

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ user }: { user: ManagedUser }) {
  if (user.is_suspended) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: "#fee2e2", color: "#991b1b",
        borderRadius: 999, padding: "3px 9px",
        fontSize: ".74rem", fontWeight: 800,
      }}>
        <ShieldOff size={11} aria-hidden="true" /> Suspended
      </span>
    );
  }
  if (user.is_active) {
    return (
      <span className="account-active">
        <CheckCircle2 aria-hidden="true" /> Active
      </span>
    );
  }
  return (
    <span className="account-inactive">
      <CheckCircle2 aria-hidden="true" /> Inactive
    </span>
  );
}

// ── Role badge ─────────────────────────────────────────────────────────────────
function RoleBadge({ roles }: { roles: RoleValue[] }) {
  if (roles.includes("administrator"))       return <span className="role-badge superuser"><ShieldCheck aria-hidden="true" /> Administrator</span>;
  if (roles.includes("service_lead"))        return <span className="role-badge staff">Service Lead</span>;
  if (roles.includes("it_agent"))            return <span className="role-badge staff">IT Agent</span>;
  if (roles.includes("it_noc_intern"))       return <span className="role-badge staff">IT NOC Intern</span>;
  if (roles.includes("content_editor"))      return <span className="role-badge staff">Content Editor</span>;
  if (roles.includes("designated_approver")) return <span className="role-badge staff">Designated Approver</span>;
  if (roles.includes("faculty_staff"))       return <span className="role-badge staff">Staff</span>;
  if (roles.includes("student"))             return <span className="role-badge member">Student</span>;
  return <span className="role-badge member">Visitor</span>;
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
  const [debouncedQuery, setDq] = useState("");
  const [listLoading, setLL]    = useState(false);

  // ── Editor panel ──────────────────────────────────────────────────────────
  const [editing, setEditing]         = useState<ManagedUser | null>(null);
  const [grants, setGrants]           = useState<RoleGrant[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving]           = useState(false);

  // ── Suspension ────────────────────────────────────────────────────────────
  const [suspending, setSuspending]          = useState(false);
  const [suspendReason, setSuspendReason]    = useState("");
  const [showSuspendForm, setShowSuspendForm] = useState(false);

  // ── Delete ────────────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting]                   = useState(false);

  // ── Add user modal ────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    email: "", username: "", first_name: "", last_name: "",
    password: "", confirm_password: "",
  });
  const [showPassword, setShowPassword]   = useState(false);
  const [addRoles, setAddRoles]           = useState<Set<RoleValue>>(new Set());
  const [addErrors, setAddErrors]         = useState<Record<string, string>>({});
  const [addSaving, setAddSaving]         = useState(false);

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [error, setError]   = useState("");
  const [notice, setNotice] = useState("");

  // ── Debounce search ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setDq(query); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── Load page ─────────────────────────────────────────────────────────────
  const loadPage = useCallback(async (p: number, ps: number, q: string) => {
    setLL(true);
    try {
      const params = new URLSearchParams({ page: String(p), page_size: String(ps) });
      if (q) params.set("q", q);
      const res = await fetch(`/api/v1/admin/users/?${params}`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Could not load users.");
      const data = await res.json() as PagedUsers;
      setUsers(data.results);
      setCount(data.count);
      setNumPages(data.num_pages);
      setPage(data.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setLL(false);
    }
  }, []);

  useEffect(() => { loadPage(page, pageSize, debouncedQuery); }, [page, pageSize, debouncedQuery, loadPage]);

  // ── Active roles memo ─────────────────────────────────────────────────────
  const activeRoles = useMemo<Set<RoleValue>>(
    () => new Set(grants.map((g) => g.role as RoleValue)),
    [grants],
  );

  // ── Open editor ───────────────────────────────────────────────────────────
  async function openEditor(user: ManagedUser) {
    setEditing(user);
    setGrants([]);
    setLoadingRoles(true);
    setError("");
    setShowSuspendForm(false);
    setSuspendReason("");
    setShowDeleteConfirm(false);
    try {
      setGrants(await getUserRoles(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load roles.");
    } finally {
      setLoadingRoles(false);
    }
  }

  function closeEditor() {
    setEditing(null);
    setGrants([]);
    setShowSuspendForm(false);
    setSuspendReason("");
    setShowDeleteConfirm(false);
  }

  // ── Save profile changes ──────────────────────────────────────────────────
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const desired = new Set(
      ALL_ROLES.map((r) => r.value).filter((v) => form.get(`role_${v}`) === "on")
    ) as Set<RoleValue>;
    const toGrant  = [...desired].filter((r) => !activeRoles.has(r));
    const toRevoke = [...activeRoles].filter((r) => !desired.has(r));
    try {
      await adminSave<ManagedUser>("users", {
        first_name: form.get("first_name"),
        last_name:  form.get("last_name"),
        is_active:  form.get("is_active") === "on",
      }, editing.id);
      await Promise.all([
        ...toGrant.map((r)  => grantRole(editing.id, r)),
        ...toRevoke.map((r) => revokeRole(editing.id, r)),
      ]);
      closeEditor();
      setNotice(`${editing.name} updated.`);
      loadPage(page, pageSize, debouncedQuery);
    } catch (e) {
      setError(e instanceof Error ? e.message : "User could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  // ── Suspend / unsuspend ───────────────────────────────────────────────────
  async function handleSuspend(doSuspend: boolean) {
    if (!editing) return;
    setSuspending(true);
    setError(""); setNotice("");
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
      closeEditor();
      loadPage(page, pageSize, debouncedQuery);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suspension could not be updated.");
    } finally {
      setSuspending(false);
    }
  }

  // ── Delete user ───────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!editing) return;
    setDeleting(true);
    setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/users/${editing.id}/delete/`, {
        method: "DELETE", credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not delete user.");
      setNotice(typeof data.detail === "string" ? data.detail : `${editing.name} deleted.`);
      closeEditor();
      loadPage(page, pageSize, debouncedQuery);
    } catch (e) {
      setError(e instanceof Error ? e.message : "User could not be deleted.");
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  // ── Create user ───────────────────────────────────────────────────────────
  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddSaving(true);
    setAddErrors({});
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
        for (const [k, v] of Object.entries(data)) {
          errs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        }
        setAddErrors(Object.keys(errs).length ? errs : { _: messageFrom(data) });
        return;
      }
      const created = data as ManagedUser;
      setShowAddModal(false);
      setAddForm({ email: "", username: "", first_name: "", last_name: "", password: "", confirm_password: "" });
      setShowPassword(false);
      setAddRoles(new Set());
      setNotice(`Account for ${created.name || created.username} created.`);
      setPage(1);
      loadPage(1, pageSize, debouncedQuery);
    } catch {
      setAddErrors({ _: "A network error occurred." });
    } finally {
      setAddSaving(false);
    }
  }

  function toggleAddRole(role: RoleValue) {
    setAddRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeCount    = users.filter((u) => u.is_active && !u.is_suspended).length;
  const suspendedCount = users.filter((u) => u.is_suspended).length;
  const adminCount     = users.filter((u) => u.roles?.includes("administrator")).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="admin-content" style={{ paddingRight: editing ? 520 : undefined, transition: "padding-right 280ms ease" }}>

      {/* ── Header ── */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>User management</h1>
          <p>Review college accounts, manage role assignments, suspend or remove users.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div className="user-summary">
            <span><Users aria-hidden="true" /><strong>{totalCount}</strong> total</span>
            <span><ShieldCheck aria-hidden="true" /><strong>{adminCount}</strong> admin</span>
            <span><CheckCircle2 aria-hidden="true" /><strong>{activeCount}</strong> active</span>
            {suspendedCount > 0 && (
              <span style={{ color: "#991b1b", background: "#fee2e2", border: "1px solid #fca5a5" }}>
                <ShieldOff size={14} aria-hidden="true" style={{ color: "#dc2626" }} />
                <strong>{suspendedCount}</strong> suspended
              </span>
            )}
          </div>
          <button
            className="primary-button"
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: ".85rem", padding: "9px 16px" }}
            onClick={() => { setShowAddModal(true); setAddErrors({}); }}
          >
            <UserPlus size={15} aria-hidden="true" /> Add user
          </button>
        </div>
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

      {/* ── Toolbar ── */}
      <div className="user-toolbar">
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, username, or email"
          aria-label="Search users"
        />
        <span>{listLoading ? "Loading…" : `${totalCount} result${totalCount !== 1 ? "s" : ""}`}</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".8rem", color: "#64748b", marginLeft: "auto" }}>
          Per page
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            style={{ border: "1px solid #cbd5e1", borderRadius: 7, padding: "4px 8px", fontSize: ".82rem" }}
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* ── Table ── */}
      <section className="user-table" aria-label="College users" aria-busy={listLoading}>
        <div className="user-table-head">
          <span>User</span><span>Role</span><span>Last sign-in</span><span>Status</span><span></span>
        </div>
        {listLoading && users.length === 0 ? (
          <div className="user-empty">
            <Loader2 className="spin" aria-hidden="true" />
            <p>Loading users…</p>
          </div>
        ) : users.length === 0 ? (
          <div className="user-empty">
            <UserRound aria-hidden="true" />
            <p>No users match this search.</p>
          </div>
        ) : users.map((user, index) => (
          <motion.article
            key={user.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.025, 0.15) }}
            style={{
              opacity: listLoading ? 0.5 : 1,
              transition: "opacity 200ms",
              background: user.is_suspended ? "#fff8f8" : undefined,
            }}
          >
            <div className="user-identity">
              <span className="user-avatar"
                style={{ background: user.is_suspended ? "linear-gradient(145deg,#7f1d1d,#991b1b)" : undefined }}>
                {initials(user) || <UserRound aria-hidden="true" />}
              </span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
                <small>@{user.username}</small>
              </span>
            </div>
            <div className="role-stack"><RoleBadge roles={user.roles ?? []} /></div>
            <span>{formatDate(user.last_login)}</span>
            <StatusBadge user={user} />
            <button aria-label={`Edit ${user.name}`} onClick={() => openEditor(user)}>
              <Pencil aria-hidden="true" />
            </button>
          </motion.article>
        ))}
      </section>

      {/* ── Pagination ── */}
      {numPages > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 4px", marginTop: 4, flexWrap: "wrap", gap: 10,
        }}>
          <span style={{ fontSize: ".83rem", color: "#64748b" }}>
            Page <strong>{page}</strong> of <strong>{numPages}</strong>
            &nbsp;·&nbsp;{totalCount} total user{totalCount !== 1 ? "s" : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setPage(1)} disabled={page === 1} aria-label="First page"
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 10px", background: "#fff", cursor: page === 1 ? "not-allowed" : "pointer", color: page === 1 ? "#cbd5e1" : "#374151", fontSize: ".82rem" }}>«</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page"
              style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 12px", background: "#fff", cursor: page === 1 ? "not-allowed" : "pointer", color: page === 1 ? "#cbd5e1" : "#374151", fontSize: ".82rem" }}>
              <ChevronLeft size={14} aria-hidden="true" /> Prev
            </button>
            {Array.from({ length: numPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === numPages || Math.abs(p - page) <= 2)
              .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) => p === "…"
                ? <span key={`e${i}`} style={{ padding: "5px 4px", color: "#94a3b8", fontSize: ".82rem" }}>…</span>
                : <button key={p} onClick={() => setPage(p as number)} aria-current={p === page ? "page" : undefined}
                    style={{ border: p === page ? "1.5px solid #234395" : "1px solid #e2e8f0", borderRadius: 8, padding: "5px 10px", background: p === page ? "#234395" : "#fff", color: p === page ? "#fff" : "#374151", fontWeight: p === page ? 700 : 400, cursor: "pointer", fontSize: ".82rem", minWidth: 34 }}>
                    {p}
                  </button>
              )}
            <button onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page === numPages} aria-label="Next page"
              style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 12px", background: "#fff", cursor: page === numPages ? "not-allowed" : "pointer", color: page === numPages ? "#cbd5e1" : "#374151", fontSize: ".82rem" }}>
              Next <ChevronRight size={14} aria-hidden="true" />
            </button>
            <button onClick={() => setPage(numPages)} disabled={page === numPages} aria-label="Last page"
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 10px", background: "#fff", cursor: page === numPages ? "not-allowed" : "pointer", color: page === numPages ? "#cbd5e1" : "#374151", fontSize: ".82rem" }}>»</button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Add user modal
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div key="add-bd"
              className="ann-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !addSaving && setShowAddModal(false)}
            />
            <div style={{ position: "fixed", inset: 0, zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
              <motion.div key="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title"
                initial={{ opacity: 0, scale: .96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: .96, y: 10 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                style={{ background: "#fff", borderRadius: 18, boxShadow: "0 24px 64px rgba(15,23,42,.22)", width: "min(92vw, 540px)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", pointerEvents: "all" }}>

                {/* Modal header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 16px", borderBottom: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ background: "#eef2ff", borderRadius: 10, padding: 8 }}>
                      <UserPlus size={18} style={{ color: "#234395" }} aria-hidden="true" />
                    </div>
                    <div>
                      <h2 id="add-user-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>Add new user</h2>
                      <p style={{ margin: 0, fontSize: ".78rem", color: "#64748b" }}>Create an account manually.</p>
                    </div>
                  </div>
                  <button onClick={() => !addSaving && setShowAddModal(false)} aria-label="Close"
                    style={{ border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 4 }}>
                    <X size={20} />
                  </button>
                </div>

                {/* Modal body */}
                <form id="add-user-form" onSubmit={submitAdd} style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                  <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
                    {addErrors._ && <p style={{ margin: 0, color: "#991b1b", background: "#fee2e2", borderRadius: 8, padding: "9px 12px", fontSize: ".85rem" }} role="alert">{addErrors._}</p>}

                    {/* Email + Username */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {[
                        { id: "add-email", label: "Email address", key: "email" as const, type: "email", placeholder: "user@iic.edu.np" },
                        { id: "add-username", label: "Username", key: "username" as const, type: "text", placeholder: "john.doe" },
                      ].map(({ id, label, key, type, placeholder }) => (
                        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label htmlFor={id} style={{ fontSize: ".8rem", fontWeight: 700, color: "#374151", display: "flex", gap: 4 }}>
                            {label} <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <input id={id} type={type} required
                            value={addForm[key]}
                            onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder} autoComplete="off"
                            style={{ border: `1.5px solid ${addErrors[key] ? "#f87171" : "#cbd5e1"}`, borderRadius: 8, padding: "9px 11px", fontSize: ".88rem", width: "100%", boxSizing: "border-box" }}
                          />
                          {addErrors[key] && <span style={{ color: "#dc2626", fontSize: ".75rem" }}>{addErrors[key]}</span>}
                        </div>
                      ))}
                    </div>

                    {/* First + Last name */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {[
                        { id: "add-first", label: "First name", key: "first_name" as const, placeholder: "John" },
                        { id: "add-last",  label: "Last name",  key: "last_name"  as const, placeholder: "Doe"  },
                      ].map(({ id, label, key, placeholder }) => (
                        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label htmlFor={id} style={{ fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>{label}</label>
                          <input id={id} type="text"
                            value={addForm[key]}
                            onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder}
                            style={{ border: "1.5px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: ".88rem", width: "100%", boxSizing: "border-box" }}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Initial roles */}
                    <div>
                      <p style={{ margin: "0 0 8px", fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>
                        Initial roles <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                      </p>
                      <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden" }}>
                        {ALL_ROLES.map((role, i) => (
                          <label key={role.value} style={{
                            display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px",
                            background: addRoles.has(role.value) ? "#eef2ff" : "#fff",
                            borderBottom: i < ALL_ROLES.length - 2 ? "1px solid #f1f5f9" : "none",
                            borderRight: i % 2 === 0 ? "1px solid #f1f5f9" : "none",
                            transition: "background 120ms",
                          }}>
                            <input type="checkbox" checked={addRoles.has(role.value)} onChange={() => toggleAddRole(role.value)}
                              style={{ marginTop: 3, flexShrink: 0, accentColor: "#234395" }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", fontSize: ".82rem", fontWeight: 700, color: addRoles.has(role.value) ? "#234395" : "#1e293b", lineHeight: 1.3 }}>{role.label}</span>
                              <span style={{ display: "block", fontSize: ".71rem", color: "#94a3b8", lineHeight: 1.4, marginTop: 1 }}>{role.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Password */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {[
                        { id: "add-password", label: "Password", key: "password" as const, placeholder: "Min 8 characters" },
                        { id: "add-confirm",  label: "Confirm password", key: "confirm_password" as const, placeholder: "Repeat password" },
                      ].map(({ id, label, key, placeholder }) => (
                        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label htmlFor={id} style={{ fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>{label}</label>
                          <div style={{ position: "relative" }}>
                            <input id={id} type={showPassword ? "text" : "password"}
                              value={addForm[key]}
                              onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                              placeholder={placeholder} autoComplete="new-password"
                              style={{ border: `1.5px solid ${addErrors[key] ? "#f87171" : "#cbd5e1"}`, borderRadius: 8, padding: "9px 36px 9px 11px", fontSize: ".88rem", width: "100%", boxSizing: "border-box" }}
                            />
                            <button type="button" onClick={() => setShowPassword((v) => !v)}
                              aria-label={showPassword ? "Hide password" : "Show password"}
                              style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 2, display: "flex" }}>
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                          {addErrors[key] && <span style={{ color: "#dc2626", fontSize: ".75rem" }}>{addErrors[key]}</span>}
                        </div>
                      ))}
                    </div>

                    <p style={{ margin: 0, fontSize: ".75rem", color: "#64748b", background: "#f8fafc", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
                      Set a password for direct login. Leave blank for Google SSO-only access.
                    </p>
                  </div>
                </form>

                {/* Modal footer */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  <button type="button" className="secondary-button" onClick={() => !addSaving && setShowAddModal(false)} disabled={addSaving}>Cancel</button>
                  <button type="submit" form="add-user-form" className="primary-button" disabled={addSaving} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {addSaving ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Creating…</> : <><Plus size={14} aria-hidden="true" /> Create account</>}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════
          Delete confirmation dialog
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showDeleteConfirm && editing && (
          <>
            <motion.div key="del-bd"
              style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 1100 }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !deleting && setShowDeleteConfirm(false)}
            />
            <div style={{ position: "fixed", inset: 0, zIndex: 1101, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
              <motion.div role="dialog" aria-modal="true" aria-labelledby="del-title"
                initial={{ opacity: 0, scale: .94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: .94 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                style={{ background: "#fff", borderRadius: 16, boxShadow: "0 24px 64px rgba(15,23,42,.3)", width: "min(92vw, 440px)", padding: "28px 28px 22px", pointerEvents: "all" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 18 }}>
                  <div style={{ background: "#fee2e2", borderRadius: 12, padding: 10, flexShrink: 0 }}>
                    <AlertTriangle size={22} style={{ color: "#dc2626" }} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 id="del-title" style={{ margin: "0 0 6px", fontSize: "1.05rem", fontWeight: 800 }}>Delete account permanently?</h2>
                    <p style={{ margin: 0, color: "#475569", fontSize: ".88rem", lineHeight: 1.55 }}>
                      This will permanently remove <strong>{editing.name}</strong> ({editing.email}) and all their data.
                      This action <strong>cannot be undone</strong>.
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" className="secondary-button" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                    Cancel
                  </button>
                  <button type="button" onClick={handleDelete} disabled={deleting}
                    style={{ border: 0, borderRadius: 9, padding: "10px 18px", background: "#dc2626", color: "#fff", fontWeight: 750, cursor: deleting ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 7, opacity: deleting ? 0.7 : 1 }}>
                    {deleting ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Deleting…</> : <><Trash2 size={14} aria-hidden="true" /> Yes, delete account</>}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════
          Edit panel
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {editing && (
          <motion.aside
            key={editing.id}
            className="editor-panel user-editor"
            initial={{ opacity: 0, x: 28, scale: .985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
          >
            {/* ── Panel header ── */}
            <header>
              <div>
                <span>Account controls</span>
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {editing.name}
                  {editing.is_suspended && (
                    <span style={{ fontSize: ".7rem", fontWeight: 700, background: "#fee2e2", color: "#991b1b", borderRadius: 999, padding: "2px 8px", letterSpacing: ".02em" }}>
                      SUSPENDED
                    </span>
                  )}
                </h2>
              </div>
              <button aria-label="Close editor" onClick={closeEditor}><X aria-hidden="true" /></button>
            </header>

            <form onSubmit={submit}>
              {/* Read-only info */}
              <div className="account-readonly">
                <span>Username<strong>@{editing.username}</strong></span>
                <span>Email<strong>{editing.email}</strong></span>
              </div>

              {/* Name fields */}
              <div className="form-pair">
                <label>First name<input name="first_name" defaultValue={editing.first_name} maxLength={150} /></label>
                <label>Last name<input  name="last_name"  defaultValue={editing.last_name}  maxLength={150} /></label>
              </div>

              {/* Account status */}
              <fieldset className="permission-options">
                <legend>Account status</legend>
                <label>
                  <input type="checkbox" name="is_active" defaultChecked={editing.is_active} />
                  <span><strong>Active account</strong><small>Allow this user to sign in.</small></span>
                </label>
              </fieldset>

              {/* Role assignments */}
              <fieldset className="permission-options role-permissions">
                <legend>
                  Role assignments
                  {loadingRoles && <Loader2 className="spin" aria-label="Loading roles" />}
                </legend>
                {ALL_ROLES.map((role) => (
                  <label key={role.value} className={activeRoles.has(role.value) ? "role-row active" : "role-row"}>
                    <input type="checkbox" name={`role_${role.value}`}
                      defaultChecked={activeRoles.has(role.value)}
                      key={`${role.value}-${activeRoles.has(role.value)}`}
                      disabled={loadingRoles}
                    />
                    <span><strong>{role.label}</strong><small>{role.description}</small></span>
                  </label>
                ))}
              </fieldset>

              <p className="account-date">Account created {formatDate(editing.date_joined)}</p>

              {/* ── Suspension section ── */}
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14, marginTop: 2, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <strong style={{ fontSize: ".85rem", color: editing.is_suspended ? "#991b1b" : "#334155" }}>
                      {editing.is_suspended ? "Account is suspended" : "Suspend account"}
                    </strong>
                    <small style={{ display: "block", color: "#64748b", fontSize: ".75rem", marginTop: 2 }}>
                      {editing.is_suspended
                        ? "User is blocked from signing in."
                        : "Block this user from signing in immediately."}
                    </small>
                  </div>
                  {editing.is_suspended ? (
                    <button type="button" disabled={suspending} onClick={() => handleSuspend(false)}
                      style={{ border: "1px solid #86efac", borderRadius: 8, padding: "6px 12px", background: "#f0fdf4", color: "#166534", cursor: "pointer", fontSize: ".8rem", fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      {suspending ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
                      Reinstate
                    </button>
                  ) : (
                    <button type="button" onClick={() => setShowSuspendForm((v) => !v)}
                      style={{ border: "1px solid #fca5a5", borderRadius: 8, padding: "6px 12px", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: ".8rem", fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <ShieldOff size={13} aria-hidden="true" /> Suspend
                    </button>
                  )}
                </div>

                {/* Current reason */}
                {editing.is_suspended && editing.suspension_reason && (
                  <div style={{ background: "#fee2e2", borderRadius: 8, padding: "8px 11px", fontSize: ".8rem", color: "#7f1d1d", lineHeight: 1.5 }}>
                    <strong>Reason: </strong>{editing.suspension_reason}
                  </div>
                )}

                {/* Suspension form */}
                <AnimatePresence>
                  {showSuspendForm && !editing.is_suspended && (
                    <motion.div key="susp-form"
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: "hidden" }}>
                      <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                        <label style={{ fontSize: ".8rem", fontWeight: 700, color: "#7f1d1d", display: "grid", gap: 5 }}>
                          Reason <span style={{ fontWeight: 400, color: "#94a3b8" }}>(shown to user)</span>
                          <textarea rows={3} maxLength={500} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                            placeholder="e.g. Violation of acceptable use policy — please visit the IT & NOC helpdesk counter."
                            style={{ border: "1px solid #fca5a5", borderRadius: 7, padding: "8px 10px", fontSize: ".85rem", fontWeight: 400, resize: "vertical", background: "#fff" }}
                          />
                        </label>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button type="button" className="secondary-button" onClick={() => { setShowSuspendForm(false); setSuspendReason(""); }} style={{ fontSize: ".82rem" }}>Cancel</button>
                          <button type="button" disabled={suspending} onClick={() => handleSuspend(true)}
                            style={{ border: 0, borderRadius: 8, padding: "8px 14px", background: "#dc2626", color: "#fff", cursor: "pointer", fontSize: ".82rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                            {suspending ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <ShieldOff size={13} aria-hidden="true" />}
                            Confirm suspension
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Footer: Save + Delete ── */}
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14, marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                {/* Delete button — left side */}
                <button type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label={`Delete ${editing.name}`}
                  style={{ border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", background: "#fff", color: "#dc2626", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: ".82rem", fontWeight: 700 }}>
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>

                {/* Save + Cancel — right side */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
                  <button className="primary-button" type="submit" disabled={saving || loadingRoles}>
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
