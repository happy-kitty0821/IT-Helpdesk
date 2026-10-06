"use client";

import { motion } from "motion/react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Construction, Loader2,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { useEffect, useState } from "react";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/animations";

// ── Types ──────────────────────────────────────────────────────────────────

type ServiceStatusValue = "operational" | "degraded" | "outage" | "maintenance";

interface ServiceStatusItem {
  id: number;
  category_name: string;
  category_slug: string;
  category_icon: string;
  status: ServiceStatusValue;
  status_label: string;
  message: string;
  incident_started_at: string | null;
  estimated_resolution: string | null;
  updated_at: string;
}

interface StatusPage {
  overall: ServiceStatusValue;
  services: ServiceStatusItem[];
}

// ── Display helpers ────────────────────────────────────────────────────────

const STATUS_META: Record<ServiceStatusValue, {
  label: string; icon: React.ReactNode;
  dotColor: string; pillBg: string; pillText: string;
}> = {
  operational: {
    label: "Operational",
    icon: <CheckCircle2 size={16} aria-hidden="true" />,
    dotColor: "#22c55e",
    pillBg: "#dcfce7", pillText: "#166534",
  },
  degraded: {
    label: "Degraded",
    icon: <AlertTriangle size={16} aria-hidden="true" />,
    dotColor: "#f59e0b",
    pillBg: "#fef3c7", pillText: "#92400e",
  },
  outage: {
    label: "Outage",
    icon: <AlertTriangle size={16} aria-hidden="true" />,
    dotColor: "#ef4444",
    pillBg: "#fee2e2", pillText: "#991b1b",
  },
  maintenance: {
    label: "Maintenance",
    icon: <Construction size={16} aria-hidden="true" />,
    dotColor: "#6366f1",
    pillBg: "#eef2ff", pillText: "#3730a3",
  },
};

const OVERALL_BANNERS: Record<ServiceStatusValue, { bg: string; text: string; border: string; message: string }> = {
  operational: {
    bg: "#f0fdf4", text: "#166534", border: "#bbf7d0",
    message: "All systems are operational",
  },
  degraded: {
    bg: "#fffbeb", text: "#92400e", border: "#fcd34d",
    message: "Some services are experiencing degraded performance",
  },
  outage: {
    bg: "#fef2f2", text: "#991b1b", border: "#fca5a5",
    message: "One or more services are currently unavailable",
  },
  maintenance: {
    bg: "#eef2ff", text: "#3730a3", border: "#a5b4fc",
    message: "Scheduled maintenance is in progress",
  },
};

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium", timeStyle: "short",
  });
}

// ── Service row ────────────────────────────────────────────────────────────

function ServiceRow({ svc }: { svc: ServiceStatusItem }) {
  const meta = STATUS_META[svc.status] ?? STATUS_META.operational;

  return (
    <motion.div
      variants={staggerItem}
      style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "14px 20px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Status dot */}
      <span
        style={{
          display: "inline-block", width: 10, height: 10,
          borderRadius: "50%", background: meta.dotColor,
          flexShrink: 0,
          boxShadow: svc.status !== "operational"
            ? `0 0 0 4px ${meta.pillBg}` : "none",
        }}
        aria-hidden="true"
      />

      {/* Service name */}
      <span style={{ flex: 1, fontWeight: 600, fontSize: ".92rem" }}>
        {svc.category_name}
      </span>

      {/* Message (if any) */}
      {svc.message && (
        <span style={{
          flex: 2, fontSize: ".82rem",
          color: "var(--muted)", fontStyle: "italic",
        }}>
          {svc.message}
        </span>
      )}

      {/* Status pill */}
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: meta.pillBg, color: meta.pillText,
        borderRadius: 999, padding: "4px 12px",
        fontSize: ".78rem", fontWeight: 800, flexShrink: 0,
      }}>
        {meta.icon}
        {meta.label}
      </span>
    </motion.div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [data, setData] = useState<StatusPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/status/", {
        credentials: "include", cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load service status.");
      setData(await res.json());
      setLastChecked(new Date());
    } catch {
      setError("Could not load service status. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Load on mount; auto-refresh every 60 s
  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  const banner = data ? OVERALL_BANNERS[data.overall] : null;

  const allOk     = data?.services.every((s) => s.status === "operational");
  const incidents = data?.services.filter((s) => s.status !== "operational") ?? [];

  return (
    <>
      <SiteHeader />
      <main className="shell" style={{ paddingTop: 40, paddingBottom: 80 }}>

        {/* Page heading */}
        <motion.div
          variants={fadeUp} initial="hidden" animate="show"
          style={{ marginBottom: 32 }}
        >
          <p className="eyebrow">System health</p>
          <h1 style={{ fontSize: "2rem", margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
            <Activity size={28} style={{ color: "var(--brand)" }} aria-hidden="true" />
            Service Status
          </h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: ".95rem" }}>
            Live operational status for all IIC IT &amp; NOC services.
            {lastChecked && (
              <span style={{ marginLeft: 8 }}>
                Last checked {lastChecked.toLocaleTimeString("en-GB", { timeStyle: "short" })}.
              </span>
            )}
          </p>
        </motion.div>

        {/* Error */}
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fca5a5",
            borderRadius: 12, padding: "14px 20px", marginBottom: 24,
            color: "#991b1b", fontSize: ".9rem",
          }} role="alert">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", color: "var(--muted)", marginBottom: 32 }}>
            <Loader2 size={20} className="spin" aria-hidden="true" />
            Checking service status…
          </div>
        )}

        {data && (
          <motion.div variants={staggerContainer} initial="hidden" animate="show">

            {/* Overall banner */}
            <motion.div
              variants={staggerItem}
              style={{
                background: banner!.bg,
                border: `2px solid ${banner!.border}`,
                borderRadius: 16, padding: "20px 24px",
                marginBottom: 28,
                display: "flex", alignItems: "center", gap: 14,
              }}
              role="status"
              aria-live="polite"
            >
              {data.overall === "operational"
                ? <CheckCircle2 size={28} style={{ color: banner!.text, flexShrink: 0 }} aria-hidden="true" />
                : <AlertTriangle size={28} style={{ color: banner!.text, flexShrink: 0 }} aria-hidden="true" />
              }
              <div>
                <strong style={{ fontSize: "1.05rem", color: banner!.text }}>
                  {banner!.message}
                </strong>
                {!allOk && incidents.length > 0 && (
                  <p style={{ margin: "4px 0 0", fontSize: ".85rem", color: banner!.text, opacity: 0.8 }}>
                    {incidents.length} service{incidents.length !== 1 ? "s" : ""} affected
                  </p>
                )}
              </div>
            </motion.div>

            {/* Active incidents summary (only shown when not all operational) */}
            {incidents.length > 0 && (
              <motion.div variants={staggerItem} style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 12, color: "#334155" }}>
                  Active incidents
                </h2>
                <div style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 14, overflow: "hidden",
                }}>
                  {incidents.map((svc) => {
                    const meta = STATUS_META[svc.status] ?? STATUS_META.operational;
                    return (
                      <div
                        key={svc.id ?? svc.category_slug}
                        style={{
                          padding: "14px 20px",
                          borderBottom: "1px solid var(--border)",
                          background: meta.pillBg,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ color: meta.pillText }}>{meta.icon}</span>
                          <strong style={{ fontSize: ".9rem", color: meta.pillText }}>
                            {svc.category_name}
                          </strong>
                          <span style={{
                            background: meta.pillBg, color: meta.pillText,
                            border: `1px solid ${meta.dotColor}40`,
                            borderRadius: 999, padding: "2px 10px",
                            fontSize: ".72rem", fontWeight: 800,
                          }}>{meta.label}</span>
                        </div>
                        {svc.message && (
                          <p style={{ margin: "6px 0 0 26px", fontSize: ".85rem", color: meta.pillText, opacity: 0.9 }}>
                            {svc.message}
                          </p>
                        )}
                        <div style={{ display: "flex", gap: 20, marginTop: 6, marginLeft: 26, flexWrap: "wrap" }}>
                          {svc.incident_started_at && (
                            <span style={{ fontSize: ".78rem", color: meta.pillText, opacity: 0.8, display: "flex", alignItems: "center", gap: 4 }}>
                              <Clock size={12} aria-hidden="true" />
                              Started: {formatDate(svc.incident_started_at)}
                            </span>
                          )}
                          {svc.estimated_resolution && (
                            <span style={{ fontSize: ".78rem", color: meta.pillText, opacity: 0.8, display: "flex", alignItems: "center", gap: 4 }}>
                              <Clock size={12} aria-hidden="true" />
                              Est. resolution: {formatDate(svc.estimated_resolution)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* All services table */}
            <motion.div variants={staggerItem}>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 12, color: "#334155" }}>
                All services
              </h2>
              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 14, overflow: "hidden",
              }}>
                {data.services.length === 0 ? (
                  <p style={{ padding: 32, textAlign: "center", color: "var(--muted)", margin: 0 }}>
                    No services configured yet.
                  </p>
                ) : (
                  data.services.map((svc) => (
                    <ServiceRow key={svc.id ?? svc.category_slug} svc={svc} />
                  ))
                )}
              </div>
            </motion.div>

            {/* Refresh button */}
            <motion.div variants={staggerItem} style={{ marginTop: 24, textAlign: "right" }}>
              <button
                onClick={load}
                disabled={loading}
                className="secondary-button"
                style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
              >
                {loading
                  ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Refreshing…</>
                  : "Refresh status"
                }
              </button>
            </motion.div>

          </motion.div>
        )}

      </main>
    </>
  );
}
