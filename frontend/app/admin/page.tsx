"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle, ArrowRight, BookOpen, Boxes, Calendar,
  CheckCircle2, CircleDot, Clock, FileSpreadsheet,
  Inbox, Loader2, RefreshCw, Settings, ShieldAlert,
  TrendingUp, Users, Wifi, WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminGet, type AdminSummary } from "@/lib/admin-api";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/animations";

// ── Colour maps ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { text: string; bg: string; bar: string }> = {
  submitted:         { text: "#1e40af", bg: "#dbeafe", bar: "#3b82f6" },
  triaged:           { text: "#5b21b6", bg: "#ede9fe", bar: "#8b5cf6" },
  in_progress:       { text: "#92400e", bg: "#fef3c7", bar: "#f59e0b" },
  waiting_requester: { text: "#9a3412", bg: "#ffedd5", bar: "#f97316" },
  waiting_approval:  { text: "#6b21a8", bg: "#f3e8ff", bar: "#a855f7" },
  resolved:          { text: "#166534", bg: "#dcfce7", bar: "#22c55e" },
  closed:            { text: "#475569", bg: "#e2e8f0", bar: "#64748b" },
  cancelled:         { text: "#991b1b", bg: "#fee2e2", bar: "#ef4444" },
};
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted", triaged: "Triaged", in_progress: "In Progress",
  waiting_requester: "Waiting", waiting_approval: "Approval",
  resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};
const PRIORITY_COLORS: Record<string, { text: string; bg: string; bar: string }> = {
  p1: { text: "#991b1b", bg: "#fee2e2", bar: "#ef4444" },
  p2: { text: "#92400e", bg: "#fef3c7", bar: "#f97316" },
  p3: { text: "#475569", bg: "#e2e8f0", bar: "#94a3b8" },
  p4: { text: "#166534", bg: "#dcfce7", bar: "#22c55e" },
};
const PRIORITY_LABELS: Record<string, string> = {
  p1: "Critical", p2: "High", p3: "Normal", p4: "Low",
};

// ── SVG Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({
  data, color = "#234395", height = 40, filled = false,
}: {
  data: number[]; color?: string; height?: number; filled?: boolean;
}) {
  if (!data || data.length < 2) return null;
  const w = 120, h = height;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - (v / max) * (h - 4) - 2,
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fill = filled
    ? `${path} L${pts[pts.length - 1].x},${h} L${pts[0].x},${h} Z`
    : "";

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}>
      {filled && (
        <defs>
          <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
      )}
      {filled && (
        <path d={fill} fill={`url(#sg-${color.replace("#", "")})`} />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y}
        r="3" fill={color} />
    </svg>
  );
}

// ── Donut chart ───────────────────────────────────────────────────────────────

function DonutChart({
  slices, size = 80,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={(size / 2) - 6}
        fill="none" stroke="#e2e8f0" strokeWidth="10" />
    </svg>
  );

  const r = (size / 2) - 8;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  const paths = slices.filter(s => s.value > 0).map((s) => {
    const pct    = s.value / total;
    const offset = circumference * (1 - cumulative);
    const dash   = circumference * pct;
    cumulative  += pct;
    return { ...s, dash, offset };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="10" />
      {paths.map((p) => (
        <circle key={p.label} cx={cx} cy={cy} r={r}
          fill="none" stroke={p.color} strokeWidth="10"
          strokeDasharray={`${p.dash} ${circumference - p.dash}`}
          strokeDashoffset={p.offset}
          strokeLinecap="butt"
          style={{ transition: "stroke-dasharray 600ms ease" }} />
      ))}
    </svg>
  );
}

// ── Mini bar chart ────────────────────────────────────────────────────────────

function MiniBarChart({
  bars, height = 56,
}: {
  bars: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const max = Math.max(...bars.map(b => b.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height }}>
      {bars.map((b) => (
        <div key={b.label} title={`${b.label}: ${b.value}`}
          style={{
            flex: 1, background: b.color, borderRadius: 4,
            height: `${Math.max((b.value / max) * 100, b.value > 0 ? 8 : 2)}%`,
            transition: "height 500ms ease",
            minHeight: 2,
          }}
          aria-label={`${b.label}: ${b.value}`}
        />
      ))}
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, sub, href, accent, warn, spark,
}: {
  icon: React.ReactNode; label: string; value: number;
  sub?: string; href?: string; accent?: string; warn?: boolean;
  spark?: number[];
}) {
  const inner = (
    <div className={`dash-metric${warn ? " dash-metric--warn" : ""}`}
      style={accent ? { borderTopColor: accent } : undefined}>
      <div className="dash-metric-top">
        <div className="dash-metric-icon"
          style={accent ? { background: accent + "15", color: accent } : undefined}>
          {icon}
        </div>
        {spark && spark.length > 1 && (
          <Sparkline data={spark} color={accent ?? "#94a3b8"} height={32} filled />
        )}
      </div>
      <div className="dash-metric-value"
        style={accent ? { color: accent } : undefined}>
        {value.toLocaleString()}
      </div>
      <div className="dash-metric-label">{label}</div>
      {sub && <div className="dash-metric-sub">{sub}</div>}
    </div>
  );
  if (href) return <Link href={href} style={{ textDecoration: "none" }}>{inner}</Link>;
  return inner;
}

// ── Quick action card ─────────────────────────────────────────────────────────

function ActionCard({ href, icon, title, desc }: {
  href: string; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <Link href={href} className="dash-action">
      <div className="dash-action-icon">{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="dash-action-title">{title}</p>
        <p className="dash-action-desc">{desc}</p>
      </div>
      <ArrowRight size={15} className="dash-action-arrow" aria-hidden="true" />
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminOverview() {
  const [summary,   setSummary]   = useState<AdminSummary | null>(null);
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(true);
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const applyUpdate = useCallback((data: AdminSummary) => {
    setSummary(data);
    setLastUpdated(new Date());
    setLoading(false);
    setError("");
  }, []);

  // ── Initial REST fetch (fast first paint) ─────────────────────────────────
  useEffect(() => {
    adminGet<AdminSummary>("summary")
      .then(applyUpdate)
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [applyUpdate]);

  // ── SSE stream (live updates every 15 s) ──────────────────────────────────
  useEffect(() => {
    let retryDelay = 3000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      const es = new EventSource("/api/v1/admin/summary/stream/", { withCredentials: true });
      esRef.current = es;

      es.addEventListener("summary_update", (e: MessageEvent) => {
        retryDelay = 3000;
        try {
          const data = JSON.parse(e.data) as AdminSummary;
          applyUpdate(data);
          setConnected(true);
        } catch { /* ignore parse errors */ }
      });

      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!unmounted) {
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 60_000);
            connect();
          }, retryDelay);
        }
      };
    }

    connect();
    return () => {
      unmounted = true;
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
    };
  }, [applyUpdate]);

  // ── Derive chart arrays ───────────────────────────────────────────────────

  const dailySpark    = summary?.chart_daily?.map(d => d.count) ?? [];
  const resolvedSpark = summary?.chart_resolved?.map(d => d.count) ?? [];

  const statusSlices = (summary?.chart_status ?? []).map(s => ({
    label: STATUS_LABELS[s.status] ?? s.status,
    value: s.count,
    color: STATUS_COLORS[s.status]?.bar ?? "#94a3b8",
  }));

  const priorityBars = ["p1", "p2", "p3", "p4"].map(p => {
    const found = (summary?.chart_priority ?? []).find(x => x.priority === p);
    return {
      label: PRIORITY_LABELS[p],
      value: found?.count ?? 0,
      color: PRIORITY_COLORS[p]?.bar ?? "#94a3b8",
    };
  });

  const statusTotal = statusSlices.reduce((s, x) => s + x.value, 0);

  return (
    <div className="admin-content">

      {/* ── Header ── */}
      <header className="admin-heading" style={{ marginBottom: 24 }}>
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Dashboard</h1>
          <p>Live overview of support activity, content, and user accounts.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Live indicator */}
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: ".76rem", fontWeight: 700, borderRadius: 999,
            padding: "5px 11px",
            background: connected ? "#f0fdf4" : "#f8fafc",
            color:      connected ? "#15803d" : "#94a3b8",
            border:     `1px solid ${connected ? "#bbf7d0" : "#e2e8f0"}`,
            transition: "all 300ms",
          }}>
            {connected
              ? <Wifi size={12} aria-hidden="true" />
              : <WifiOff size={12} aria-hidden="true" />}
            {connected ? "Live" : "Connecting…"}
          </span>
          {lastUpdated && (
            <span style={{ fontSize: ".75rem", color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
              <RefreshCw size={11} aria-hidden="true" />
              {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
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
            style={{ marginBottom: 20 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Loader2 size={32} className="spin" style={{ color: "var(--brand)" }} aria-label="Loading dashboard" />
        </div>
      )}

      {!loading && summary && (
        <motion.div variants={staggerContainer} initial="hidden" animate="show"
          style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── Alert banners ── */}
          {(summary.unassigned_open > 0 || summary.pending_review > 0 || summary.waiting_requester > 0) && (
            <motion.div variants={fadeUp} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {summary.unassigned_open > 0 && (
                <div className="dash-alert dash-alert--warn">
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span><strong>{summary.unassigned_open}</strong> open ticket{summary.unassigned_open !== 1 ? "s" : ""} unassigned</span>
                  <Link href="/admin/tickets" className="dash-alert-link">Assign now →</Link>
                </div>
              )}
              {summary.pending_review > 0 && (
                <div className="dash-alert dash-alert--info">
                  <Inbox size={15} aria-hidden="true" />
                  <span><strong>{summary.pending_review}</strong> ticket{summary.pending_review !== 1 ? "s" : ""} awaiting triage</span>
                  <Link href="/admin/tickets" className="dash-alert-link">Review →</Link>
                </div>
              )}
              {summary.waiting_requester > 0 && (
                <div className="dash-alert dash-alert--muted">
                  <Clock size={15} aria-hidden="true" />
                  <span><strong>{summary.waiting_requester}</strong> ticket{summary.waiting_requester !== 1 ? "s" : ""} waiting for requester</span>
                  <Link href="/admin/tickets" className="dash-alert-link">View →</Link>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Ticket metric cards ── */}
          <motion.section variants={staggerItem}>
            <h2 className="dash-section-heading">
              <CircleDot size={14} aria-hidden="true" /> Tickets
            </h2>
            <div className="dash-metrics-grid">
              <MetricCard icon={<CircleDot size={18} />} label="Open tickets"
                value={summary.open_tickets} sub={`${summary.tickets.toLocaleString()} total`}
                href="/admin/tickets" accent="#234395" spark={dailySpark} />
              <MetricCard icon={<Inbox size={18} />} label="Awaiting triage"
                value={summary.pending_review} accent="#7c3aed"
                warn={summary.pending_review > 5} href="/admin/tickets" />
              <MetricCard icon={<AlertTriangle size={18} />} label="Unassigned"
                value={summary.unassigned_open} accent="#dc2626"
                warn={summary.unassigned_open > 0} href="/admin/tickets" />
              <MetricCard icon={<CheckCircle2 size={18} />} label="Resolved (7 days)"
                value={summary.resolved_7d} accent="#16a34a" spark={resolvedSpark} />
              <MetricCard icon={<Calendar size={18} />} label="Submitted today"
                value={summary.submitted_today} accent="#0369a1" />
              <MetricCard icon={<Clock size={18} />} label="Waiting (requester)"
                value={summary.waiting_requester} accent="#b45309" />
            </div>
          </motion.section>

          {/* ── Charts row ── */}
          <motion.section variants={staggerItem} className="dash-charts-row">

            {/* Volume chart — 14-day sparkline */}
            <div className="dash-chart-card">
              <div className="dash-chart-header">
                <div>
                  <p className="dash-chart-title">Ticket volume</p>
                  <p className="dash-chart-sub">New tickets — last 14 days</p>
                </div>
                <TrendingUp size={18} style={{ color: "#234395" }} aria-hidden="true" />
              </div>
              <div className="dash-line-chart" aria-label="Ticket volume chart">
                {(() => {
                  const data  = summary.chart_daily ?? [];
                  if (data.length < 2) return <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8 }} />;
                  const max   = Math.max(...data.map(d => d.count), 1);
                  const W = 100, H = 80;
                  const pts = data.map((d, i) => ({
                    x: (i / (data.length - 1)) * W,
                    y: H - (d.count / max) * (H - 8) - 4,
                    ...d,
                  }));
                  const linePath = pts.map((p, i) =>
                    `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`
                  ).join(" ");
                  const areaPath = linePath +
                    ` L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;

                  return (
                    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
                      style={{ width: "100%", height: H }} aria-hidden="true">
                      <defs>
                        <linearGradient id="vol-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#234395" stopOpacity="0.2" />
                          <stop offset="100%" stopColor="#234395" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill="url(#vol-grad)" />
                      <path d={linePath} fill="none" stroke="#234395"
                        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke" />
                      {pts.map((p) => (
                        <circle key={p.date} cx={p.x} cy={p.y} r="2"
                          fill="#234395" vectorEffect="non-scaling-stroke">
                          <title>{`${p.date}: ${p.count}`}</title>
                        </circle>
                      ))}
                    </svg>
                  );
                })()}
                {/* X-axis labels (first, middle, last) */}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: ".68rem", color: "#94a3b8" }}>
                  <span>{summary.chart_daily?.[0]?.date.slice(5)}</span>
                  <span>{summary.chart_daily?.[7]?.date.slice(5)}</span>
                  <span>{summary.chart_daily?.[(summary.chart_daily?.length ?? 1) - 1]?.date.slice(5)}</span>
                </div>
              </div>
            </div>

            {/* Status donut */}
            <div className="dash-chart-card">
              <div className="dash-chart-header">
                <div>
                  <p className="dash-chart-title">Status breakdown</p>
                  <p className="dash-chart-sub">Open tickets by status</p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <DonutChart slices={statusSlices} size={96} />
                  <div style={{
                    position: "absolute", inset: 0, display: "grid",
                    placeItems: "center", fontSize: ".78rem", fontWeight: 800,
                    color: "#334155", lineHeight: 1.2, textAlign: "center",
                  }}>
                    <span>{statusTotal}<br /><span style={{ fontWeight: 500, fontSize: ".65rem", color: "#94a3b8" }}>open</span></span>
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  {statusSlices.filter(s => s.value > 0).slice(0, 5).map(s => (
                    <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: ".75rem" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} aria-hidden="true" />
                      <span style={{ flex: 1, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                      <strong style={{ color: "#1e293b" }}>{s.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Priority bar chart */}
            <div className="dash-chart-card">
              <div className="dash-chart-header">
                <div>
                  <p className="dash-chart-title">Priority distribution</p>
                  <p className="dash-chart-sub">Open tickets by priority</p>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 14 }}>
                <MiniBarChart bars={priorityBars} height={64} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {priorityBars.map(b => (
                    <span key={b.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: ".72rem", color: "#475569" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color }} aria-hidden="true" />
                      {b.label}: <strong style={{ color: "#1e293b" }}>{b.value}</strong>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Resolution trend */}
            <div className="dash-chart-card">
              <div className="dash-chart-header">
                <div>
                  <p className="dash-chart-title">Resolution trend</p>
                  <p className="dash-chart-sub">Resolved per day — 14 days</p>
                </div>
                <CheckCircle2 size={18} style={{ color: "#16a34a" }} aria-hidden="true" />
              </div>
              <div className="dash-line-chart">
                {(() => {
                  const data = summary.chart_resolved ?? [];
                  if (data.length < 2) return <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8 }} />;
                  const max  = Math.max(...data.map(d => d.count), 1);
                  const W = 100, H = 80;
                  const pts = data.map((d, i) => ({
                    x: (i / (data.length - 1)) * W,
                    y: H - (d.count / max) * (H - 8) - 4,
                    ...d,
                  }));
                  const linePath = pts.map((p, i) =>
                    `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`
                  ).join(" ");
                  const areaPath = linePath +
                    ` L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;

                  return (
                    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
                      style={{ width: "100%", height: H }} aria-hidden="true">
                      <defs>
                        <linearGradient id="res-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#16a34a" stopOpacity="0.2" />
                          <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill="url(#res-grad)" />
                      <path d={linePath} fill="none" stroke="#16a34a"
                        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke" />
                      {pts.map((p) => (
                        <circle key={p.date} cx={p.x} cy={p.y} r="2"
                          fill="#16a34a" vectorEffect="non-scaling-stroke">
                          <title>{`${p.date}: ${p.count}`}</title>
                        </circle>
                      ))}
                    </svg>
                  );
                })()}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: ".68rem", color: "#94a3b8" }}>
                  <span>{summary.chart_resolved?.[0]?.date.slice(5)}</span>
                  <span>{summary.chart_resolved?.[7]?.date.slice(5)}</span>
                  <span>{summary.chart_resolved?.[(summary.chart_resolved?.length ?? 1) - 1]?.date.slice(5)}</span>
                </div>
              </div>
            </div>

          </motion.section>

          {/* ── People & content cards ── */}
          <motion.section variants={staggerItem}>
            <h2 className="dash-section-heading">
              <Users size={14} aria-hidden="true" /> People &amp; content
            </h2>
            <div className="dash-metrics-grid">
              <MetricCard icon={<Users size={18} />} label="Active users"
                value={summary.users} href="/admin/users" accent="#234395" />
              {summary.suspended_users > 0 && (
                <MetricCard icon={<ShieldAlert size={18} />} label="Suspended"
                  value={summary.suspended_users} accent="#dc2626" warn href="/admin/users" />
              )}
              <MetricCard icon={<BookOpen size={18} />} label="Published guides"
                value={summary.published_guides} sub={`${summary.guides} total`}
                href="/admin/guides" accent="#0891b2" />
              <MetricCard icon={<Boxes size={18} />} label="Active software"
                value={summary.active_software} sub={`${summary.software} total`}
                href="/admin/software" accent="#7c3aed" />
            </div>
          </motion.section>

          {/* ── Recent tickets ── */}
          {(summary.recent_tickets?.length ?? 0) > 0 && (
            <motion.section variants={staggerItem}>
              <div className="dash-section-row">
                <h2 className="dash-section-heading" style={{ margin: 0 }}>
                  <Clock size={14} aria-hidden="true" /> Recent tickets
                </h2>
                <Link href="/admin/tickets" style={{ fontSize: ".82rem", color: "var(--brand)", fontWeight: 700 }}>
                  View all →
                </Link>
              </div>
              <div className="dash-recent-tickets">
                {summary.recent_tickets.map((t) => {
                  const sc = STATUS_COLORS[t.status]  ?? { text: "#475569", bg: "#e2e8f0" };
                  const pc = PRIORITY_COLORS[t.priority] ?? { text: "#475569", bg: "#e2e8f0" };
                  return (
                    <Link key={t.id} href="/admin/tickets" className="dash-recent-row">
                      <span className="dash-recent-ref">{t.reference}</span>
                      <span className="dash-recent-subject">{t.subject}</span>
                      <span style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                        <span className="dash-badge" style={{ background: sc.bg, color: sc.text }}>
                          {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                        <span className="dash-badge" style={{ background: pc.bg, color: pc.text }}>
                          {t.priority?.toUpperCase()}
                        </span>
                      </span>
                      <span className="dash-recent-meta">
                        <span>{t.requester_name ?? "—"}</span>
                        <span>{t.category_name ?? "—"}</span>
                        <span>{t.elapsed}</span>
                      </span>
                      <span className={t.assignee_name ? "dash-recent-assignee" : "dash-recent-unassigned"}>
                        {t.assignee_name ?? "Unassigned"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </motion.section>
          )}

          {/* ── Quick actions ── */}
          <motion.section variants={staggerItem}>
            <h2 className="dash-section-heading">
              <Settings size={14} aria-hidden="true" /> Quick actions
            </h2>
            <div className="dash-actions-grid">
              <ActionCard href="/admin/tickets"       icon={<CircleDot       size={20} />} title="Ticket queue"        desc="Triage, assign, and manage all support requests." />
              <ActionCard href="/admin/users"         icon={<Users           size={20} />} title="User management"    desc="Review accounts, roles, and suspension status." />
              <ActionCard href="/admin/guides"        icon={<BookOpen        size={20} />} title="Help guides"        desc="Publish and manage PDF guides for students." />
              <ActionCard href="/admin/software"      icon={<Boxes           size={20} />} title="Software catalogue" desc="Manage approved downloads and guides." />
              <ActionCard href="/admin/notifications" icon={<FileSpreadsheet size={20} />} title="Notifications"      desc="Configure email templates and channels." />
              <ActionCard href="/admin/settings"      icon={<Settings        size={20} />} title="Settings"           desc="Ticket form, contact info, site config." />
            </div>
          </motion.section>

        </motion.div>
      )}
    </div>
  );
}
