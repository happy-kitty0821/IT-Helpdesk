"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────

type TicketStatus =
  | "submitted"
  | "triaged"
  | "in_progress"
  | "waiting_requester"
  | "waiting_approval"
  | "resolved"
  | "closed"
  | "cancelled";

type TicketPriority = "p1" | "p2" | "p3" | "p4";

interface FullTicket {
  id: string;
  reference: string;
  category: number;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  extra_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  assignee_name: string | null;
  team: string;
}

interface Service {
  id: number;
  name: string;
  slug: string;
}

// ── Label / style maps ────────────────────────────────────────────────────

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

const STATUS_CSS: Record<TicketStatus, string> = {
  submitted: "ticket-status ticket-status-submitted",
  triaged: "ticket-status ticket-status-triaged",
  in_progress: "ticket-status ticket-status-in_progress",
  waiting_requester: "ticket-status ticket-status-waiting",
  waiting_approval: "ticket-status ticket-status-waiting",
  resolved: "ticket-status ticket-status-resolved",
  closed: "ticket-status ticket-status-closed",
  cancelled: "ticket-status ticket-status-cancelled",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  p1: "P1 · Critical",
  p2: "P2 · High",
  p3: "P3 · Normal",
  p4: "P4 · Low",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "some_field_name" → "Some field name" */
function formatFieldKey(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function TicketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [ticket, setTicket] = useState<FullTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [services, setServices] = useState<Service[]>([]);

  // Auth guard + data fetch
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Verify session
      const me = await fetch("/api/v1/auth/me/", { credentials: "include" });
      if (!me.ok) {
        router.replace("/login");
        return;
      }

      // Fetch ticket and services in parallel
      const [ticketRes, servicesRes] = await Promise.all([
        fetch(`/api/v1/tickets/${params.id}/`, { credentials: "include" }),
        fetch("/api/v1/services/", { credentials: "include" }),
      ]);

      if (cancelled) return;

      if (ticketRes.status === 404 || ticketRes.status === 403) {
        setError("not_found");
        setLoading(false);
        return;
      }

      if (!ticketRes.ok) {
        setError("An error occurred loading this ticket.");
        setLoading(false);
        return;
      }

      const ticketData = (await ticketRes.json()) as FullTicket;
      const serviceData: Service[] = servicesRes.ok
        ? ((await servicesRes.json()) as Service[])
        : [];

      setTicket(ticketData);
      setServices(serviceData);
      setLoading(false);
    }

    load().catch(() => {
      if (!cancelled) {
        setError("An unexpected error occurred.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [params.id, router]);

  const serviceMap = new Map<number, string>(services.map((s) => [s.id, s.name]));

  // ── Status transition ────────────────────────────────────────────────────

  async function handleStatusChange(newStatus: "cancelled" | "closed") {
    if (!ticket || transitioning) return;
    setTransitioning(true);
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/tickets/${ticket.id}/status/`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": token,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated = (await res.json()) as FullTicket;
        setTicket(updated);
      } else {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(data.detail ?? "Could not update ticket status.");
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setTransitioning(false);
    }
  }

  // ── Render states ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <SiteHeader />
        <main className="ticket-detail-page shell">
          <div
            className="tickets-empty"
            aria-live="polite"
            aria-busy="true"
          >
            <span
              className="spin"
              role="status"
              aria-label="Loading ticket"
              style={{
                display: "block",
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: "3px solid var(--brand-soft)",
                borderTopColor: "var(--brand)",
              }}
            />
            <p style={{ color: "var(--muted)" }}>Loading ticket…</p>
          </div>
        </main>
      </>
    );
  }

  if (error === "not_found" || !ticket) {
    return (
      <>
        <SiteHeader />
        <main className="ticket-detail-page shell">
          <Link href="/tickets" className="back-link">
            ← My tickets
          </Link>
          <div className="tickets-empty">
            <h2>Ticket not found</h2>
            <p>
              This ticket doesn&apos;t exist or you don&apos;t have permission
              to view it.
            </p>
            <Link href="/tickets" className="primary-button">
              Back to my tickets
            </Link>
          </div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <SiteHeader />
        <main className="ticket-detail-page shell">
          <Link href="/tickets" className="back-link">
            ← My tickets
          </Link>
          <p style={{ color: "#b91c1c" }}>{error}</p>
        </main>
      </>
    );
  }

  const extraEntries = Object.entries(ticket.extra_fields ?? {});
  const categoryName = serviceMap.get(ticket.category) ?? null;

  // Which action buttons to show
  const canCancel =
    ticket.status === "submitted" || ticket.status === "triaged";
  const canClose = ticket.status === "resolved";

  return (
    <>
      <SiteHeader />
      <main className="ticket-detail-page shell">
        {/* Back link */}
        <Link href="/tickets" className="back-link">
          ← My tickets
        </Link>

        {/* Inline error banner (e.g. failed status change) */}
        {error && (
          <p
            role="alert"
            style={{
              color: "#b91c1c",
              background: "#fef2f2",
              borderRadius: 9,
              padding: "10px 14px",
              margin: "0 0 16px",
            }}
          >
            {error}
          </p>
        )}

        {/* Two-column layout */}
        <div className="ticket-detail-layout">
          {/* ── Main column ── */}
          <section>
            <div className="ticket-detail-header">
              <span className="ticket-reference">{ticket.reference}</span>
              <span className={STATUS_CSS[ticket.status]}>
                {STATUS_LABELS[ticket.status]}
              </span>
            </div>

            <h1 className="ticket-detail-subject">{ticket.subject}</h1>

            <p className="ticket-description">{ticket.description}</p>

            {extraEntries.length > 0 && (
              <div className="ticket-extra-fields">
                <h2>Additional details</h2>
                <dl>
                  {extraEntries.map(([key, value]) => (
                    <>
                      <dt key={`dt-${key}`}>{formatFieldKey(key)}</dt>
                      <dd key={`dd-${key}`}>{String(value ?? "—")}</dd>
                    </>
                  ))}
                </dl>
              </div>
            )}
          </section>

          {/* ── Sidebar ── */}
          <aside>
            <div className="ticket-meta-card">
              {categoryName && (
                <div className="ticket-meta-row">
                  <span>Category</span>
                  <span>{categoryName}</span>
                </div>
              )}

              <div className="ticket-meta-row">
                <span>Priority</span>
                <span
                  className={`ticket-priority-${ticket.priority}`}
                  style={{ fontWeight: 700 }}
                >
                  {PRIORITY_LABELS[ticket.priority]}
                </span>
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
            {(canCancel || canClose) && (
              <div className="ticket-actions">
                {canCancel && (
                  <button
                    className="danger-button"
                    disabled={transitioning}
                    onClick={() => handleStatusChange("cancelled")}
                  >
                    {transitioning ? "Cancelling…" : "Cancel request"}
                  </button>
                )}
                {canClose && (
                  <button
                    className="primary-button"
                    disabled={transitioning}
                    onClick={() => handleStatusChange("closed")}
                  >
                    {transitioning ? "Closing…" : "Close & confirm"}
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
