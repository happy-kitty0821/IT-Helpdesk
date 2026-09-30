"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight, CheckCircle2, Clock, Inbox,
  Loader2, PlusCircle, TicketCheck, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { staggerContainer, fadeUp, staggerItem } from "@/lib/animations";
import type { AuthUser } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

type TicketStatus =
  | "submitted" | "triaged" | "in_progress" | "waiting_requester"
  | "waiting_approval" | "resolved" | "closed" | "cancelled";

interface Ticket {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  category_name: string | null;
  created_at: string;
  updated_at: string;
  assignee_name: string | null;
}

interface PagedTickets {
  results: Ticket[];
  count: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TicketStatus, string> = {
  submitted:         "Submitted",
  triaged:           "Triaged",
  in_progress:       "In progress",
  waiting_requester: "Waiting for you",
  waiting_approval:  "Awaiting approval",
  resolved:          "Resolved",
  closed:            "Closed",
  cancelled:         "Cancelled",
};

const STATUS_COLORS: Record<TicketStatus, { bg: string; color: string }> = {
  submitted:         { bg: "#dbeafe", color: "#1e40af" },
  triaged:           { bg: "#ede9fe", color: "#5b21b6" },
  in_progress:       { bg: "#fef3c7", color: "#92400e" },
  waiting_requester: { bg: "#ffedd5", color: "#9a3412" },
  waiting_approval:  { bg: "#f3e8ff", color: "#6b21a8" },
  resolved:          { bg: "#dcfce7", color: "#166534" },
  closed:            { bg: "#e2e8f0", color: "#475569" },
  cancelled:         { bg: "#fee2e2", color: "#991b1b" },
};

const OPEN_STATUSES = new Set<TicketStatus>(["submitted", "triaged", "in_progress", "waiting_requester", "waiting_approval"]);

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const { bg, color } = STATUS_COLORS[status] ?? { bg: "#e2e8f0", color: "#475569" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      background: bg, color, fontSize: ".74rem", fontWeight: 800, whiteSpace: "nowrap",
    }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  value, label, icon, bg, color,
}: { value: number; label: string; icon: React.ReactNode; bg: string; color: string }) {
  return (
    <motion.div variants={fadeUp} style={{
      background: bg, borderRadius: 14, padding: "18px 20px",
      display: "flex", alignItems: "center", gap: 14,
      border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 11, background: color,
        display: "grid", placeItems: "center", flexShrink: 0, opacity: .9,
      }}>
        <span style={{ color: "#fff" }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontSize: "1.7rem", fontWeight: 900, lineHeight: 1, color }}>{value}</div>
        <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--muted)", marginTop: 2 }}>{label}</div>
      </div>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser]         = useState<AuthUser | null>(null);
  const [tickets, setTickets]   = useState<Ticket[]>([]);
  const [count, setCount]       = useState(0);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Auth check
      const meRes = await fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" });
      if (!meRes.ok) { router.replace("/login"); return; }
      const me = await meRes.json() as AuthUser;
      if (!me?.id) { router.replace("/login"); return; }
      if (!cancelled) setUser(me);

      // Fetch tickets (latest 10 for dashboard preview)
      const tRes = await fetch("/api/v1/tickets/?page_size=10", { credentials: "include", cache: "no-store" });
      if (tRes.ok && !cancelled) {
        const data = await tRes.json() as PagedTickets;
        setTickets(Array.isArray(data) ? data : (data.results ?? []));
        setCount(typeof (data as PagedTickets).count === "number" ? (data as PagedTickets).count : (data as unknown as Ticket[]).length);
      }
      if (!cancelled) setLoading(false);
    }
    load().catch(() => { if (!cancelled) { router.replace("/login"); } });
    return () => { cancelled = true; };
  }, [router]);

  if (loading || !user) {
    return (
      <>
        <SiteHeader />
        <main className="shell" style={{ paddingBlock: "60px 80px", display: "flex", justifyContent: "center" }}>
          <Loader2 className="spin" size={32} style={{ color: "var(--brand)" }} aria-label="Loading dashboard" />
        </main>
      </>
    );
  }

  const open      = tickets.filter((t) => OPEN_STATUSES.has(t.status)).length;
  const resolved  = tickets.filter((t) => t.status === "resolved").length;
  const closed    = tickets.filter((t) => t.status === "closed").length;
  const needsAttention = tickets.filter((t) => t.status === "waiting_requester");
  const firstName = user.name?.split(" ")[0] || user.username;

  return (
    <>
      <SiteHeader />
      <motion.main
        className="shell"
        style={{ paddingBlock: "48px 80px" }}
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >

        {/* ── Greeting ── */}
        <motion.div variants={fadeUp} style={{ marginBottom: 36 }}>
          <p className="eyebrow">My helpdesk</p>
          <h1 style={{ fontSize: "clamp(1.8rem,4vw,2.8rem)", letterSpacing: "-.04em", margin: "6px 0 10px" }}>
            Welcome back, {firstName}
          </h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Here&apos;s a summary of your support requests.
          </p>
        </motion.div>

        {/* ── Needs attention banner ── */}
        <AnimatePresence>
          {needsAttention.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{
                background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 14,
                padding: "16px 20px", marginBottom: 28,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Clock size={18} style={{ color: "#c2410c", flexShrink: 0 }} aria-hidden="true" />
                <div>
                  <p style={{ margin: 0, fontWeight: 750, fontSize: ".9rem", color: "#9a3412" }}>
                    {needsAttention.length} ticket{needsAttention.length !== 1 ? "s" : ""} waiting for your response
                  </p>
                  <p style={{ margin: 0, fontSize: ".82rem", color: "#78350f" }}>
                    Reply to keep your requests moving forward.
                  </p>
                </div>
              </div>
              <Link href="/tickets" style={{ color: "#c2410c", fontWeight: 750, fontSize: ".85rem", whiteSpace: "nowrap" }}>
                View tickets →
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Stats ── */}
        <motion.div variants={staggerContainer} style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12, marginBottom: 36,
        }}>
          <StatCard value={count}    label="Total requests"  icon={<TicketCheck size={18} />} bg="#f8fafc" color="#334155" />
          <StatCard value={open}     label="Open"            icon={<Clock       size={18} />} bg="#eff6ff" color="#1d4ed8" />
          <StatCard value={resolved} label="Resolved"        icon={<CheckCircle2 size={18} />} bg="#f0fdf4" color="#15803d" />
          <StatCard value={closed}   label="Closed"          icon={<XCircle     size={18} />} bg="#f8fafc" color="#475569" />
        </motion.div>

        {/* ── Quick actions ── */}
        <motion.div variants={fadeUp} style={{ display: "flex", gap: 12, marginBottom: 36, flexWrap: "wrap" }}>
          <Link href="/tickets/new" className="primary-button" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <PlusCircle size={16} aria-hidden="true" /> New request
          </Link>
          <Link href="/tickets" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "11px 18px", border: "1px solid var(--border)", borderRadius: 10,
            fontWeight: 750, fontSize: ".9rem", color: "var(--foreground)", textDecoration: "none",
            background: "var(--surface)",
          }}>
            View all tickets <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </motion.div>

        {/* ── Recent tickets ── */}
        <motion.div variants={staggerItem}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800 }}>Recent requests</h2>
            {count > 10 && (
              <Link href="/tickets" style={{ color: "var(--brand)", fontWeight: 700, fontSize: ".85rem" }}>
                View all {count} →
              </Link>
            )}
          </div>

          {tickets.length === 0 ? (
            <motion.div variants={fadeUp} style={{
              textAlign: "center", padding: "48px 24px",
              background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 16,
            }}>
              <Inbox size={36} style={{ color: "var(--muted)", marginBottom: 12 }} aria-hidden="true" />
              <p style={{ fontWeight: 700, marginBottom: 6 }}>No requests yet</p>
              <p style={{ color: "var(--muted)", fontSize: ".9rem", marginBottom: 20 }}>
                Submit a support request and it will appear here.
              </p>
              <Link href="/services" className="primary-button" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: ".88rem" }}>
                Browse services <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </motion.div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tickets.map((ticket, i) => (
                <motion.div
                  key={ticket.id}
                  variants={fadeUp}
                  custom={i}
                  style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 12, overflow: "hidden",
                  }}
                >
                  <Link
                    href={`/tickets/${ticket.id}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 16,
                      padding: "14px 18px", textDecoration: "none", color: "inherit",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontFamily: "ui-monospace,monospace", fontSize: ".78rem", color: "var(--brand)", fontWeight: 700 }}>
                          {ticket.reference}
                        </span>
                        {ticket.category_name && (
                          <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>{ticket.category_name}</span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: ".9rem",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ticket.subject}
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: ".78rem", color: "var(--muted)" }}>
                        {formatDate(ticket.created_at)}
                        {ticket.assignee_name && ` · Assigned to ${ticket.assignee_name}`}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                      <StatusBadge status={ticket.status} />
                      <ArrowRight size={14} style={{ color: "var(--muted)" }} aria-hidden="true" />
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* ── Help links ── */}
        <motion.div variants={fadeUp} style={{
          marginTop: 40, display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12,
        }}>
          {[
            { href: "/help",    label: "Browse help guides" },
            { href: "/software",label: "Software catalogue" },
            { href: "/contact", label: "Contact IT & NOC" },
          ].map(({ href, label }) => (
            <Link key={href} href={href} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 18px", background: "var(--brand-soft)", borderRadius: 12,
              fontWeight: 700, fontSize: ".88rem", color: "var(--brand)", textDecoration: "none",
            }}>
              {label} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ))}
        </motion.div>

      </motion.main>
    </>
  );
}
