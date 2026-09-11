"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Pencil, Search, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { adminGet, adminSave, type ManagedUser } from "@/lib/admin-api";

function initials(user: ManagedUser) {
  const value = user.name || user.username;
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}

export default function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function load() {
    adminGet<ManagedUser[]>("users").then(setUsers).catch((reason) => setError(reason.message));
  }
  useEffect(load, []);

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => [user.name, user.username, user.email].some((value) => value.toLowerCase().includes(needle)));
  }, [query, users]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      await adminSave<ManagedUser>("users", {
        first_name: data.get("first_name"),
        last_name: data.get("last_name"),
        is_active: data.get("is_active") === "on",
        is_staff: data.get("is_staff") === "on",
        is_superuser: data.get("is_superuser") === "on",
      }, editing.id);
      setEditing(null);
      setNotice("User permissions updated.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "User could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  const activeCount = users.filter((user) => user.is_active).length;
  const adminCount = users.filter((user) => user.is_superuser).length;

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div><p className="eyebrow">Access control</p><h1>User management</h1><p>Review college accounts and control staff or superuser access.</p></div>
        <div className="user-summary"><span><Users aria-hidden="true" /><strong>{activeCount}</strong> active</span><span><ShieldCheck aria-hidden="true" /><strong>{adminCount}</strong> superuser</span></div>
      </header>
      {notice && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-notice" role="status">{notice}</motion.p>}
      {error && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-error" role="alert">{error}</motion.p>}

      <div className="user-toolbar">
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, username, or email" aria-label="Search users" />
        <span>{visibleUsers.length} results</span>
      </div>

      <section className="user-table" aria-label="College users">
        <div className="user-table-head"><span>User</span><span>Access</span><span>Last sign-in</span><span>Status</span><span></span></div>
        {visibleUsers.map((user, index) => (
          <motion.article key={user.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .18) }}>
            <div className="user-identity"><span className="user-avatar">{initials(user) || <UserRound aria-hidden="true" />}</span><span><strong>{user.name}</strong><small>{user.email}</small><small>@{user.username}</small></span></div>
            <div className="role-stack">{user.is_superuser ? <span className="role-badge superuser"><ShieldCheck aria-hidden="true" /> Superuser</span> : user.is_staff ? <span className="role-badge staff">Staff</span> : <span className="role-badge member">Member</span>}</div>
            <span>{formatDate(user.last_login)}</span>
            <span className={user.is_active ? "account-active" : "account-inactive"}><CheckCircle2 aria-hidden="true" />{user.is_active ? "Active" : "Inactive"}</span>
            <button aria-label={`Edit ${user.name}`} onClick={() => setEditing(user)}><Pencil aria-hidden="true" /></button>
          </motion.article>
        ))}
        {!visibleUsers.length && <div className="user-empty"><UserRound aria-hidden="true" /><p>No users match this search.</p></div>}
      </section>

      <AnimatePresence>
        {editing && (
          <motion.aside key={editing.id} className="editor-panel user-editor" initial={{ opacity: 0, x: 28, scale: .985 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }} transition={{ type: "spring", stiffness: 340, damping: 32 }}>
            <header><div><span>Account controls</span><h2>{editing.name}</h2></div><button aria-label="Close editor" onClick={() => setEditing(null)}><X aria-hidden="true" /></button></header>
            <form onSubmit={submit}>
              <div className="account-readonly"><span>Username<strong>@{editing.username}</strong></span><span>College email<strong>{editing.email}</strong></span></div>
              <div className="form-pair"><label>First name<input name="first_name" defaultValue={editing.first_name} maxLength={150} /></label><label>Last name<input name="last_name" defaultValue={editing.last_name} maxLength={150} /></label></div>
              <fieldset className="permission-options">
                <legend>Account permissions</legend>
                <label><input type="checkbox" name="is_active" defaultChecked={editing.is_active} /><span><strong>Active account</strong><small>Allow this user to sign in.</small></span></label>
                <label><input type="checkbox" name="is_staff" defaultChecked={editing.is_staff} /><span><strong>Staff status</strong><small>Allow access to Django staff tools.</small></span></label>
                <label><input type="checkbox" name="is_superuser" defaultChecked={editing.is_superuser} /><span><strong>Superuser access</strong><small>Allow full access to this management panel.</small></span></label>
              </fieldset>
              <p className="account-date">Account created {formatDate(editing.date_joined)}</p>
              <div className="editor-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save permissions"}</button></div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
