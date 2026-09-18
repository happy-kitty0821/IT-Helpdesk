"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2, ChevronLeft, ChevronRight, Loader2,
  Pencil, Plus, Search, ShieldCheck, UserPlus, UserRound, Users, X,
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

// ── Small helpers ─────────────────────────────────────────────────────────────

function initials(user: ManagedUser) {
  const value = user.name || user.username;
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
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

function RoleBadge({ roles }: { roles: RoleValue[] }) {
  if (roles.includes("administrator"))      return <span className="role-badge superuser"><ShieldCheck aria-hidden="true" /> Administrator</span>;
  if (roles.includes("service_lead"))       return <span className="role-badge staff">Service Lead</span>;
  if (roles.includes("it_agent"))           return <span className="role-badge staff">IT Agent</span>;
  if (roles.includes("it_noc_intern"))      return <span className="role-badge staff">IT NOC Intern</span>;
  if (roles.includes("content_editor"))     return <span className="role-badge staff">Content Editor</span>;
  if (roles.includes("designated_approver")) return <span className="role-badge staff">Designated Approver</span>;
  if (roles.includes("faculty_staff"))      return <span className="role-badge staff">Staff</span>;
  if (roles.includes("student"))            return <span className="role-badge member">Student</span>;
  return <span className="role-badge member">Visitor</span>;
}

const PAGE_SIZES = [10, 20, 50, 100];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UserManagement() {
  // ── List state ────────────────────────────────────────────────────────────
  const [users, setUsers]       = useState<ManagedUser[]>([]);
  const [totalCount, setCount]  = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery]       = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // ── Edit panel state ──────────────────────────────────────────────────────
  const [editing, setEditing]       = useState<ManagedUser | null>(null);
  const [grants, setGrants]         = useState<RoleGrant[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving]         = useState(false);

  // ── Add user modal state ──────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    email: "", username: "", first_name: "", last_name: "",
  });
  const [addRoles, setAddRoles] = useState<Set<RoleValue>>(new Set());
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [addSaving, setAddSaving] = useState(false);

  // ── Shared feedback ───────────────────────────────────────────────────────
  const [error, setError]   = useState("");
  const [notice, setNotice] = useState("");

  // ── Debounce search ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── Load page ─────────────────────────────────────────────────────────────
  const loadPage = useCallback(async (p: number, ps: number, q: string) => {
    setListLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), page_size: String(ps) });
      if (q) params.set("q", q);
      const res = await fetch(`/api/v1/admin/users/?${params}`, {
        credentials: "include", cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load users.");
      const data = await res.json() as PagedUsers;
      setUsers(data.results);
      setCount(data.count);
      setNumPages(data.num_pages);
      setPage(data.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { loadPage(page, pageSize, debouncedQuery); }, [page, pageSize, debouncedQuery, loadPage]);

  // ── Active roles for editing panel ────────────────────────────────────────
  const activeRoles = useMemo<Set<RoleValue>>(
    () => new Set(grants.map((g) => g.role as RoleValue)),
    [grants],
  );

  async function openEditor(user: ManagedUser) {
    setEditing(user);
    setGrants([]);
    setLoadingRoles(true);
    setError("");
    try {
      setGrants(await getUserRoles(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load roles.");
    } finally {
      setLoadingRoles(false);
    }
  }

  // ── Save edits ────────────────────────────────────────────────────────────
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
      setEditing(null); setGrants([]);
      setNotice(`${editing.name} updated.`);
      loadPage(page, pageSize, debouncedQuery);
    } catch (e) {
      setError(e instanceof Error ? e.message : "User could not be updated.");
    } finally {
      setSaving(false);
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
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({
          ...addForm,
          initial_roles: [...addRoles],
        }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        // Map field-level errors
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          errs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        }
        setAddErrors(Object.keys(errs).length ? errs : { _: messageFrom(data) });
        return;
      }
      const created = data as ManagedUser;
      setShowAddModal(false);
      setAddForm({ email: "", username: "", first_name: "", last_name: "" });
      setAddRoles(new Set());
      setNotice(`Account for ${created.name || created.username} created successfully.`);
      // Go to first page to see the new user
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
  const activeCount = users.filter((u) => u.is_active).length;
  const adminCount  = users.filter((u) => u.roles?.includes("administrator")).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="admin-content" style={{ paddingRight: editing ? 520 : undefined, transition: "padding-right 280ms ease" }}>

      {/* Header */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>User management</h1>
          <p>Review college accounts, manage role assignments, and create users manually.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div className="user-summary">
            <span><Users aria-hidden="true" /><strong>{totalCount}</strong> total</span>
            <span><ShieldCheck aria-hidden="true" /><strong>{adminCount}</strong> admin</span>
            <span><CheckCircle2 aria-hidden="true" /><strong>{activeCount}</strong> active on page</span>
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

      {notice && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-notice" role="status">{notice}</motion.p>}
      {error  && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-error"  role="alert">{error}</motion.p>}

      {/* Toolbar */}
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

      {/* Table */}
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
        ) : (
          users.map((user, index) => (
            <motion.article
              key={user.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.025, 0.15) }}
              style={{ opacity: listLoading ? 0.5 : 1, transition: "opacity 200ms" }}
            >
              <div className="user-identity">
                <span className="user-avatar">{initials(user) || <UserRound aria-hidden="true" />}</span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                  <small>@{user.username}</small>
                </span>
              </div>
              <div className="role-stack"><RoleBadge roles={user.roles ?? []} /></div>
              <span>{formatDate(user.last_login)}</span>
              <span className={user.is_active ? "account-active" : "account-inactive"}>
                <CheckCircle2 aria-hidden="true" />{user.is_active ? "Active" : "Inactive"}
              </span>
              <button aria-label={`Edit ${user.name}`} onClick={() => openEditor(user)}>
                <Pencil aria-hidden="true" />
              </button>
            </motion.article>
          ))
        )}
      </section>

      {/* Pagination controls */}
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
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              aria-label="First page"
              style={{
                border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 10px",
                background: "#fff", cursor: page === 1 ? "not-allowed" : "pointer",
                color: page === 1 ? "#cbd5e1" : "#374151", fontSize: ".82rem",
              }}
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="Previous page"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 12px",
                background: "#fff", cursor: page === 1 ? "not-allowed" : "pointer",
                color: page === 1 ? "#cbd5e1" : "#374151", fontSize: ".82rem",
              }}
            ><ChevronLeft size={14} aria-hidden="true" /> Prev</button>

            {/* Page number pills */}
            {Array.from({ length: numPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === numPages || Math.abs(p - page) <= 2)
              .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span key={`ellipsis-${i}`} style={{ padding: "5px 4px", color: "#94a3b8", fontSize: ".82rem" }}>…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    aria-current={p === page ? "page" : undefined}
                    style={{
                      border: p === page ? "1.5px solid #234395" : "1px solid #e2e8f0",
                      borderRadius: 8, padding: "5px 10px",
                      background: p === page ? "#234395" : "#fff",
                      color: p === page ? "#fff" : "#374151",
                      fontWeight: p === page ? 700 : 400,
                      cursor: "pointer", fontSize: ".82rem", minWidth: 34,
                    }}
                  >{p}</button>
                )
              )
            }

            <button
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
              disabled={page === numPages}
              aria-label="Next page"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 12px",
                background: "#fff", cursor: page === numPages ? "not-allowed" : "pointer",
                color: page === numPages ? "#cbd5e1" : "#374151", fontSize: ".82rem",
              }}
            >Next <ChevronRight size={14} aria-hidden="true" /></button>
            <button
              onClick={() => setPage(numPages)}
              disabled={page === numPages}
              aria-label="Last page"
              style={{
                border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 10px",
                background: "#fff", cursor: page === numPages ? "not-allowed" : "pointer",
                color: page === numPages ? "#cbd5e1" : "#374151", fontSize: ".82rem",
              }}
            >»</button>
          </div>
        </div>
      )}

      {/* ── Add user modal ── */}
      <AnimatePresence>
        {showAddModal && (
          <>
            {/* Backdrop */}
            <motion.div
              key="add-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000 }}
              onClick={() => !addSaving && setShowAddModal(false)}
            />
            {/* Centering wrapper — separate from motion so transform is not clobbered */}
            <div
              style={{
                position: "fixed", inset: 0, zIndex: 1001,
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none",
              }}
            >
            {/* Modal */}
            <motion.div
              key="add-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-user-title"
              initial={{ opacity: 0, scale: .96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: .96, y: 10 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              style={{
                background: "#fff",
                borderRadius: 18, boxShadow: "0 24px 64px rgba(15,23,42,.22)",
                width: "min(92vw, 540px)", maxHeight: "88vh",
                display: "flex", flexDirection: "column", overflow: "hidden",
                pointerEvents: "all",
              }}
            >
              {/* Modal header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "20px 24px 16px", borderBottom: "1px solid #e2e8f0",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ background: "#eef2ff", borderRadius: 10, padding: 8 }}>
                    <UserPlus size={18} style={{ color: "#234395" }} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 id="add-user-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>Add new user</h2>
                    <p style={{ margin: 0, fontSize: ".78rem", color: "#64748b" }}>
                      Creates an account with no password. User signs in via Google SSO.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !addSaving && setShowAddModal(false)}
                  aria-label="Close"
                  style={{ border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 4 }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal body */}
              <form id="add-user-form" onSubmit={submitAdd} style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>

                  {addErrors._ && (
                    <p style={{ margin: 0, color: "#991b1b", background: "#fee2e2", borderRadius: 8, padding: "9px 12px", fontSize: ".85rem" }} role="alert">
                      {addErrors._}
                    </p>
                  )}

                  {/* Email + Username row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {/* Email */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label htmlFor="add-email" style={{ fontSize: ".8rem", fontWeight: 700, color: "#374151", display: "flex", alignItems: "center", gap: 4 }}>
                        Email address <span style={{ color: "#ef4444" }} aria-hidden="true">*</span>
                      </label>
                      <input
                        id="add-email"
                        type="email" required
                        value={addForm.email}
                        onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="user@iic.edu.np"
                        style={{
                          border: `1.5px solid ${addErrors.email ? "#f87171" : "#cbd5e1"}`,
                          borderRadius: 8, padding: "9px 11px", fontSize: ".88rem",
                          width: "100%", boxSizing: "border-box",
                          outline: "none", transition: "border-color 150ms",
                        }}
                      />
                      {addErrors.email && <span style={{ color: "#dc2626", fontSize: ".75rem", marginTop: 1 }}>{addErrors.email}</span>}
                    </div>
                    {/* Username */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label htmlFor="add-username" style={{ fontSize: ".8rem", fontWeight: 700, color: "#374151", display: "flex", alignItems: "center", gap: 4 }}>
                        Username <span style={{ color: "#ef4444" }} aria-hidden="true">*</span>
                      </label>
                      <input
                        id="add-username"
                        type="text" required
                        value={addForm.username}
                        onChange={(e) => setAddForm((p) => ({ ...p, username: e.target.value }))}
                        placeholder="john.doe"
                        autoComplete="off"
                        style={{
                          border: `1.5px solid ${addErrors.username ? "#f87171" : "#cbd5e1"}`,
                          borderRadius: 8, padding: "9px 11px", fontSize: ".88rem",
                          width: "100%", boxSizing: "border-box",
                          outline: "none", transition: "border-color 150ms",
                        }}
                      />
                      {addErrors.username && <span style={{ color: "#dc2626", fontSize: ".75rem", marginTop: 1 }}>{addErrors.username}</span>}
                    </div>
                  </div>

                  {/* Name row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label htmlFor="add-first" style={{ fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>
                        First name
                      </label>
                      <input
                        id="add-first"
                        type="text"
                        value={addForm.first_name}
                        onChange={(e) => setAddForm((p) => ({ ...p, first_name: e.target.value }))}
                        placeholder="John"
                        style={{
                          border: "1.5px solid #cbd5e1", borderRadius: 8,
                          padding: "9px 11px", fontSize: ".88rem",
                          width: "100%", boxSizing: "border-box",
                          outline: "none",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label htmlFor="add-last" style={{ fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>
                        Last name
                      </label>
                      <input
                        id="add-last"
                        type="text"
                        value={addForm.last_name}
                        onChange={(e) => setAddForm((p) => ({ ...p, last_name: e.target.value }))}
                        placeholder="Doe"
                        style={{
                          border: "1.5px solid #cbd5e1", borderRadius: 8,
                          padding: "9px 11px", fontSize: ".88rem",
                          width: "100%", boxSizing: "border-box",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>

                  {/* Initial roles */}
                  <div>
                    <p style={{ margin: "0 0 8px", fontSize: ".8rem", fontWeight: 700, color: "#374151" }}>
                      Initial roles <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                    </p>
                    <div style={{
                      border: "1.5px solid #e2e8f0", borderRadius: 10,
                      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0,
                      overflow: "hidden",
                    }}>
                      {ALL_ROLES.map((role, i) => (
                        <label
                          key={role.value}
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 10,
                            cursor: "pointer", padding: "10px 12px",
                            background: addRoles.has(role.value) ? "#eef2ff" : "#fff",
                            borderBottom: i < ALL_ROLES.length - 2 ? "1px solid #f1f5f9" : "none",
                            borderRight: i % 2 === 0 ? "1px solid #f1f5f9" : "none",
                            transition: "background 120ms",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={addRoles.has(role.value)}
                            onChange={() => toggleAddRole(role.value)}
                            style={{ marginTop: 3, flexShrink: 0, accentColor: "#234395" }}
                          />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: ".82rem", fontWeight: 700, color: addRoles.has(role.value) ? "#234395" : "#1e293b", lineHeight: 1.3 }}>
                              {role.label}
                            </span>
                            <span style={{ display: "block", fontSize: ".71rem", color: "#94a3b8", lineHeight: 1.4, marginTop: 1 }}>
                              {role.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <p style={{ margin: 0, fontSize: ".75rem", color: "#94a3b8", background: "#f8fafc", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
                    No password is set. The user must sign in via Google SSO or contact an administrator to reset their password.
                  </p>
                </div>
              </form>

              {/* Modal footer */}
              <div style={{
                display: "flex", justifyContent: "flex-end", gap: 10,
                padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc",
              }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => !addSaving && setShowAddModal(false)}
                  disabled={addSaving}
                >Cancel</button>
                <button
                  type="submit"
                  form="add-user-form"
                  className="primary-button"
                  disabled={addSaving}
                  style={{ display: "flex", alignItems: "center", gap: 7 }}
                >
                  {addSaving
                    ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Creating…</>
                    : <><Plus size={14} aria-hidden="true" /> Create account</>
                  }
                </button>
              </div>
            </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* ── Edit panel ── */}
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
            <header>
              <div>
                <span>Account controls</span>
                <h2>{editing.name}</h2>
              </div>
              <button aria-label="Close editor" onClick={() => { setEditing(null); setGrants([]); }}>
                <X aria-hidden="true" />
              </button>
            </header>

            <form onSubmit={submit}>
              <div className="account-readonly">
                <span>Username<strong>@{editing.username}</strong></span>
                <span>Email<strong>{editing.email}</strong></span>
              </div>

              <div className="form-pair">
                <label>First name<input name="first_name" defaultValue={editing.first_name} maxLength={150} /></label>
                <label>Last name<input  name="last_name"  defaultValue={editing.last_name}  maxLength={150} /></label>
              </div>

              <fieldset className="permission-options">
                <legend>Account status</legend>
                <label>
                  <input type="checkbox" name="is_active" defaultChecked={editing.is_active} />
                  <span><strong>Active account</strong><small>Allow this user to sign in.</small></span>
                </label>
              </fieldset>

              <fieldset className="permission-options role-permissions">
                <legend>
                  Role assignments
                  {loadingRoles && <Loader2 className="spin" aria-label="Loading roles" />}
                </legend>
                {ALL_ROLES.map((role) => (
                  <label key={role.value} className={activeRoles.has(role.value) ? "role-row active" : "role-row"}>
                    <input
                      type="checkbox"
                      name={`role_${role.value}`}
                      defaultChecked={activeRoles.has(role.value)}
                      key={`${role.value}-${activeRoles.has(role.value)}`}
                      disabled={loadingRoles}
                    />
                    <span>
                      <strong>{role.label}</strong>
                      <small>{role.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>

              <p className="account-date">Account created {formatDate(editing.date_joined)}</p>

              <div className="editor-actions">
                <button type="button" className="secondary-button" onClick={() => { setEditing(null); setGrants([]); }}>Cancel</button>
                <button className="primary-button" type="submit" disabled={saving || loadingRoles}>
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}