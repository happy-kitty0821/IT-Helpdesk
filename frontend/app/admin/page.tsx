"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle, ArrowRight, BookOpen, Boxes, Calendar,
  CheckCircle2, CircleDot, Clock, FileSpreadsheet,
  Inbox, Loader2, Settings, ShieldAlert, Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { adminGet, type AdminSummary } from "@/lib/admin-api";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/animations";

// ── Status colours (mirrors admin/tickets) ────────────────────────────────────

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
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted", triaged: "Triaged", in_progress: "In Progress",
  waiting_requester: "Waiting", waiting_approval: "Awaiting Approval",
  resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};
const PRIORITY_COLORS: Record<string, { text: string; bg: string }> = {
  p1: { text: "#991b1b", bg: "#fee2e2" },
  p2: { text: "#92400e", bg: "#fef3c7" },
  p3: { text: "#475569", bg: "#e2e8f0" },
  p4: { text: "#166534", bg: "#dcfce7" },
};

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, sub, href, accent, warn,
}: {
  icon: React.ReactNode; label: string; value: number;
  sub?: string; href?: string; accent?: string; warn?: boolean;
}) {
  const content = (
    <div className={`dash-metric${warn ? " dash-metric--warn" : ""}`}
      style={accent ? { borderLeftColor: accent } : undefined}>
      <div className="dash-metric-icon" style={accent ? { background: accent + "18", color: accent } : undefined}>
        {icon}
      </div>
      <div className="dash-metric-body">
        <span className="dash-metric-label">{label}</span>
        <span className="dash-metric-value" style={accent ? { color: accent } : undefined}>
          {value.toLocaleString()}
        </span>
        {sub && <span className="dash-metric-sub">{sub}</span>}
      </div>
      {href && <ArrowRight size={15} className="dash-metric-arrow" aria-hidden="true" />}
    </div>
  );
  if (href) return <Link href={href} style={{ textDecoration: "none" }}>{content}</Link>;
  return content;
}

// ── Quick action card ─────────────────────────────────────────────────────────

function ActionCard({
  href, icon, title, desc,
}: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link href={href} className="dash-action">
      <div className="dash-action-icon">{icon}</div>
      <div>
        <p className="dash-action-title">{title}</p>
        <p className="dash-action-desc">{desc}</p>
      </div>
      <ArrowRight size={15} className="dash-action-arrow" aria-hidden="true" />
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminOverview() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGet<AdminSummary>("summary")
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="admin-content">

      {/* ── Header ── */}
      <header className="admin-heading" style={{ marginBottom: 28 }}>
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Dashboard</h1>
          <p>Live overview of support activity, content, and user accounts.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/admin/tickets" className="primary-button"
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: ".88rem" }}>
            <CircleDot size={15} aria-hidden="true" /> View queue
          </Link>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {error && (
          <motion.p key="err" className="admin-error" role="alert"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ marginBottom: 24 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Loader2 size={32} className="spin" style={{ color: "var(--brand)" }} aria-label="Loading" />
        </div>
      )}

      {!loading && summary && (
        <motion.div variants={staggerContainer} initial="hidden" animate="show"
          style={{ display: "flex", flexDirection: "column", gap: 28 }}>

          {/* ── Alert banners ── */}
          {(summary.unassigned_open > 0 || summary.pending_review > 0 || summary.waiting_requester > 0) && (
            <motion.div variants={fadeUp} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {summary.unassigned_open > 0 && (
                <div className="dash-alert dash-alert--warn">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    <strong>{summary.unassigned_open}</strong> open ticket{summary.unassigned_open !== 1 ? "s" : ""} {summary.unassigned_open !== 1 ? "are" : "is"} unassigned and need attention.
                  </span>
                  <Link href="/admin/tickets?assignee=unassigned" className="dash-alert-link">
                    Assign now →
                  </Link>
                </div>
              )}
              {summary.pending_review > 0 && (
                <div className="dash-alert dash-alert--info">
                  <Inbox size={16} aria-hidden="true" />
                  <span>
                    <strong>{summary.pending_review}</strong> ticket{summary.pending_review !== 1 ? "s" : ""} submitted and waiting for triage.
                  </span>
                  <Link href="/admin/tickets?status=submitted" className="dash-alert-link">
                    Review →
                  </Link>
                </div>
              )}
              {summary.waiting_requester > 0 && (
                <div className="dash-alert dash-alert--muted">
                  <Clock size={16} aria-hidden="true" />
                  <span>
                    <strong>{summary.waiting_requester}</strong> ticket{summary.waiting_requester !== 1 ? "s" : ""} waiting for requester response.
                  </span>
                  <Link href="/admin/tickets?status=waiting_requester" className="dash-alert-link">
                    View →
                  </Link>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Ticket metrics ── */}
          <motion.section variants={staggerItem}>
            <h2 className="dash-section-heading">
              <CircleDot size={16} aria-hidden="true" /> Tickets
            </h2>
            <div className="dash-metrics-grid">
              <MetricCard icon={<CircleDot size={20} />} label="Open tickets"
                value={summary.open_tickets} sub={`${summary.tickets.toLocaleString()} total`}
                href="/admin/tickets" accent="#234395" />
              <MetricCard icon={<Inbox size={20} />} label="Awaiting triage"
                value={summary.pending_review}
                href="/admin/tickets" accent="#7c3aed"
                warn={summary.pending_review > 5} />
              <MetricCard icon={<AlertTriangle size={20} />} label="Unassigned"
                value={summary.unassigned_open}
                href="/admin/tickets" accent="#dc2626"
                warn={summary.unassigned_open > 0} />
              <MetricCard icon={<CheckCircle2 size={20} />} label="Resolved (7 days)"
                value={summary.resolved_7d} accent="#16a34a" />
              <MetricCard icon={<Calendar size={20} />} label="Submitted today"
                value={summary.submitted_today} accent="#0369a1" />
              <MetricCard icon={<Clock size={20} />} label="Waiting for requester"
                value={summary.waiting_requester} accent="#b45309" />
            </div>
          </motion.section>

          {/* ── People & content metrics ── */}
          <motion.section variants={staggerItem}>
            <h2 className="dash-section-heading">
              <Users size={16} aria-hidden="true" /> People &amp; content
            </h2>
            <div className="dash-metrics-grid">
              <MetricCard icon={<Users size={20} />} label="Active users"
                value={summary.users} href="/admin/users" accent="#234395" />
              {summary.suspended_users > 0 && (
                <MetricCard icon={<ShieldAlert size={20} />} label="Suspended accounts"
                  value={summary.suspended_users} href="/admin/users"
                  accent="#dc2626" warn />
              )}
              <MetricCard icon={<BookOpen size={20} />} label="Published guides"
                value={summary.published_guides} sub={`${summary.guides} total`}
                href="/admin/guides" accent="#0891b2" />
              <MetricCard icon={<Boxes size={20} />} label="Active software"
                value={summary.active_software} sub={`${summary.software} total`}
                href="/admin/software" accent="#7c3aed" />
            </div>
          </motion.section>

          {/* ── Recent tickets ── */}
          {summary.recent_tickets.length > 0 && (
            <motion.section variants={staggerItem}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h2 className="dash-section-heading" style={{ margin: 0 }}>
                  <Clock size={16} aria-hidden="true" /> Recent tickets
                </h2>
                <Link href="/admin/tickets"
                  style={{ fontSize: ".82rem", color: "var(--brand)", fontWeight: 700 }}>
                  View all →
                </Link>
              </div>
              <div className="dash-recent-tickets">
                {summary.recent_tickets.map((t) => {
                  const sc = STATUS_COLORS[t.status] ?? { text: "#475569", bg: "#e2e8f0" };
                  const pc = PRIORITY_COLORS[t.priority] ?? { text: "#475569", bg: "#e2e8f0" };
                  return (
                    <Link key={t.id} href={`/admin/tickets`} className="dash-recent-row">
                      <div className="dash-recent-ref">{t.reference}</div>
                      <div className="dash-recent-subject">{t.subject}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span className="dash-badge" style={{ background: sc.bg, color: sc.text }}>
                          {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                        <span className="dash-badge" style={{ background: pc.bg, color: pc.text }}>
                          {t.priority?.toUpperCase()}
                        </span>
                      </div>
                      <div className="dash-recent-meta">
                        <span>{t.requester_name ?? "—"}</span>
                        <span>{t.category_name ?? "—"}</span>
                        <span>{t.elapsed}</span>
                      </div>
                      <div className="dash-recent-assignee">
                        {t.assignee_name
                          ? <span>{t.assignee_name}</span>
                          : <span className="dash-recent-unassigned">Unassigned</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </motion.section>
          )}

          {/* ── Quick actions ── */}
          <motion.section variants={staggerItem}>
            <h2 className="dash-section-heading">
              <Settings size={16} aria-hidden="true" /> Quick actions
            </h2>
            <div className="dash-actions-grid">
              <ActionCard href="/admin/tickets"    icon={<CircleDot     size={20} />} title="Ticket queue"         desc="Triage, assign, and manage all support requests." />
              <ActionCard href="/admin/users"      icon={<Users         size={20} />} title="User management"     desc="Review accounts, roles, and suspension status." />
              <ActionCard href="/admin/guides"     icon={<BookOpen      size={20} />} title="Help guides"         desc="Publish and manage PDF guides for students." />
              <ActionCard href="/admin/software"   icon={<Boxes         size={20} />} title="Software catalogue"  desc="Manage approved downloads and installation guides." />
              <ActionCard href="/admin/notifications" icon={<FileSpreadsheet size={20} />} title="Notifications"  desc="Configure email templates and delivery channels." />
              <ActionCard href="/admin/settings"   icon={<Settings      size={20} />} title="Settings"           desc="Ticket form, contact info, and site configuration." />
            </div>
          </motion.section>

        </motion.div>
      )}
    </div>
  );
}
