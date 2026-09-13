"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2, Pencil, Search, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  adminGet, adminSave, getUserRoles, grantRole, revokeRole,
  ALL_ROLES, type ManagedUser, type RoleGrant, type RoleValue,
} from "@/lib/admin-api";

function initials(user: ManagedUser) {
  const value = user.name || user.username;
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}

function RoleBadge({ roles }: { roles: RoleValue[] }) {
  if (roles.includes("administrator")) return <span className="role-badge superuser"><ShieldCheck aria-hidden="true" /> Administrator</span>;
  if (roles.includes("service_lead"))  return <span className="role-badge staff">Service Lead</span>;
  if (roles.includes("it_agent"))      return <span className="role-badge staff">IT Agent</span>;
  if (roles.includes("it_noc_intern")) return <span className="role-badge staff">IT NOC Intern</span>;
  if (roles.includes("content_editor"))      return <span className="role-badge staff">Content Editor</span>;
  if (roles.includes("designated_approver")) return <span className="role-badge staff">Designated Approver</span>;
  if (roles.includes("faculty_staff")) return <span className="role-badge staff">Staff</span>;
  if (roles.includes("student"))       return <span className="role-badge member">Student</span>;
  return <span className="role-badge member">Visitor</span>;
}

export default function UserManagement() {
  const [users, setUsers]     = useState<ManagedUser[]>([]);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [grants, setGrants]   = useState<RoleGrant[]>([]);
  const [query, setQuery]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [error, setError]     = useState("");
  const [notice, setNotice]   = useState("");

  function load() {
    adminGet<ManagedUser[]>("users").then(setUsers).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function openEditor(user: ManagedUser) {
    setEditing(user);
    setGrants([]);
    setLoadingRoles(true);
    setError("");
    try {
      const data = await getUserRoles(user.id);
      setGrants(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load roles.");
    } finally {
      setLoadingRoles(false);
    }
  }

  const activeRoles = useMemo<Set<RoleValue>>(
    () => new Set(grants.map((g) => g.role as RoleValue)),
    [grants],
  );

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => [u.name, u.username, u.email].some((v) => v.toLowerCase().includes(needle)));
  }, [query, users]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    setNotice("");

    const form = new FormData(event.currentTarget);

    // Which roles are checked in the form
    const desired = new Set(
      ALL_ROLES.map((r) => r.value).filter((v) => form.get(`role_${v}`) === "on")
    ) as Set<RoleValue>;

    // Compute diff
    const toGrant  = [...desired].filter((r) => !activeRoles.has(r));
    const toRevoke = [...activeRoles].filter((r) => !desired.has(r));

    try {
      // Update basic profile fields first
      await adminSave<ManagedUser>("users", {
        first_name: form.get("first_name"),
        last_name:  form.get("last_name"),
        is_active:  form.get("is_active") === "on",
      }, editing.id);

      // Apply role changes
      await Promise.all([
        ...toGrant.map((r)  => grantRole(editing.id, r)),
        ...toRevoke.map((r) => revokeRole(editing.id, r)),
      ]);

      setEditing(null);
      setGrants([]);
      setNotice(`${editing.name} updated.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "User could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  const activeCount = users.filter((u) => u.is_active).length;
  const adminCount  = users.filter((u) => u.roles?.includes("administrator")).length;

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>User management</h1>
          <p>Review college accounts and manage role assignments.</p>
        </div>
        <div className="user-summary">
          <span><Users aria-hidden="true" /><strong>{activeCount}</strong> active</span>
          <span><ShieldCheck aria-hidden="true" /><strong>{adminCount}</strong> administrator</span>
        </div>
      </header>

      {notice && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-notice" role="status">{notice}</motion.p>}
      {error  && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-error"  role="alert">{error}</motion.p>}

      <div className="user-toolbar">
        <Search aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, username, or email" aria-label="Search users" />
        <span>{visibleUsers.length} results</span>
      </div>

      <section className="user-table" aria-label="College users">
        <div className="user-table-head"><span>User</span><span>Role</span><span>Last sign-in</span><span>Status</span><span></span></div>
        {visibleUsers.map((user, index) => (
          <motion.article key={user.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .18) }}>
            <div className="user-identity">
              <span className="user-avatar">{initials(user) || <UserRound aria-hidden="true" />}</span>
              <span><strong>{user.name}</strong><small>{user.email}</small><small>@{user.username}</small></span>
            </div>
            <div className="role-stack"><RoleBadge roles={user.roles ?? []} /></div>
            <span>{formatDate(user.last_login)}</span>
            <span className={user.is_active ? "account-active" : "account-inactive"}><CheckCircle2 aria-hidden="true" />{user.is_active ? "Active" : "Inactive"}</span>
            <button aria-label={`Edit ${user.name}`} onClick={() => openEditor(user)}><Pencil aria-hidden="true" /></button>
          </motion.article>
        ))}
        {!visibleUsers.length && <div className="user-empty"><UserRound aria-hidden="true" /><p>No users match this search.</p></div>}
      </section>

      <AnimatePresence>
        {editing && (
          <motion.aside key={editing.id} className="editor-panel user-editor" initial={{ opacity: 0, x: 28, scale: .985 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }} transition={{ type: "spring", stiffness: 340, damping: 32 }}>
            <header>
              <div><span>Account controls</span><h2>{editing.name}</h2></div>
              <button aria-label="Close editor" onClick={() => { setEditing(null); setGrants([]); }}><X aria-hidden="true" /></button>
            </header>

            <form onSubmit={submit}>
              <div className="account-readonly">
                <span>Username<strong>@{editing.username}</strong></span>
                <span>Email<strong>{editing.email}</strong></span>
              </div>

              <div className="form-pair">
                <label>First name<input name="first_name" defaultValue={editing.first_name} maxLength={150} /></label>
                <label>Last name<input name="last_name" defaultValue={editing.last_name} maxLength={150} /></label>
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
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}