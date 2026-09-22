"use client";

import { motion, AnimatePresence } from "motion/react";
import { InboxIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { fadeIn, fadeUp, staggerContainer, staggerItem } from "@/lib/animations";
import type { AuthUser } from "@/lib/auth";

type TicketStatus =
  | "submitted" | "triaged" | "in_progress" | "waiting_requester"
  | "waiting_approval" | "resolved" | "closed" | "cancelled";
type TicketPriority = "p1" | "p2" | "p3" | "p4";

interface Ticket {
  id: string; reference: string; category: number;
  subject: string; description: string;
  status: TicketStatus; priority: TicketPriority;
  extra_fields: Record<string, unknown>;
  created_at: string; updated_at: string;
  assignee_name: string | null;
}
interface Service { id: number; name: string; slug: string; }

const STATUS_LABELS: Record<TicketStatus, string> = {
  submitted: "Submitted", triaged: "Triaged", in_progress: "In Progress",
  waiting_requester: "Waiting for you", waiting_approval: "Awaiting approval",
  resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
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
  p1: "P1 · Critical", p2: "P2 · High", p3: "P3 · Normal", p4: "P4 · Low",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function TicketSkeleton() {
  return (
    <motion.div variants={fadeIn} initial="hidden" animate="show">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="ticket-card"
          aria-hidden="true"
          style={{ marginBottom: 14, display: "grid", gap: 12 }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <div className="skel-line" style={{ width: 90, height: 20, borderRadius: 999 }} />
            <div className="skel-line" style={{ width: 80, height: 20, borderRadius: 999 }} />
          </div>
          <div className="skel-line" style={{ width: "65%", height: 18 }} />
          <div style={{ display: "flex", gap: 14 }}>
            <div className="skel-line" style={{ width: 110, height: 13 }} />
            <div className="skel-line" style={{ width: 80,  height: 13 }} />
          </div>
        </div>
      ))}
    </motion.div>
  );
}

export default function MyTicketsPage() {
  const router = useRouter();
  const [user, setUser]       = useState<AuthUser | null | undefined>(undefined);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthUser | null) => {
        const authenticated = data?.id ? data : null;
        setUser(authenticated);
        if (!authenticated) router.replace("/login");
      })
      .catch(() => { setUser(null); router.replace("/login"); });
  }, [router]);

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
      .then(([ticketData, serviceData]) => { setTickets(ticketData); setServices(serviceData); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const serviceMap = new Map<number, string>(services.map((s) => [s.id, s.name]));

  return (
    <>
      <SiteHeader />
      <main className="tickets-page shell">
        {/* Heading */}
        <motion.div
          className="page-heading"
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <div>
            <p className="eyebrow">Support requests</p>
            <h1>My tickets</h1>
          </div>
          <Link href="/tickets/new" className="nav-action">New request</Link>
        </motion.div>

        <AnimatePresence mode="wait">

          {/* Not signed in */}
          {user === null && (
            <motion.div key="signed-out" className="tickets-empty"
              variants={fadeUp} initial="hidden" animate="show" exit={{ opacity: 0 }}>
              <InboxIcon aria-hidden="true" />
              <h2>Sign in to see your tickets</h2>
              <p>You need to be signed in to view your support requests.</p>
              <Link href="/login" className="primary-button">Sign in</Link>
            </motion.div>
          )}

          {/* Loading skeleton */}
          {user !== null && loading && (
            <motion.div key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              aria-live="polite" aria-busy="true">
              <TicketSkeleton />
            </motion.div>
          )}

          {/* Empty state */}
          {!loading && user && tickets.length === 0 && (
            <motion.div key="empty" className="tickets-empty"
              variants={fadeUp} initial="hidden" animate="show" exit={{ opacity: 0 }}>
              <InboxIcon aria-hidden="true" />
              <h2>No requests yet</h2>
              <p>When you raise a support request it will appear here.</p>
              <Link href="/tickets/new" className="primary-button">Raise a request</Link>
            </motion.div>
          )}

          {/* Ticket list */}
          {!loading && tickets.length > 0 && (
            <motion.ol
              key="list"
              className="ticket-list"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {tickets.map((ticket) => (
                <motion.li key={ticket.id} variants={staggerItem}>
                  <Link href={`/tickets/${ticket.id}`} style={{ display: "block" }}>
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
                  </Link>
                </motion.li>
              ))}
            </motion.ol>
          )}

        </AnimatePresence>
      </main>
    </>
  );
}
