"use client";

import { AnimatePresence, motion } from "motion/react";
import { CircleDot, Clock, Filter, Inbox, Pencil, TicketCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { csrfToken } from "@/lib/auth";

interface AdminTicket {
  id: string;
  reference: string;
  requester: number;
  category: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  assignee_name: string | null;
  team: string;
  extra_fields: Record<string, unknown>;
}

interface ServiceCategory {
  id: number;
  name: string;
  slug: string;
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

const STATUS_LABELS: Record<string, string> = {
  submitted:         "Submitted",
  triaged:           "Triaged",
  in_progress:       "In Progress",
  waiting_requester: "Waiting",
  waiting_approval:  "Awaiting Approval",
  resolved:          "Resolved",
  closed:            "Closed",
  cancelled:         "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  submitted:         "#1e40af|#dbeafe",
  triaged:           "#5b21b6|#ede9fe",
  in_progress:       "#92400e|#fef3c7",
  waiting_requester: "#9a3412|#ffedd5",
  waiting_approval:  "#6b21a8|#f3e8ff",
  resolved:          "#166534|#dcfce7",
  closed:            "#475569|#e2e8f0",
  cancelled:         "#991b1b|#fee2e2",
};

const PRIORITY_LABELS: Record<string, string> = {
  p1: "Critical",
  p2: "High",
  p3: "Normal",
  p4: "Low",
};

const PRIORITY_COLORS: Record<string, string> = {
  p1: "#991b1b|#fee2e2",
  p2: "#92400e|#fef3c7",
  p3: "#475569|#e2e8f0",
  p4: "#166534|#dcfce7",
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? "#475569|#e2e8f0";
  const [color, bg] = colors.split("|");
  return (
    <span
      style={{ color, background: bg, borderRadius: 999, padding: "3px 9px", fontSize: ".75rem", fontWeight: 800, whiteSpace: "nowrap" }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors = PRIORITY_COLORS[priority] ?? "#475569|#e2e8f0";
  const [color, bg] = colors.split("|");
  return (
    <span
      style={{ color, background: bg, borderRadius: 999, padding: "3px 9px", fontSize: ".75rem", fontWeight: 800 }}
    >
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "submitted", label: "Submitted" },
  { value: "triaged", label: "Triaged" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_requester", label: "Waiting" },
  { value: "waiting_approval", label: "Awaiting Approval" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function AdminTicketsPage() {
  const [tickets, setTickets]         = useState<AdminTicket[]>([]);
  const [categories, setCategories]   = useState<ServiceCategory[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Editor panel state
  const [editing, setEditing]         = useState<AdminTicket | null>(null);
  const [saving, setSaving]           = useState(false);
  const [panelError, setPanelError]   = useState("");
  const [panelNotice, setPanelNotice] = useState("");
  const [draftSubject, setDraftSubject]           = useState("");
  const [draftDescription, setDraftDescription]   = useState("");
  const [draftPriority, setDraftPriority]         = useState("");
  const [draftStatus, setDraftStatus]             = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/tickets/", { credentials: "include", cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("Could not load tickets.");
        return r.json().then((d: { results?: AdminTicket[] } | AdminTicket[]) =>
          Array.isArray(d) ? d : (d.results ?? [])
        );
      }),
      fetch("/api/v1/admin/services/", { credentials: "include", cache: "no-store" }).then((r) => {
        if (!r.ok) return [];
        return r.json().then((d) =>
          (d && typeof d === "object" && "results" in d ? d.results : d) as ServiceCategory[]
        );
      }),
    ])
      .then(([ticketData, categoryData]) => {
        setTickets(Array.isArray(ticketData) ? ticketData : []);
        setCategories(Array.isArray(categoryData) ? categoryData : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tickets."))
      .finally(() => setLoading(false));
  }, []);

  function openEditor(ticket: AdminTicket) {
    setEditing(ticket);
    setDraftSubject(ticket.subject);
    setDraftDescription(ticket.description ?? "");
    setDraftPriority(ticket.priority);
    setDraftStatus(ticket.status);
    setPanelError("");
    setPanelNotice("");
  }

  async function saveTicket() {
    if (!editing) return;
    setSaving(true);
    setPanelError("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/tickets/${editing.id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({
          subject: draftSubject,
          description: draftDescription,
          priority: draftPriority,
          status: draftStatus,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPanelError(messageFrom(data));
      } else {
        setTickets(prev => prev.map(t => t.id === editing.id ? { ...t, ...data } : t));
        setEditing(data as AdminTicket);
        setPanelNotice("Ticket updated.");
      }
    } catch {
      setPanelError("Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  const categoryMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const cat of categories) map.set(cat.id, cat.name);
    return map;
  }, [categories]);

  const visibleTickets = useMemo(() => {
    if (!statusFilter) return tickets;
    return tickets.filter((t) => t.status === statusFilter);
  }, [tickets, statusFilter]);

  const openCount      = tickets.filter((t) => !["resolved", "closed", "cancelled"].includes(t.status)).length;
  const submittedCount = tickets.filter((t) => t.status === "submitted").length;

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Support queue</p>
          <h1>Tickets</h1>
          <p>Review and manage all support requests submitted to the helpdesk.</p>
        </div>
        <div className="user-summary">
          <span><TicketCheck aria-hidden="true" /><strong>{tickets.length}</strong> total</span>
          <span><CircleDot aria-hidden="true" /><strong>{openCount}</strong> open</span>
          <span><Clock aria-hidden="true" /><strong>{submittedCount}</strong> pending</span>
        </div>
      </header>

      {error && (
        <p className="admin-error" role="alert">{error}</p>
      )}

      {loading ? (
        <div className="admin-loading">Loading tickets...</div>
      ) : (
        <>
          {/* Filter bar */}
          <div className="user-toolbar" style={{ marginBottom: 0, borderRadius: "16px 16px 0 0" }}>
            <Filter aria-hidden="true" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              style={{ border: 0, outline: 0, background: "transparent", color: "#0f172a", fontSize: ".95rem", cursor: "pointer" }}
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <span>{visibleTickets.length} result{visibleTickets.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Ticket table */}
          <section className="user-table" aria-label="Support tickets" style={{ borderRadius: "0 0 16px 16px", borderTop: 0 }}>
            <div
              className="user-table-head"
              style={{ gridTemplateColumns: ".9fr 1.5fr .8fr .7fr .65fr .7fr .6fr" }}
            >
              <span>Reference</span>
              <span>Subject</span>
              <span>Category</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Created</span>
              <span>Assignee</span>
            </div>

            {visibleTickets.length === 0 ? (
              <div className="guide-empty" style={{ padding: "60px 24px" }}>
                <Inbox aria-hidden="true" />
                <p>{statusFilter ? "No tickets match this filter." : "No tickets in the queue."}</p>
              </div>
            ) : (
              visibleTickets.map((ticket, index) => (
                <motion.article
                  key={ticket.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.2) }}
                  onClick={() => openEditor(ticket)}
                  style={{ gridTemplateColumns: ".9fr 1.5fr .8fr .7fr .65fr .7fr .6fr", display: "grid", gap: 14, alignItems: "center", padding: "14px 18px", borderTop: "1px solid #edf1f7", color: "#475569", fontSize: ".85rem", cursor: "pointer" }}
                >
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#234395", fontSize: ".8rem" }}>
                    {ticket.reference}
                  </span>
                  <span style={{ color: "#1e293b", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ticket.subject}>
                    {ticket.subject}
                  </span>
                  <span style={{ color: "#64748b", fontSize: ".82rem" }}>
                    {categoryMap.get(ticket.category) ?? `#${ticket.category}`}
                  </span>
                  <span><StatusBadge status={ticket.status} /></span>
                  <span><PriorityBadge priority={ticket.priority} /></span>
                  <span>{formatDate(ticket.created_at)}</span>
                  <span style={{ color: ticket.assignee_name ? "#334155" : "#94a3b8", fontStyle: ticket.assignee_name ? "normal" : "italic" }}>
                    {ticket.assignee_name ?? "Unassigned"}
                  </span>
                </motion.article>
              ))
            )}
          </section>
        </>
      )}

      {/* Ticket editor panel */}
      <AnimatePresence>
        {editing && (
          <motion.aside
            key="ticket-editor"
            className="editor-panel guide-editor"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            aria-label="Edit ticket"
          >
            {/* Panel header */}
            <div className="editor-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pencil size={16} aria-hidden="true" />
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#234395", fontSize: ".85rem" }}>
                  {editing.reference}
                </span>
              </div>
              <button
                onClick={() => setEditing(null)}
                aria-label="Close editor"
                className="secondary-button"
                style={{ padding: "4px 8px", lineHeight: 1 }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Form */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: ".875rem", fontWeight: 600, color: "#334155" }}>
                Subject
                <input
                  type="text"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  style={{ fontWeight: 400 }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: ".875rem", fontWeight: 600, color: "#334155" }}>
                Description
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={6}
                  style={{ resize: "vertical", fontWeight: 400 }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: ".875rem", fontWeight: 600, color: "#334155" }}>
                Priority
                <select value={draftPriority} onChange={(e) => setDraftPriority(e.target.value)}>
                  <option value="p1">Critical</option>
                  <option value="p2">High</option>
                  <option value="p3">Normal</option>
                  <option value="p4">Low</option>
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: ".875rem", fontWeight: 600, color: "#334155" }}>
                Status
                <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
                  <option value="submitted">Submitted</option>
                  <option value="triaged">Triaged</option>
                  <option value="in_progress">In Progress</option>
                  <option value="waiting_requester">Waiting</option>
                  <option value="waiting_approval">Awaiting Approval</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              {panelNotice && (
                <p role="status" style={{ color: "#166534", background: "#dcfce7", borderRadius: 8, padding: "8px 12px", fontSize: ".875rem", margin: 0 }}>
                  {panelNotice}
                </p>
              )}
              {panelError && (
                <p role="alert" style={{ color: "#991b1b", background: "#fee2e2", borderRadius: 8, padding: "8px 12px", fontSize: ".875rem", margin: 0 }}>
                  {panelError}
                </p>
              )}

              <div className="editor-actions">
                <button
                  className="primary-button"
                  onClick={saveTicket}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
