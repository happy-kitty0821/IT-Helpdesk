"use client";

import { motion } from "motion/react";
import {
  CheckCircle2, CircleDot, Clock, Download,
  FileSpreadsheet, Loader2, RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { adminGet, type AdminSummary } from "@/lib/admin-api";

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
}) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
      padding: "18px 20px", borderTop: `3px solid ${accent}`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: accent }}>
        {icon}
        <span style={{ fontSize: ".78rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#1e293b", lineHeight: 1.1 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div style={{ fontSize: ".78rem", color: "#94a3b8" }}>{sub}</div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  // ── KPI state ─────────────────────────────────────────────────────────────
  const [summary,        setSummary]        = useState<AdminSummary | null>(null);
  const [kpiLoading,     setKpiLoading]     = useState(true);
  const [kpiError,       setKpiError]       = useState("");

  // ── Export filter state ───────────────────────────────────────────────────
  const [fromDate,       setFromDate]       = useState("");
  const [toDate,         setToDate]         = useState("");
  const [statusFilter,   setStatusFilter]   = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");

  // ── Export state ──────────────────────────────────────────────────────────
  const [exporting,      setExporting]      = useState(false);
  const [exportError,    setExportError]    = useState("");

  // ── Load KPIs ─────────────────────────────────────────────────────────────
  function loadKpis() {
    setKpiLoading(true);
    setKpiError("");
    adminGet<AdminSummary>("summary")
      .then((d) => { setSummary(d); setKpiLoading(false); })
      .catch((e: Error) => { setKpiError(e.message); setKpiLoading(false); });
  }

  useEffect(() => { loadKpis(); }, []);

  // ── Build export URL ──────────────────────────────────────────────────────
  function buildExportUrl() {
    const params = new URLSearchParams();
    if (fromDate)       params.set("from",     fromDate);
    if (toDate)         params.set("to",       toDate);
    if (statusFilter)   params.set("status",   statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    const qs = params.toString();
    return `/api/v1/tickets/export/${qs ? "?" + qs : ""}`;
  }

  // ── Download handler ──────────────────────────────────────────────────────
  async function handleDownload() {
    setExporting(true);
    setExportError("");
    try {
      const res = await fetch(buildExportUrl(), { credentials: "include" });
      if (!res.ok) {
        const msg = res.status === 403
          ? "You don't have permission to export reports."
          : `Export failed (HTTP ${res.status}). Try again or contact support.`;
        setExportError(msg);
        return;
      }
      // Stream the blob and trigger a browser download
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const now  = new Date().toISOString().slice(0, 10);
      a.href     = url;
      a.download = `iic-helpdesk-report-${now}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Network error. Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  // ── Derived KPI values ────────────────────────────────────────────────────
  const avgRes = (() => {
    if (!summary) return "—";
    // Rough estimate: resolved_7d * 7 days spread. Backend doesn't expose avg
    // resolution time in summary — show resolved count as proxy.
    return summary.resolved_7d.toLocaleString();
  })();

  return (
    <div className="admin-content">

      {/* ── Header ── */}
      <header className="admin-heading" style={{ marginBottom: 24 }}>
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Reports</h1>
          <p>Export ticket data and view current queue metrics.</p>
        </div>
        <FileSpreadsheet size={28} style={{ color: "#234395", opacity: .5 }} aria-hidden="true" />
      </header>

      {/* ── KPI cards ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: ".9rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Live queue snapshot
          </h2>
          <button
            onClick={loadKpis}
            disabled={kpiLoading}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              border: "1px solid #dbe2ee", borderRadius: 8,
              padding: "6px 13px", background: "#f8fafc",
              cursor: "pointer", fontSize: ".82rem", fontWeight: 700, color: "#374151",
            }}
          >
            <RefreshCw size={13} style={{ animation: kpiLoading ? "spin 1s linear infinite" : "none" }} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {kpiError && (
          <p style={{ color: "#dc2626", fontSize: ".85rem", marginBottom: 12 }}>{kpiError}</p>
        )}

        {kpiLoading && !summary ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
            <Loader2 size={28} className="spin" style={{ color: "var(--brand)" }} aria-label="Loading metrics" />
          </div>
        ) : summary ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}
          >
            <KpiCard icon={<CircleDot size={16} />}   label="Open tickets"      value={summary.open_tickets}    sub={`${summary.tickets.toLocaleString()} total ever`} accent="#234395" />
            <KpiCard icon={<CircleDot size={16} />}   label="Awaiting triage"   value={summary.pending_review}  sub="Need staff review"          accent="#7c3aed" />
            <KpiCard icon={<CircleDot size={16} />}   label="Unassigned"        value={summary.unassigned_open} sub="No agent assigned"           accent="#dc2626" />
            <KpiCard icon={<CheckCircle2 size={16} />} label="Resolved (7 days)" value={summary.resolved_7d}    sub="Last 7 calendar days"        accent="#16a34a" />
            <KpiCard icon={<CircleDot size={16} />}   label="Submitted today"   value={summary.submitted_today} sub="Since midnight"               accent="#0369a1" />
            <KpiCard icon={<Clock size={16} />}       label="Waiting (requester)" value={summary.waiting_requester} sub="Pending requester reply"  accent="#b45309" />
          </motion.div>
        ) : null}
      </section>

      {/* ── Export ── */}
      <section>
        <h2 style={{ margin: "0 0 4px", fontSize: ".9rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".06em" }}>
          Export ticket data
        </h2>
        <p style={{ margin: "0 0 18px", fontSize: ".84rem", color: "#64748b", lineHeight: 1.6 }}>
          Downloads a 4-sheet Excel workbook — Ticket Register, Analytics Summary,
          Ticket Audit Trail, and Role Audit Events. All filters are optional;
          leaving them blank exports all tickets.
        </p>

        {/* Filter row */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 14, marginBottom: 20,
          background: "#f8fafc", border: "1px solid #e2e8f0",
          borderRadius: 12, padding: "18px 20px",
        }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            From date
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 10px", fontSize: ".88rem", background: "#fff" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            To date
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 10px", fontSize: ".88rem", background: "#fff" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 10px", fontSize: ".88rem", background: "#fff" }}
            >
              <option value="">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="triaged">Triaged</option>
              <option value="in_progress">In Progress</option>
              <option value="waiting_requester">Waiting (Requester)</option>
              <option value="waiting_approval">Waiting (Approval)</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ".82rem", fontWeight: 700, color: "#374151" }}>
            Priority
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              style={{ border: "1px solid #94a3b8", borderRadius: 8, padding: "8px 10px", fontSize: ".88rem", background: "#fff" }}
            >
              <option value="">All priorities</option>
              <option value="p1">Critical (P1)</option>
              <option value="p2">High (P2)</option>
              <option value="p3">Normal (P3)</option>
              <option value="p4">Low (P4)</option>
            </select>
          </label>
        </div>

        {exportError && (
          <p style={{ color: "#dc2626", fontSize: ".85rem", margin: "0 0 12px" }}>{exportError}</p>
        )}

        <button
          className="primary-button"
          onClick={handleDownload}
          disabled={exporting}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 22px" }}
        >
          {exporting
            ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Generating…</>
            : <><Download size={16} aria-hidden="true" /> Download Excel report</>}
        </button>

        <p style={{ marginTop: 10, fontSize: ".75rem", color: "#94a3b8", lineHeight: 1.6 }}>
          The export may take a few seconds for large date ranges.
          The file opens directly in Excel or Google Sheets.
        </p>
      </section>
    </div>
  );
}
