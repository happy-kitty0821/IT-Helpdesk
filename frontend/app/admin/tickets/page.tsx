"use client";

import { motion } from "motion/react";
import { CircleDot, Clock, Filter, Inbox, TicketCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface AdminTicket {
  id: string;
  reference: string;
  requester: number;
  category: number;
  subject: string;
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

const STATUS_LABELS: Record<string, string> = {
  submitted:        "Submitted",
  triaged:          "Triaged",
  in_progress:      "In Progress",
  waiting_requester:"Waiting",
  waiting_approval: "Awaiting Approval",
  resolved:         "Resolved",
  closed:           "Closed",
  cancelled:        "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  submitted:        "#1e40af|#dbeafe",
  triaged:          "#5b21b6|#ede9fe",
  in_progress:      "#92400e|#fef3c7",
  waiting_requester:"#9a3412|#ffedd5",
  waiting_approval: "#6b21a8|#f3e8ff",
  resolved:         "#166534|#dcfce7",
  closed:           "#475569|#e2e8f0",
  cancelled:        "#991b1b|#fee2e2",
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
  const [tickets, setTickets]     = useState<AdminTicket[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/tickets/", { credentials: "include", cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("Could not load tickets.");
        return r.json() as Promise<AdminTicket[]>;
      }),
      fetch("/api/v1/admin/services/", { credentials: "include", cache: "no-store" }).then((r) => {
        if (!r.ok) return [];
        return r.json().then((d) => (d && typeof d === "object" && "results" in d ? d.results : d) as ServiceCategory[]);
      }),
    ])
      .then(([ticketData, categoryData]) => {
        setTickets(Array.isArray(ticketData) ? ticketData : []);
        setCategories(Array.isArray(categoryData) ? categoryData : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tickets."))
      .finally(() => setLoading(false));
  }, []);

  const categoryMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const cat of categories) map.set(cat.id, cat.name);
    return map;
  }, [categories]);

  const visibleTickets = useMemo(() => {
    if (!statusFilter) return tickets;
    return tickets.filter((t) => t.status === statusFilter);
  }, [tickets, statusFilter]);

  const openCount       = tickets.filter((t) => !["resolved", "closed", "cancelled"].includes(t.status)).length;
  const submittedCount  = tickets.filter((t) => t.status === "submitted").length;

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
        <div className="admin-loading">Loading tickets…</div>
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
                  style={{ gridTemplateColumns: ".9fr 1.5fr .8fr .7fr .65fr .7fr .6fr", display: "grid", gap: 14, alignItems: "center", padding: "14px 18px", borderTop: "1px solid #edf1f7", color: "#475569", fontSize: ".85rem" }}
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
    </div>
  );
}
