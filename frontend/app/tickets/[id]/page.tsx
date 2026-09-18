"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft, Calendar, CheckCircle2, ChevronRight, CircleDot,
  Clock, Info, MessageSquare, Send, Tag, User, Wifi, WifiOff, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken } from "@/lib/auth";
import { useTicketStream, type TicketSnapshot, type StreamMessage } from "@/hooks/use-ticket-stream";

// ── Types ──────────────────────────────────────────────────────────────────

type TicketStatus =
  | "submitted" | "triaged" | "in_progress" | "waiting_requester"
  | "waiting_approval" | "resolved" | "closed" | "cancelled";

type TicketPriority = "p1" | "p2" | "p3" | "p4";

interface ServiceStage {
  key: string;
  label: string;
  description?: string;
  icon?: string;
}

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
  current_stage: string;
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

interface ServiceCategory {
  id: number;
  stages: ServiceStage[];
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

function messageFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r)) {
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  return "Could not complete the request.";
}

// ── Sub-components ─────────────────────────────────────────────────────────

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

// ── Visual progress tracker ────────────────────────────────────────────────

function ProgressTracker({ stages, currentStage }: { stages: ServiceStage[]; currentStage: string }) {
  if (!stages.length) return null;

  const activeIdx = stages.findIndex((s) => s.key === currentStage);
  const activeStage = stages[activeIdx];

  return (
    <div className="td-card" style={{ marginBottom: 16 }}>
      <h2 className="td-card-title" style={{ marginBottom: 14 }}>Ticket progress</h2>

      {/* Stepper */}
      <div
        role="list"
        aria-label="Progress stages"
        style={{ display: "flex", alignItems: "flex-start", gap: 0, overflowX: "auto", paddingBottom: 4 }}
      >
        {stages.map((stage, i) => {
          const isDone = activeIdx >= 0 && i < activeIdx;
          const isActive = stage.key === currentStage;
          const isPending = activeIdx < 0 || i > activeIdx;

          return (
            <div
              key={stage.key}
              role="listitem"
              style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
            >
              {/* Step node */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 88 }}>
                {/* Circle */}
                <motion.div
                  initial={false}
                  animate={{
                    background: isDone ? "#dcfce7" : isActive ? "#234395" : "#f1f5f9",
                    borderColor: isDone ? "#86efac" : isActive ? "#234395" : "#cbd5e1",
                  }}
                  aria-current={isActive ? "step" : undefined}
                  style={{
                    width: 40, height: 40, borderRadius: "50%",
                    border: "2px solid",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.05rem",
                    flexShrink: 0,
                  }}
                >
                  {isDone ? (
                    <CheckCircle2 size={20} style={{ color: "#166534" }} aria-hidden="true" />
                  ) : stage.icon ? (
                    <span style={{ color: isActive ? "#fff" : "#94a3b8" }}>{stage.icon}</span>
                  ) : (
                    <span style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: isActive ? "#fff" : isPending ? "#cbd5e1" : "#166534",
                      display: "block",
                    }} />
                  )}
                </motion.div>

                {/* Label */}
                <span style={{
                  fontSize: ".72rem", fontWeight: isActive ? 800 : 600,
                  color: isActive ? "#234395" : isDone ? "#166534" : "#94a3b8",
                  textAlign: "center", lineHeight: 1.3, maxWidth: 80,
                }}>
                  {stage.label}
                </span>
              </div>

              {/* Connector line */}
              {i < stages.length - 1 && (
                <div style={{
                  height: 2, width: 24, flexShrink: 0, marginBottom: 22,
                  background: isDone ? "#86efac" : "#e2e8f0",
                }} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      {/* Active stage description */}
      {activeStage?.description && (
        <p style={{
          margin: "10px 0 0", fontSize: ".83rem", color: "#475569",
          background: "#f8fafc", borderRadius: 8, padding: "8px 12px",
          borderLeft: "3px solid #234395",
        }}>
          {activeStage.description}
        </p>
      )}

      {activeIdx < 0 && (
        <p style={{ margin: "8px 0 0", fontSize: ".82rem", color: "#94a3b8" }}>
          Stage tracking will appear here once the team begins processing your request.
        </p>
      )}
    </div>
  );
}

// ── Message thread ─────────────────────────────────────────────────────────

function MessageThread({
  messages,
  myId,
  replyBody,
  setReplyBody,
  sendingReply,
  replyError,
  onSend,
  isClosed,
}: {
  messages: TicketMessage[];
  myId: number | null;
  replyBody: string;
  setReplyBody: (v: string) => void;
  sendingReply: boolean;
  replyError: string | null;
  onSend: () => void;
  isClosed: boolean;
}) {
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="td-card" style={{ marginTop: 16 }}>
      <h2 className="td-card-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <MessageSquare size={16} aria-hidden="true" />
        Messages
        {messages.length > 0 && (
          <span style={{ fontSize: ".78rem", fontWeight: 600, color: "#94a3b8", background: "#f1f5f9", borderRadius: 999, padding: "1px 8px" }}>
            {messages.length}
          </span>
        )}
      </h2>

      {/* Thread */}
      <div role="log" aria-live="polite" aria-label="Message thread">
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#94a3b8" }}>
            <MessageSquare size={28} style={{ margin: "0 auto 8px", display: "block" }} aria-hidden="true" />
            <p style={{ margin: 0, fontSize: ".85rem" }}>No messages yet. Use the box below to send a message to the IT team.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((msg) => {
              const isMe = msg.sender === myId;
              const isStaff = msg.is_staff_reply;

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    alignSelf: isMe ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                  }}
                >
                  {/* Sender label */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 4,
                    justifyContent: isMe ? "flex-end" : "flex-start",
                  }}>
                    <span style={{ fontSize: ".74rem", fontWeight: 700, color: isStaff ? "#1e40af" : "#475569" }}>
                      {isMe ? "You" : (msg.sender_name ?? msg.sender_email ?? "IT Support")}
                    </span>
                    {isStaff && !isMe && (
                      <span style={{ fontSize: ".68rem", fontWeight: 700, background: "#dbeafe", color: "#1e40af", borderRadius: 999, padding: "1px 6px" }}>
                        IT Support
                      </span>
                    )}
                    <span style={{ fontSize: ".72rem", color: "#94a3b8" }}>{formatDate(msg.created_at)}</span>
                  </div>

                  {/* Bubble */}
                  <div style={{
                    background: isMe ? "#234395" : isStaff ? "#eff6ff" : "#f8fafc",
                    color: isMe ? "#fff" : "#0f172a",
                    border: isMe ? "none" : `1px solid ${isStaff ? "#bfdbfe" : "#e2e8f0"}`,
                    borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    padding: "10px 14px",
                    fontSize: ".88rem",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}>
                    {msg.body}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Compose */}
      {!isClosed && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          {replyError && (
            <p style={{ margin: "0 0 8px", color: "#991b1b", fontSize: ".82rem" }} role="alert">{replyError}</p>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write a message to the IT team…"
              rows={2}
              style={{
                flex: 1, border: "1px solid var(--control)", borderRadius: 10,
                padding: "10px 13px", resize: "vertical", fontSize: ".88rem",
                fontFamily: "inherit", background: "var(--background)",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend();
              }}
              aria-label="Message the IT team"
            />
            <button
              className="primary-button"
              onClick={onSend}
              disabled={sendingReply || !replyBody.trim()}
              style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
              aria-label="Send message"
            >
              <Send size={15} aria-hidden="true" />
              {sendingReply ? "Sending…" : "Send"}
            </button>
          </div>
          <p style={{ margin: "5px 0 0", fontSize: ".73rem", color: "#94a3b8" }}>
            Ctrl+Enter to send
          </p>
        </div>
      )}

      {isClosed && (
        <p style={{ marginTop: 12, fontSize: ".82rem", color: "#94a3b8", textAlign: "center" }}>
          This ticket is closed. Replies are no longer accepted.
        </p>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [ticket, setTicket] = useState<FullTicket | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<"not_found" | "error" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showReasonFor, setShowReasonFor] = useState<"cancelled" | "closed" | null>(null);
  const [reason, setReason] = useState("");

  // Stages from the category
  const [stages, setStages] = useState<ServiceStage[]>([]);

  // Messages
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // SSE connection state
  const [streamConnected, setStreamConnected] = useState(false);

  // ── SSE stream callbacks ───────────────────────────────────────────────

  const handleTicketUpdate = useCallback((snapshot: TicketSnapshot) => {
    setTicket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status:        snapshot.status as typeof prev.status,
        priority:      snapshot.priority as typeof prev.priority,
        current_stage: snapshot.current_stage,
        subject:       snapshot.subject,
        assignee_name: snapshot.assignee_name,
        team:          snapshot.team,
        updated_at:    snapshot.updated_at ?? prev.updated_at,
      };
    });
  }, []);

  const handleNewMessage = useCallback((msg: StreamMessage) => {
    setMessages((prev) => {
      // Deduplicate by id in case of reconnect
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg as unknown as TicketMessage];
    });
  }, []);

  // Open SSE stream once ticket is loaded; disable when ticket is closed
  useTicketStream({
    ticketId: ticket?.id ?? null,
    enabled:  !loading && !pageError && !!ticket,
    onTicketUpdate: handleTicketUpdate,
    onNewMessage:   handleNewMessage,
    onConnected:    () => setStreamConnected(true),
    onError:        () => setStreamConnected(false),
  });

  // ── Load ticket + messages + stages ─────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    async function load() {
      // Auth check
      const meRes = await fetch("/api/v1/auth/me/", { credentials: "include" });
      const meData = await meRes.json().catch(() => ({})) as { id?: number };
      if (!meData?.id) { router.replace("/login"); return; }
      if (mounted) setMyId(meData.id);

      // Fetch ticket
      const res = await fetch(`/api/v1/tickets/${params.id}/`, { credentials: "include" });
      if (!mounted) return;

      if (res.status === 404 || res.status === 403) {
        setPageError("not_found"); setLoading(false); return;
      }
      if (!res.ok) {
        setPageError("error"); setLoading(false); return;
      }

      const ticketData = await res.json() as FullTicket;
      if (!mounted) return;
      setTicket(ticketData);

      // Fetch messages and stages in parallel
      const [msgsRes, svcRes] = await Promise.all([
        fetch(`/api/v1/tickets/${params.id}/messages/`, { credentials: "include", cache: "no-store" }),
        fetch("/api/v1/services/", { credentials: "include" }),
      ]);

      if (mounted) {
        if (msgsRes.ok) {
          const msgs = await msgsRes.json().catch(() => []) as TicketMessage[];
          setMessages(msgs);
        }
        if (svcRes.ok) {
          const cats = await svcRes.json().catch(() => []) as ServiceCategory[];
          const cat = cats.find((c) => c.id === ticketData.category);
          if (cat?.stages) setStages(cat.stages);
        }
        setLoading(false);
      }
    }

    load().catch(() => {
      if (mounted) { setPageError("error"); setLoading(false); }
    });

    return () => { mounted = false; };
  }, [params.id, router]);

  // ── Status change (cancel / close) ──────────────────────────────────────

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

  // ── Send reply ────────────────────────────────────────────────────────────

  async function sendReply() {
    if (!ticket || !replyBody.trim()) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/tickets/${ticket.id}/messages/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReplyError(messageFrom(data));
      } else {
        setMessages((prev) => [...prev, data as TicketMessage]);
        setReplyBody("");
      }
    } catch {
      setReplyError("A network error occurred.");
    } finally {
      setSendingReply(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────

  if (loading) return (
    <>
      <SiteHeader />
      <main className="ticket-detail-page shell">
        <div className="td-loading">
          <span aria-label="Loading ticket" style={{ display: "block", width: 32, height: 32, borderRadius: "50%", border: "3px solid var(--brand-soft)", borderTopColor: "var(--brand)", animation: "spin 0.8s linear infinite" }} />
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

        {/* ── Hero header ───────────────────────────────────────────── */}
        <div className="td-hero">
          <div className="td-badges">
            <span className="ticket-reference">{ticket.reference}</span>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {/* Live indicator */}
            {!isClosed && (
              <span
                title={streamConnected ? "Live updates active" : "Connecting…"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: ".72rem", fontWeight: 700,
                  borderRadius: 999, padding: "3px 9px",
                  background: streamConnected ? "#f0fdf4" : "#f8fafc",
                  color:      streamConnected ? "#166534" : "#94a3b8",
                  border:     `1px solid ${streamConnected ? "#bbf7d0" : "#e2e8f0"}`,
                }}
                aria-live="polite"
                aria-label={streamConnected ? "Live updates active" : "Connecting to live updates"}
              >
                {streamConnected
                  ? <Wifi size={11} aria-hidden="true" />
                  : <WifiOff size={11} aria-hidden="true" />}
                {streamConnected ? "Live" : "Connecting…"}
              </span>
            )}
          </div>
          <h1 className="td-subject">{ticket.subject}</h1>
          <div className="td-byline">
            <span><User size={14} aria-hidden="true" /> {ticket.requester_name ?? "Unknown"}</span>
            <span><Clock size={14} aria-hidden="true" /> {ticket.elapsed}</span>
            <span><Calendar size={14} aria-hidden="true" /> {formatDate(ticket.created_at)}</span>
            {ticket.category_name && <span><Tag size={14} aria-hidden="true" /> {ticket.category_name}</span>}
          </div>
        </div>

        {/* ── Two-column body ───────────────────────────────────────── */}
        <div className="ticket-detail-layout">

          {/* Main column */}
          <section>
            {/* Visual progress tracker */}
            {stages.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <ProgressTracker stages={stages} currentStage={ticket.current_stage ?? ""} />
              </motion.div>
            )}

            {/* Description */}
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

            {/* Message thread */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <MessageThread
                messages={messages}
                myId={myId}
                replyBody={replyBody}
                setReplyBody={setReplyBody}
                sendingReply={sendingReply}
                replyError={replyError}
                onSend={sendReply}
                isClosed={isClosed}
              />
            </motion.div>
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

              {ticket.current_stage && stages.length > 0 && (
                <div className="ticket-meta-row">
                  <span>Current stage</span>
                  <span style={{ fontWeight: 700, color: "#234395", display: "flex", alignItems: "center", gap: 5 }}>
                    <ChevronRight size={13} aria-hidden="true" />
                    {stages.find((s) => s.key === ticket.current_stage)?.label ?? ticket.current_stage}
                  </span>
                </div>
              )}

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
                    <CheckCircle2 size={16} aria-hidden="true" /> Close &amp; confirm
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
