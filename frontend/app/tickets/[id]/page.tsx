"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft, Calendar, CheckCircle2, CircleDot,
  Clock, Info, Tag, User, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

type TicketStatus =
  | "submitted" | "triaged" | "in_progress" | "waiting_requester"
  | "waiting_approval" | "resolved" | "closed" | "cancelled";

type TicketPriority = "p1" | "p2" | "p3" | "p4";

interface FullTicket {
  id: string;
  reference: string;
  category: number;
  category_name: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  status_reason: string;
  priority: TicketPriority;
  extra_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  elapsed: string;
  requester_name: string | null;
  requester_email: string | null;
  assignee_name: string | null;
  team: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TicketStatus, string> = {
  submitted: "Submitted",
  triaged: "Triaged",
  in_progress: "In Progress",
  waiting_requester: "Waiting for you",
  waiting_approval: "Awaiting approval",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<TicketStatus, { text: string; bg: string }> = {
  submitted:        { text: "#1e40af", bg: "#dbeafe" },
  triaged:          { text: "#5b21b6", bg: "#ede9fe" },
  in_progress:      { text: "#92400e", bg: "#fef3c7" },
  waiting_requester:{ text: "#9a3412", bg: "#ffedd5" },
  waiting_approval: { text: "#6b21a8", bg: "#f3e8ff" },
  resolved:         { text: "#166534", bg: "#dcfce7" },
  closed:           { text: "#475569", bg: "#f1f5f9" },
  cancelled:        { text: "#991b1b", bg: "#fee2e2" },
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  p1: "Critical", p2: "High", p3: "Normal", p4: "Low",
};

const PRIORITY_COLORS: Record<TicketPriority, { text: string; bg: string }> = {
  p1: { text: "#991b1b", bg: "#fee2e2" },
  p2: { text: "#92400e", bg: "#fef3c7" },
  p3: { text: "#475569", bg: "#f1f5f9" },
  p4: { text: "#166534", bg: "#dcfce7" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatFieldKey(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const { text, bg } = STATUS_COLORS[status] ?? { text: "#475569", bg: "#f1f5f9" };
  return (
    <span style={{ color: text, background: bg, borderRadius: 999, padding: "4px 12px", fontSize: ".8rem", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 5 }}>
      <CircleDot size={11} aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { text, bg } = PRIORITY_COLORS[priority] ?? { text: "#475569", bg: "#f1f5f9" };
  return (
    <span style={{ color: text, background: bg, borderRadius: 999, padding: "4px 10px", fontSize: ".78rem", fontWeight: 800 }}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [ticket, setTicket] = useState<FullTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<"not_found" | "error" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showReasonFor, setShowReasonFor] = useState<"cancelled" | "closed" | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      const me = await fetch("/api/v1/auth/me/", { credentials: "include" });
      const meData = await me.json().catch(() => ({})) as { id?: number };
      if (!meData?.id) { router.replace("/login"); return; }

      const res = await fetch(`/api/v1/tickets/${params.id}/`, { credentials: "include" });
      if (!mounted) return;

      if (res.status === 404 || res.status === 403) {
        setPageError("not_found");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setPageError("error");
        setLoading(false);
        return;
      }

      setTicket(await res.json() as FullTicket);
      setLoading(false);
    }

    load().catch(() => {
      if (mounted) { setPageError("error"); setLoading(false); }
    });

    return () => { mounted = false; };
  }, [params.id, router]);

  async function submitStatusChange(newStatus: "cancelled" | "closed") {
    if (!ticket) return;
    setTransitioning(true);
    setActionError(null);
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/tickets/${ticket.id}/status/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ status: newStatus, reason }),
      });
      if (res.ok) {
        setTicket(await res.json() as FullTicket);
        setShowReasonFor(null);
        setReason("");
      } else {
        const d = await res.json().catch(() => ({})) as { detail?: string };
        setActionError(d.detail ?? "Could not update status.");
      }
    } catch {
      setActionError("A network error occurred.");
    } finally {
      setTransitioning(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────

  if (loading) return (
    <>
      <SiteHeader />
      <main className="ticket-detail-page shell">
        <div className="td-loading">
          <span className="spin" aria-label="Loading ticket" style={{ display: "block", width: 32, height: 32, borderRadius: "50%", border: "3px solid var(--brand-soft)", borderTopColor: "var(--brand)" }} />
          <p>Loading ticket...</p>
        </div>
      </main>
    </>
  );

  if (pageError || !ticket) return (
    <>
      <SiteHeader />
      <main className="ticket-detail-page shell">
        <Link href="/tickets" className="back-link">
          <ArrowLeft size={16} aria-hidden="true" /> My tickets
        </Link>
        <div className="tickets-empty">
          <h2>{pageError === "not_found" ? "Ticket not found" : "Something went wrong"}</h2>
          <p>
            {pageError === "not_found"
              ? "This ticket doesn't exist or you don't have permission to view it."
              : "An unexpected error occurred loading this ticket."}
          </p>
          <Link href="/tickets" className="primary-button">Back to my tickets</Link>
        </div>
      </main>
    </>
  );

  const canCancel = ticket.status === "submitted" || ticket.status === "triaged";
  const canClose  = ticket.status === "resolved";
  const isClosed  = ticket.status === "closed" || ticket.status === "cancelled";

  const extraEntries = Object.entries(ticket.extra_fields ?? {});

  return (
    <>
      <SiteHeader />
      <main className="ticket-detail-page shell">

        <Link href="/tickets" className="back-link">
          <ArrowLeft size={16} aria-hidden="true" /> My tickets
        </Link>

        {actionError && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ color: "#991b1b", background: "#fee2e2", borderRadius: 10, padding: "10px 16px", margin: "0 0 20px", fontSize: ".9rem" }}
          >
            {actionError}
          </motion.p>
        )}

        {/* ── Hero header ────────────────────────────────────────────── */}
        <div className="td-hero">
          <div className="td-badges">
            <span className="ticket-reference">{ticket.reference}</span>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <h1 className="td-subject">{ticket.subject}</h1>
          <div className="td-byline">
            <span><User size={14} aria-hidden="true" /> {ticket.requester_name ?? "Unknown"}</span>
            <span><Clock size={14} aria-hidden="true" /> {ticket.elapsed}</span>
            <span><Calendar size={14} aria-hidden="true" /> {formatDate(ticket.created_at)}</span>
            {ticket.category_name && <span><Tag size={14} aria-hidden="true" /> {ticket.category_name}</span>}
          </div>
        </div>

        {/* ── Two-column body ─────────────────────────────────────────── */}
        <div className="ticket-detail-layout">

          {/* Main column */}
          <section>
            <div className="td-card">
              <h2 className="td-card-title">Description</h2>
              <p className="ticket-description">{ticket.description}</p>
            </div>

            {extraEntries.length > 0 && (
              <div className="td-card" style={{ marginTop: 16 }}>
                <h2 className="td-card-title">Additional details</h2>
                <dl className="td-extra-fields">
                  {extraEntries.map(([key, value]) => (
                    <div key={key} className="td-extra-row">
                      <dt>{formatFieldKey(key)}</dt>
                      <dd>{String(value ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {isClosed && ticket.status_reason && (
              <div className="td-card td-reason-card" style={{ marginTop: 16 }}>
                <h2 className="td-card-title">
                  {ticket.status === "cancelled" ? "Cancellation reason" : "Closure note"}
                </h2>
                <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>{ticket.status_reason}</p>
              </div>
            )}
          </section>

          {/* Sidebar */}
          <aside>
            <div className="ticket-meta-card">
              <h2 className="td-meta-heading">Ticket details</h2>

              <div className="ticket-meta-row">
                <span>Submitted by</span>
                <span>
                  <strong style={{ display: "block" }}>{ticket.requester_name ?? "—"}</strong>
                  {ticket.requester_email && (
                    <small style={{ color: "var(--muted)", fontSize: ".8rem" }}>{ticket.requester_email}</small>
                  )}
                </span>
              </div>

              {ticket.category_name && (
                <div className="ticket-meta-row">
                  <span>Category</span>
                  <span>{ticket.category_name}</span>
                </div>
              )}

              <div className="ticket-meta-row">
                <span>Priority</span>
                <span><PriorityBadge priority={ticket.priority} /></span>
              </div>

              <div className="ticket-meta-row">
                <span>Status</span>
                <span><StatusBadge status={ticket.status} /></span>
              </div>

              <div className="ticket-meta-row">
                <span>Time elapsed</span>
                <span style={{ color: "var(--muted)", fontStyle: "italic" }}>{ticket.elapsed}</span>
              </div>

              <div className="ticket-meta-row">
                <span>Submitted</span>
                <span>{formatDate(ticket.created_at)}</span>
              </div>

              <div className="ticket-meta-row">
                <span>Last updated</span>
                <span>{formatDate(ticket.updated_at)}</span>
              </div>

              {ticket.assignee_name && (
                <div className="ticket-meta-row">
                  <span>Assigned to</span>
                  <span>{ticket.assignee_name}</span>
                </div>
              )}

              {ticket.team && (
                <div className="ticket-meta-row">
                  <span>Team</span>
                  <span>{ticket.team}</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            {(canCancel || canClose) && !showReasonFor && (
              <div className="ticket-actions" style={{ marginTop: 16 }}>
                {canCancel && (
                  <button
                    className="danger-button"
                    onClick={() => { setShowReasonFor("cancelled"); setReason(""); }}
                  >
                    <XCircle size={16} aria-hidden="true" /> Cancel request
                  </button>
                )}
                {canClose && (
                  <button
                    className="primary-button"
                    style={{ display: "flex", alignItems: "center", gap: 7 }}
                    onClick={() => { setShowReasonFor("closed"); setReason(""); }}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" /> Close & confirm
                  </button>
                )}
              </div>
            )}

            {/* Reason prompt */}
            <AnimatePresence>
              {showReasonFor && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  style={{ marginTop: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}
                >
                  <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: ".9rem" }}>
                    {showReasonFor === "cancelled" ? "Why are you cancelling?" : "Any notes before closing?"}
                    {" "}<span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span>
                  </p>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={
                      showReasonFor === "cancelled"
                        ? "e.g. Issue resolved on my own"
                        : "e.g. IT team resolved the issue, everything is working"
                    }
                    style={{ width: "100%", border: "1px solid var(--control)", borderRadius: 9, padding: "10px 12px", resize: "vertical", fontSize: ".9rem", fontFamily: "inherit" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      className={showReasonFor === "cancelled" ? "danger-button" : "primary-button"}
                      disabled={transitioning}
                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                      onClick={() => submitStatusChange(showReasonFor)}
                    >
                      {transitioning
                        ? "Updating..."
                        : showReasonFor === "cancelled" ? "Confirm cancel" : "Confirm close"}
                    </button>
                    <button className="secondary-button" onClick={() => setShowReasonFor(null)}>
                      Back
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Closed notice */}
            {isClosed && (
              <div style={{ marginTop: 16, background: "var(--brand-soft)", borderRadius: 12, padding: "14px 16px", display: "flex", gap: 10, fontSize: ".85rem", color: "var(--muted)" }}>
                <Info size={16} style={{ color: "var(--brand)", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <span>
                  This ticket is {STATUS_LABELS[ticket.status].toLowerCase()}. No further actions are available.
                </span>
              </div>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
