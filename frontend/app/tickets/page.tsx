"use client";

import { motion } from "motion/react";
import { InboxIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import type { AuthUser } from "@/lib/auth";

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

interface Ticket {
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
}

interface Service {
  id: number;
  name: string;
  slug: string;
}

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
  p1: "P1 \u00b7 Critical",
  p2: "P2 \u00b7 High",
  p3: "P3 \u00b7 Normal",
  p4: "P4 \u00b7 Low",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function MyTicketsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth check on mount
  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthUser | null) => {
        const authenticated = data?.id ? data : null;
        setUser(authenticated);
        if (!authenticated) router.replace("/login");
      })
      .catch(() => {
        setUser(null);
        router.replace("/login");
      });
  }, [router]);

  // Fetch tickets once authenticated
  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch("/api/v1/tickets/", { credentials: "include" }).then((r) =>
        r.ok
          ? r.json().then((d: { results?: Ticket[] } | Ticket[]) =>
              Array.isArray(d) ? d : (d.results ?? [])
            )
          : []
      ),
      fetch("/api/v1/services/", { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<Service[]>) : []
      ),
    ])
      .then(([ticketData, serviceData]) => {
        setTickets(ticketData);
        setServices(serviceData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const serviceMap = new Map<number, string>(services.map((s) => [s.id, s.name]));

  return (
    <>
      <SiteHeader />
      <main className="tickets-page shell">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Support requests</p>
            <h1>My tickets</h1>
          </div>
          <Link href="/tickets/new" className="nav-action">
            New request
          </Link>
        </div>

        {user === null && (
          <div className="tickets-empty">
            <InboxIcon aria-hidden="true" />
            <h2>Sign in to see your tickets</h2>
            <p>You need to be signed in to view your support requests.</p>
            <Link href="/login" className="primary-button">Sign in</Link>
          </div>
        )}

        {user !== null && loading && (
          <div className="tickets-empty" aria-live="polite" aria-busy="true">
            <span
              className="spin"
              role="status"
              aria-label="Loading tickets"
              style={{ display: "block", width: 36, height: 36, borderRadius: "50%", border: "3px solid var(--brand-soft)", borderTopColor: "var(--brand)" }}
            />
            <p style={{ color: "var(--muted)" }}>Loading your tickets...</p>
          </div>
        )}

        {!loading && user && tickets.length === 0 && (
          <div className="tickets-empty">
            <InboxIcon aria-hidden="true" />
            <h2>No requests yet</h2>
            <p>When you raise a support request it will appear here.</p>
            <Link href="/tickets/new" className="primary-button">Raise a request</Link>
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <ol className="ticket-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {tickets.map((ticket, index) => (
              <motion.li
                key={ticket.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: Math.min(index * 0.05, 0.3) }}
              >
                <article className="ticket-card">
                  <div className="ticket-card-top">
                    <span className="ticket-reference">{ticket.reference}</span>
                    <span className={STATUS_CSS[ticket.status]}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </div>
                  <h2>{ticket.subject}</h2>
                  <div className="ticket-card-meta">
                    {serviceMap.has(ticket.category) && (
                      <span>{serviceMap.get(ticket.category)}</span>
                    )}
                    <span>{formatDate(ticket.created_at)}</span>
                    <span className={`ticket-priority-${ticket.priority}`}>
                      {PRIORITY_LABELS[ticket.priority]}
                    </span>
                    {ticket.assignee_name && (
                      <span>Assigned to {ticket.assignee_name}</span>
                    )}
                  </div>
                </article>
              </motion.li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
