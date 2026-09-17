"use client";
"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Calendar, CheckCircle2, ChevronRight, CircleDot, Clock,
  Download, FileSpreadsheet, Inbox, KeyRound, MessageSquare,
  Search, TicketCheck, User, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { csrfToken } from "@/lib/auth";
import type { ServiceStage } from "@/lib/admin-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminTicket {
  id: string;
  reference: string;
  requester: number;
  requester_name: string | null;
  requester_email: string | null;
  category: number;
  category_name: string | null;
  category_slug: string | null;
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
  current_stage: string;
}

interface StaffUser {
  id: number;
  name: string;
  username: string;
}

interface TicketMessage {
  id: number;
  ticket: string;
  sender: number;
  sender_name: string | null;
  sender_email: string | null;
  body: string;
  is_staff_reply: boolean;
  is_internal: boolean;
  created_at: string;
}

interface ServiceCategoryDetail {
  id: number;
  stages: ServiceStage[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const ACCOUNT_RECOVERY_SLUGS = new Set(["account-recovery", "college-account-recovery"]);

// ── Small components ──────────────────────────────────────────────────────────

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

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: TicketMessage }) {
  const isInternal = msg.is_internal;
  const isStaff = msg.is_staff_reply;

  const bubbleStyle: React.CSSProperties = isInternal
    ? { background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }
    : isStaff
    ? { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }
    : { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", marginBottom: 10 };

  return (
    <div style={bubbleStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: ".82rem", color: isInternal ? "#92400e" : isStaff ? "#1e40af" : "#475569" }}>
          {isInternal && "🔒 Internal note · "}
          {msg.sender_name ?? msg.sender_email ?? `User #${msg.sender}`}
          {isInternal && <em style={{ fontWeight: 400, fontSize: ".78rem" }}> (staff only)</em>}
        </span>
        <span style={{ fontSize: ".75rem", color: "#94a3b8", whiteSpace: "nowrap" }}>{formatDate(msg.created_at)}</span>
      </div>
      <p style={{ margin: 0, fontSize: ".88rem", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#0f172a" }}>{msg.body}</p>
    </div>
  );
}

// ── Stage progress bar (admin) ────────────────────────────────────────────────

function StageBar({ stages, currentStage }: { stages: ServiceStage[]; currentStage: string }) {
  if (!stages.length) return null;
  const activeIdx = stages.findIndex((s) => s.key === currentStage);

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "center", marginBottom: 16, overflowX: "auto", paddingBottom: 2 }} role="list" aria-label="Ticket progress">
      {stages.map((stage, i) => {
        const isDone = activeIdx >= 0 && i < activeIdx;
        const isActive = stage.key === currentStage;
        return (
          <div key={stage.key} style={{ display: "flex", alignItems: "center", flexShrink: 0 }} role="listitem">
            <div
              title={stage.description ?? stage.label}
              aria-current={isActive ? "step" : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "6px 10px", borderRadius: 8, fontSize: ".73rem", fontWeight: 700,
                background: isActive ? "#234395" : isDone ? "#dcfce7" : "#f1f5f9",
                color: isActive ? "#fff" : isDone ? "#166534" : "#64748b",
                minWidth: 80, textAlign: "center",
              }}
            >
              <span style={{ fontSize: ".9rem" }}>{stage.icon ?? (isDone ? "✓" : isActive ? "●" : "○")}</span>
              <span>{stage.label}</span>
            </div>
            {i < stages.length - 1 && (
              <ChevronRight size={14} style={{ color: "#cbd5e1", flexShrink: 0 }} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  // Panel state
  const [selected, setSelected] = useState<AdminTicket | null>(null);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [panelNotice, setPanelNotice] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "messages">("details");

  // Ticket edit drafts
  const [draftStatus, setDraftStatus] = useState("");
  const [draftPriority, setDraftPriority] = useState("");
  const [draftAssignedTo, setDraftAssignedTo] = useState<number | "">("");
  const [draftTeam, setDraftTeam] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStage, setDraftStage] = useState("");

  // Messages
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Category stages (fetched per category on panel open)
  const [categoryStages, setCategoryStages] = useState<ServiceStage[]>([]);

  // Recovery code modal
  const [recoveryResult, setRecoveryResult] = useState<{ backup_code: string; temp_password: string } | null>(null);
  const [sendingRecovery, setSendingRecovery] = useState(false);

  // ── Initial data load ────────────────────────────────────────────────────

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

  // ── Auto-scroll messages to bottom ──────────────────────────────────────

  useEffect(() => {
    if (activeTab === "messages") {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTab]);

  // ── Panel open ───────────────────────────────────────────────────────────

  function openPanel(ticket: AdminTicket) {
    setSelected(ticket);
    setDraftStatus(ticket.status);
    setDraftPriority(ticket.priority);
    setDraftAssignedTo(ticket.assigned_to ?? "");
    setDraftTeam(ticket.team ?? "");
    setDraftSubject(ticket.subject);
    setDraftDescription(ticket.description ?? "");
    setDraftStage(ticket.current_stage ?? "");
    setPanelError("");
    setPanelNotice("");
    setActiveTab("details");
    setMessages([]);
    setReplyBody("");
    setIsInternal(false);
    setReplyError("");
    setRecoveryResult(null);
    setCategoryStages([]);

    // Fetch stages for the category
    if (ticket.category) {
      fetch(`/api/v1/services/`, { credentials: "include" })
        .then((r) => r.ok ? (r.json() as Promise<ServiceCategoryDetail[]>) : [])
        .then((cats) => {
          const cat = (cats as ServiceCategoryDetail[]).find((c) => c.id === ticket.category);
          if (cat?.stages) setCategoryStages(cat.stages);
        })
        .catch(() => {});
    }
  }

  // ── Load messages when tab switches ──────────────────────────────────────

  useEffect(() => {
    if (activeTab !== "messages" || !selected) return;
    setMessagesLoading(true);
    setReplyError("");
    fetch(`/api/v1/tickets/${selected.id}/messages/`, { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? (r.json() as Promise<TicketMessage[]>) : [])
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setMessagesLoading(false));
  }, [activeTab, selected]);

  // ── Save ticket ──────────────────────────────────────────────────────────

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
          current_stage: draftStage,
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

  // ── Send reply / internal note ────────────────────────────────────────────

  async function sendReply() {
    if (!selected || !replyBody.trim()) return;
    setSendingReply(true);
    setReplyError("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/tickets/${selected.id}/messages/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ body: replyBody.trim(), is_internal: isInternal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReplyError(messageFrom(data));
      } else {
        setMessages((prev) => [...prev, data as TicketMessage]);
        setReplyBody("");
        setIsInternal(false);
      }
    } catch {
      setReplyError("A network error occurred.");
    } finally {
      setSendingReply(false);
    }
  }

  // ── Send recovery code ────────────────────────────────────────────────────

  async function sendRecoveryCode() {
    if (!selected) return;
    setSendingRecovery(true);
    setPanelError("");
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/tickets/${selected.id}/recovery-code/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { backup_code?: string; temp_password?: string; detail?: string };
      if (!res.ok) {
        setPanelError(data.detail ?? "Could not generate recovery code.");
      } else if (data.backup_code && data.temp_password) {
        setRecoveryResult({ backup_code: data.backup_code, temp_password: data.temp_password });
      }
    } catch {
      setPanelError("A network error occurred.");
    } finally {
      setSendingRecovery(false);
    }
  }

  // ── Filtering ────────────────────────────────────────────────────────────

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

  const isAccountRecovery = selected
    ? ACCOUNT_RECOVERY_SLUGS.has(selected.category_slug ?? "")
    : false;

  // ── Export ────────────────────────────────────────────────────────────────

  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFilters, setExportFilters] = useState({ status: "", priority: "", category: "", from: "", to: "" });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  async function runExport() {
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams();
      if (exportFilters.status)   params.set("status",   exportFilters.status);
      if (exportFilters.priority) params.set("priority", exportFilters.priority);
      if (exportFilters.category) params.set("category", exportFilters.category);
      if (exportFilters.from)     params.set("from",     exportFilters.from);
      if (exportFilters.to)       params.set("to",       exportFilters.to);

      const url = `/api/v1/tickets/export/${params.toString() ? "?" + params.toString() : ""}`;
      const res = await fetch(url, { credentials: "include" });

      if (res.status === 204) {
        setExportError("No tickets match the selected filters.");
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { detail?: string };
        setExportError(d.detail ?? "Export failed.");
        return;
      }

      // Trigger browser download
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fileMatch   = disposition.match(/filename="([^"]+)"/);
      const filename    = fileMatch?.[1] ?? "IIC_Helpdesk_Report.xlsx";
      const link        = document.createElement("a");
      link.href         = URL.createObjectURL(blob);
      link.download     = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setShowExportPanel(false);
    } catch {
      setExportError("A network error occurred.");
    } finally {
      setExporting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="admin-content" style={{ paddingRight: selected ? 560 : undefined, transition: "padding-right 280ms ease" }}>

      <header className="admin-heading">
        <div>
          <p className="eyebrow">Support queue</p>
          <h1>Tickets</h1>
          <p>View, assign, and manage all support requests.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
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
          <button
            className="primary-button"
            style={{ display: "flex", alignItems: "center", gap: 7, background: "#166534", fontSize: ".85rem", padding: "9px 16px" }}
            onClick={() => { setShowExportPanel((v) => !v); setExportError(""); }}
          >
            <FileSpreadsheet size={15} aria-hidden="true" />
            {showExportPanel ? "Hide export" : "Export report"}
          </button>
        </div>
      </header>

      {/* ── Export panel ── */}
      <AnimatePresence>
        {showExportPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              background: "#fff", border: "1px solid #bbf7d0", borderRadius: 14,
              padding: "20px 22px", marginBottom: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 800, fontSize: ".95rem", color: "#166534", display: "flex", alignItems: "center", gap: 7 }}>
                  <FileSpreadsheet size={16} aria-hidden="true" /> Export Ticket Report
                </p>
                <p style={{ margin: "2px 0 0", fontSize: ".78rem", color: "#64748b" }}>
                  Generates an audit-grade Excel workbook with a Ticket Register sheet and Analytics Summary sheet.
                </p>
              </div>
              <button onClick={() => setShowExportPanel(false)} aria-label="Close export panel"
                style={{ border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
              <label style={{ display: "grid", gap: 4, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
                Status filter
                <select value={exportFilters.status} onChange={(e) => setExportFilters((p) => ({ ...p, status: e.target.value }))}
                  style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "7px 9px", fontSize: ".85rem" }}>
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
                Priority filter
                <select value={exportFilters.priority} onChange={(e) => setExportFilters((p) => ({ ...p, priority: e.target.value }))}
                  style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "7px 9px", fontSize: ".85rem" }}>
                  <option value="">All priorities</option>
                  {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
                From date
                <input type="date" value={exportFilters.from}
                  onChange={(e) => setExportFilters((p) => ({ ...p, from: e.target.value }))}
                  style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "7px 9px", fontSize: ".85rem" }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
                To date
                <input type="date" value={exportFilters.to}
                  onChange={(e) => setExportFilters((p) => ({ ...p, to: e.target.value }))}
                  style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "7px 9px", fontSize: ".85rem" }} />
              </label>
            </div>

            {exportError && (
              <p style={{ margin: "0 0 10px", color: "#991b1b", fontSize: ".83rem" }} role="alert">{exportError}</p>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                className="primary-button"
                style={{ display: "flex", alignItems: "center", gap: 7, background: "#166534", padding: "10px 20px" }}
                onClick={runExport}
                disabled={exporting}
              >
                <Download size={15} aria-hidden="true" />
                {exporting ? "Generating…" : "Download Excel (.xlsx)"}
              </button>
              <span style={{ fontSize: ".75rem", color: "#64748b" }}>
                Leave filters blank to export all tickets.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="admin-error" role="alert">{error}</p>}

      {loading ? (
        <div className="admin-loading">Loading tickets...</div>
      ) : (
        <>
          {/* ── Filters ── */}
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

          {/* ── Table ── */}
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

      {/* ── Slide-in detail panel ── */}
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
            style={{ width: 540 }}
          >
            {/* Header */}
            <div className="atq-panel-header">
              <div className="atq-panel-title">
                <span className="atq-panel-ref">{selected.reference}</span>
                <StatusBadge status={selected.status} />
              </div>
              <button className="atq-close" onClick={() => setSelected(null)} aria-label="Close panel">
                <X size={18} />
              </button>
            </div>

            {/* Tab bar */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 20px" }} role="tablist">
              {(["details", "messages"] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    border: 0, background: "transparent", padding: "10px 16px",
                    fontWeight: 700, fontSize: ".85rem", cursor: "pointer",
                    borderBottom: activeTab === tab ? "2px solid #234395" : "2px solid transparent",
                    color: activeTab === tab ? "#234395" : "#64748b",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  {tab === "details" ? <CircleDot size={14} aria-hidden="true" /> : <MessageSquare size={14} aria-hidden="true" />}
                  {tab === "details" ? "Details" : "Messages"}
                </button>
              ))}
            </div>

            {/* ── Details tab ── */}
            {activeTab === "details" && (
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

                {/* Stage bar */}
                {categoryStages.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <StageBar stages={categoryStages} currentStage={selected.current_stage ?? ""} />
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

                  {/* Stage selector (only when category has stages) */}
                  {categoryStages.length > 0 && (
                    <label className="atq-full">
                      Progress stage
                      <select value={draftStage} onChange={(e) => setDraftStage(e.target.value)}>
                        <option value="">— Not set —</option>
                        {categoryStages.map((s) => (
                          <option key={s.key} value={s.key}>{s.icon ? `${s.icon} ` : ""}{s.label}</option>
                        ))}
                      </select>
                    </label>
                  )}

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
                    <textarea rows={4} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} />
                  </label>
                </div>

                {/* Account recovery code button */}
                {isAccountRecovery && (
                  <div style={{ marginBottom: 12, padding: "14px 16px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div>
                        <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: ".85rem", color: "#9a3412" }}>
                          <KeyRound size={14} style={{ verticalAlign: "middle", marginRight: 4 }} aria-hidden="true" />
                          Account Recovery Code
                        </p>
                        <p style={{ margin: 0, fontSize: ".78rem", color: "#78350f" }}>
                          Generate an 8-digit backup code and temporary password for the student.
                        </p>
                      </div>
                      <button
                        className="primary-button"
                        style={{ background: "#ea580c", whiteSpace: "nowrap", fontSize: ".82rem", padding: "8px 14px" }}
                        onClick={sendRecoveryCode}
                        disabled={sendingRecovery}
                      >
                        {sendingRecovery ? "Generating..." : "Send code"}
                      </button>
                    </div>

                    {recoveryResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ marginTop: 12, background: "#fff", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 14px" }}
                      >
                        <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: ".82rem", color: "#166534" }}>
                          <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 4 }} aria-hidden="true" />
                          Code generated and emailed to student
                        </p>
                        <div style={{ display: "grid", gap: 4, fontSize: ".82rem" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: "#64748b", minWidth: 110 }}>Backup code:</span>
                            <code style={{ fontWeight: 700, letterSpacing: ".1em", background: "#f8fafc", padding: "1px 6px", borderRadius: 4 }}>{recoveryResult.backup_code}</code>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: "#64748b", minWidth: 110 }}>Temp password:</span>
                            <code style={{ fontWeight: 700, background: "#f8fafc", padding: "1px 6px", borderRadius: 4 }}>{recoveryResult.temp_password}</code>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

                {panelNotice && <p className="atq-notice" role="status">{panelNotice}</p>}
                {panelError && <p className="atq-error" role="alert">{panelError}</p>}

                <div className="atq-panel-actions">
                  <button className="primary-button" onClick={saveTicket} disabled={saving} style={{ width: "100%", justifyContent: "center" }}>
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Messages tab ── */}
            {activeTab === "messages" && (
              <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)" }}>
                {/* Thread */}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                  {messagesLoading ? (
                    <p style={{ color: "#64748b", fontSize: ".85rem", textAlign: "center", marginTop: 24 }}>Loading messages…</p>
                  ) : messages.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#94a3b8", marginTop: 40 }}>
                      <MessageSquare size={32} style={{ margin: "0 auto 8px", display: "block" }} aria-hidden="true" />
                      <p style={{ fontSize: ".88rem" }}>No messages yet. Send the first reply below.</p>
                    </div>
                  ) : (
                    messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Compose box */}
                <div style={{ borderTop: "1px solid var(--border)", padding: "14px 20px", background: "var(--surface)" }}>
                  {replyError && (
                    <p style={{ color: "#991b1b", fontSize: ".82rem", margin: "0 0 8px" }} role="alert">{replyError}</p>
                  )}
                  <textarea
                    rows={3}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={isInternal ? "Write an internal note (only visible to staff)…" : "Write a reply to the requester…"}
                    style={{
                      width: "100%", border: `1px solid ${isInternal ? "#fde68a" : "var(--control)"}`,
                      borderRadius: 9, padding: "10px 12px", resize: "vertical", fontSize: ".88rem",
                      fontFamily: "inherit", background: isInternal ? "#fefce8" : "var(--background)",
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply();
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: ".82rem", cursor: "pointer", color: "#92400e" }}>
                      <input
                        type="checkbox"
                        checked={isInternal}
                        onChange={(e) => setIsInternal(e.target.checked)}
                        style={{ width: 15, height: 15 }}
                      />
                      🔒 Internal note (staff only)
                    </label>
                    <button
                      className="primary-button"
                      onClick={sendReply}
                      disabled={sendingReply || !replyBody.trim()}
                      style={{ padding: "8px 18px", fontSize: ".85rem" }}
                    >
                      {sendingReply ? "Sending…" : isInternal ? "Add note" : "Send reply"}
                    </button>
                  </div>
                  <p style={{ fontSize: ".74rem", color: "#94a3b8", margin: "6px 0 0" }}>
                    Tip: Ctrl+Enter to send
                  </p>
                </div>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
