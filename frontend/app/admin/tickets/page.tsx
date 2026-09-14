"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Calendar, CircleDot, Clock, Inbox,
  Search, TicketCheck, User, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { csrfToken } from "@/lib/auth";

interface AdminTicket {
  id: string;
  reference: string;
  requester: number;
  requester_name: string | null;
  requester_email: string | null;
  category: number;
  category_name: string | null;
  subject: string;
  description: string;
  status: string;
  status_reason: string;
  priority: string;
  assigned_to: number | null;
  assignee_name: string | null;
  team: string;
  extra_fields: Record<string, unknown>;
  elapsed: string;
  created_at: string;
  updated_at: string;
}

interface StaffUser {
  id: number;
  name: string;
  username: string;
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted", triaged: "Triaged", in_progress: "In Progress",
  waiting_requester: "Waiting", waiting_approval: "Awaiting Approval",
  resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  submitted:         { text: "#1e40af", bg: "#dbeafe" },
  triaged:           { text: "#5b21b6", bg: "#ede9fe" },
  in_progress:       { text: "#92400e", bg: "#fef3c7" },
  waiting_requester: { text: "#9a3412", bg: "#ffedd5" },
  waiting_approval:  { text: "#6b21a8", bg: "#f3e8ff" },
  resolved:          { text: "#166534", bg: "#dcfce7" },
  closed:            { text: "#475569", bg: "#e2e8f0" },
  cancelled:         { text: "#991b1b", bg: "#fee2e2" },
};

const PRIORITY_LABELS: Record<string, string> = {
  p1: "Critical", p2: "High", p3: "Normal", p4: "Low",
};

const PRIORITY_COLORS: Record<string, { text: string; bg: string }> = {
  p1: { text: "#991b1b", bg: "#fee2e2" },
  p2: { text: "#92400e", bg: "#fef3c7" },
  p3: { text: "#475569", bg: "#e2e8f0" },
  p4: { text: "#166534", bg: "#dcfce7" },
};

function StatusBadge({ status }: { status: string }) {
  const { text, bg } = STATUS_COLORS[status] ?? { text: "#475569", bg: "#e2e8f0" };
  return (
    <span style={{ color: text, background: bg, borderRadius: 999, padding: "3px 10px", fontSize: ".74rem", fontWeight: 800, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <CircleDot size={10} aria-hidden="true" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const { text, bg } = PRIORITY_COLORS[priority] ?? { text: "#475569", bg: "#e2e8f0" };
  return (
    <span style={{ color: text, background: bg, borderRadius: 999, padding: "3px 9px", fontSize: ".74rem", fontWeight: 800 }}>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function formatKey(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  const [selected, setSelected] = useState<AdminTicket | null>(null);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [panelNotice, setPanelNotice] = useState("");

  const [draftStatus, setDraftStatus] = useState("");
  const [draftPriority, setDraftPriority] = useState("");
  const [draftAssignedTo, setDraftAssignedTo] = useState<number | "">("");
  const [draftTeam, setDraftTeam] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/tickets/", { credentials: "include", cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error("Could not load tickets.");
          return r.json().then((d: { results?: AdminTicket[] } | AdminTicket[]) =>
            Array.isArray(d) ? d : (d.results ?? [])
          );
        }),
      fetch("/api/v1/tickets/assignable-staff/", { credentials: "include" })
        .then((r) => (r.ok ? (r.json() as Promise<StaffUser[]>) : []))
        .catch(() => [] as StaffUser[]),
    ])
      .then(([ticketData, staffData]) => {
        setTickets(Array.isArray(ticketData) ? ticketData : []);
        setStaffUsers(Array.isArray(staffData) ? staffData : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load data."))
      .finally(() => setLoading(false));
  }, []);

  function openPanel(ticket: AdminTicket) {
    setSelected(ticket);
    setDraftStatus(ticket.status);
    setDraftPriority(ticket.priority);
    setDraftAssignedTo(ticket.assigned_to ?? "");
    setDraftTeam(ticket.team ?? "");
    setDraftSubject(ticket.subject);
    setDraftDescription(ticket.description ?? "");
    setPanelError("");
    setPanelNotice("");
  }

  async function saveTicket() {
    if (!selected) return;
    setSaving(true);
    setPanelError("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/tickets/${selected.id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({
          subject: draftSubject,
          description: draftDescription,
          priority: draftPriority,
          status: draftStatus,
          team: draftTeam,
          assigned_to: draftAssignedTo !== "" ? draftAssignedTo : null,
        }),
      });
      const data = await res.json().catch(() => ({})) as AdminTicket;
      if (!res.ok) {
        setPanelError(messageFrom(data));
      } else {
        setTickets((prev) => prev.map((t) => (t.id === selected.id ? { ...t, ...data } : t)));
        setSelected({ ...selected, ...data });
        setPanelNotice("Ticket saved.");
      }
    } catch {
      setPanelError("A network error occurred.");
    } finally {
      setSaving(false);
    }
  }

  const visibleTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (assigneeFilter === "unassigned" && t.assigned_to !== null) return false;
      if (assigneeFilter && assigneeFilter !== "unassigned" && String(t.assigned_to) !== assigneeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          t.reference.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          (t.requester_name ?? "").toLowerCase().includes(q) ||
          (t.requester_email ?? "").toLowerCase().includes(q) ||
          (t.category_name ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tickets, statusFilter, priorityFilter, assigneeFilter, searchQuery]);

  const openCount = tickets.filter((t) => !["resolved", "closed", "cancelled"].includes(t.status)).length;
  const pendingCount = tickets.filter((t) => t.status === "submitted").length;
  const unassignedCount = tickets.filter((t) => !t.assigned_to && !["closed", "cancelled"].includes(t.status)).length;

  return (
    <div className="admin-content" style={{ paddingRight: selected ? 540 : undefined, transition: "padding-right 280ms ease" }}>

      <header className="admin-heading">
        <div>
          <p className="eyebrow">Support queue</p>
          <h1>Tickets</h1>
          <p>View, assign, and manage all support requests.</p>
        </div>
        <div className="user-summary">
          <span><TicketCheck aria-hidden="true" /><strong>{tickets.length}</strong> total</span>
          <span><CircleDot aria-hidden="true" /><strong>{openCount}</strong> open</span>
          <span><Clock aria-hidden="true" /><strong>{pendingCount}</strong> pending</span>
          {unassignedCount > 0 && (
            <span style={{ color: "#92400e", background: "#fef3c7" }}>
              <User aria-hidden="true" /><strong>{unassignedCount}</strong> unassigned
            </span>
          )}
        </div>
      </header>

      {error && <p className="admin-error" role="alert">{error}</p>}

      {loading ? (
        <div className="admin-loading">Loading tickets...</div>
      ) : (
        <>
          <div className="atq-filters">
            <div className="atq-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search reference, subject, requester..."
                aria-label="Search tickets"
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Filter by priority">
              <option value="">All priorities</option>
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} aria-label="Filter by assignee">
              <option value="">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {staffUsers.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
            <span className="atq-count">{visibleTickets.length} result{visibleTickets.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="atq-table-wrap">
            <div className="atq-head">
              <span>Reference</span>
              <span>Requester</span>
              <span>Subject</span>
              <span>Category</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Elapsed</span>
              <span>Assignee</span>
            </div>

            {visibleTickets.length === 0 ? (
              <div className="atq-empty">
                <Inbox size={32} aria-hidden="true" />
                <p>{searchQuery || statusFilter || priorityFilter || assigneeFilter
                  ? "No tickets match the current filters."
                  : "No tickets in the queue yet."}</p>
              </div>
            ) : (
              visibleTickets.map((ticket, i) => (
                <motion.div
                  key={ticket.id}
                  className={`atq-row${selected?.id === ticket.id ? " atq-row--active" : ""}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.15) }}
                  onClick={() => openPanel(ticket)}
                  role="button"
                  tabIndex={0}
                  aria-label={`View ticket ${ticket.reference}`}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPanel(ticket)}
                >
                  <span className="atq-reference">{ticket.reference}</span>
                  <span className="atq-requester">
                    <strong>{ticket.requester_name ?? `#${ticket.requester}`}</strong>
                    {ticket.requester_email && <small>{ticket.requester_email}</small>}
                  </span>
                  <span className="atq-subject" title={ticket.subject}>{ticket.subject}</span>
                  <span className="atq-meta">{ticket.category_name ?? `#${ticket.category}`}</span>
                  <span><StatusBadge status={ticket.status} /></span>
                  <span><PriorityBadge priority={ticket.priority} /></span>
                  <span className="atq-meta" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Calendar size={12} aria-hidden="true" />{ticket.elapsed}
                  </span>
                  <span className={ticket.assignee_name ? "atq-assignee" : "atq-unassigned"}>
                    {ticket.assignee_name ?? "Unassigned"}
                  </span>
                </motion.div>
              ))
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {selected && (
          <motion.aside
            key={selected.id}
            className="atq-panel"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            aria-label="Ticket detail"
          >
            <div className="atq-panel-header">
              <div className="atq-panel-title">
                <span className="atq-panel-ref">{selected.reference}</span>
                <StatusBadge status={selected.status} />
              </div>
              <button className="atq-close" onClick={() => setSelected(null)} aria-label="Close panel">
                <X size={18} />
              </button>
            </div>

            <div className="atq-panel-body">
              <h2 className="atq-panel-subject">{selected.subject}</h2>

              <div className="atq-info-row">
                <User size={14} aria-hidden="true" />
                <span>
                  <strong>{selected.requester_name ?? `User #${selected.requester}`}</strong>
                  {selected.requester_email && <> &mdash; <small>{selected.requester_email}</small></>}
                </span>
              </div>
              <div className="atq-info-row">
                <Clock size={14} aria-hidden="true" />
                <span>{selected.elapsed} &nbsp;&middot;&nbsp; {formatDate(selected.created_at)}</span>
              </div>
              {selected.category_name && (
                <div className="atq-info-row">
                  <CircleDot size={14} aria-hidden="true" />
                  <span>{selected.category_name}</span>
                </div>
              )}

              <hr className="atq-divider" />

              <p className="atq-description">{selected.description}</p>

              {Object.keys(selected.extra_fields ?? {}).length > 0 && (
                <div className="atq-extras">
                  <h3>Additional details</h3>
                  <dl className="atq-dl">
                    {Object.entries(selected.extra_fields).map(([k, v]) => (
                      <div key={k} className="atq-dl-row">
                        <dt>{formatKey(k)}</dt>
                        <dd>{String(v ?? "")}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {selected.status_reason && (
                <div className="atq-reason">
                  <h3>{selected.status === "cancelled" ? "Cancellation reason" : "Closure note"}</h3>
                  <p>{selected.status_reason}</p>
                </div>
              )}

              <hr className="atq-divider" />
              <h3 className="atq-edit-heading">Update ticket</h3>

              <div className="atq-form">
                <label>
                  Status
                  <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label>
                  Priority
                  <select value={draftPriority} onChange={(e) => setDraftPriority(e.target.value)}>
                    <option value="p1">Critical</option>
                    <option value="p2">High</option>
                    <option value="p3">Normal</option>
                    <option value="p4">Low</option>
                  </select>
                </label>
                <label className="atq-full">
                  Assign to
                  <select
                    value={draftAssignedTo}
                    onChange={(e) => setDraftAssignedTo(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">— Unassigned —</option>
                    {staffUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
                    ))}
                  </select>
                </label>
                <label className="atq-full">
                  Team
                  <input type="text" value={draftTeam} onChange={(e) => setDraftTeam(e.target.value)} placeholder="e.g. IT Support, NOC Team" />
                </label>
                <label className="atq-full">
                  Subject
                  <input type="text" value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} />
                </label>
                <label className="atq-full">
                  Description
                  <textarea rows={5} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} />
                </label>
              </div>

              {panelNotice && <p className="atq-notice" role="status">{panelNotice}</p>}
              {panelError && <p className="atq-error" role="alert">{panelError}</p>}

              <div className="atq-panel-actions">
                <button className="primary-button" onClick={saveTicket} disabled={saving} style={{ width: "100%", justifyContent: "center" }}>
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}