"use client";

import { motion } from "motion/react";
import { Loader2, MessageSquareDashed, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface FeedbackItem {
  id: number;
  ticket: string;
  rating: number;
  rating_label: string;
  comment: string;
  submitted_by_name: string;
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const RATING_COLORS: Record<number, { text: string; bg: string }> = {
  1: { text: "#991b1b", bg: "#fee2e2" },
  2: { text: "#92400e", bg: "#fef3c7" },
  3: { text: "#475569", bg: "#f1f5f9" },
  4: { text: "#166534", bg: "#dcfce7" },
  5: { text: "#166534", bg: "#bbf7d0" },
};

function StarRow({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }} aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s} size={14}
          style={{
            color: s <= rating ? "#f59e0b" : "#d1d5db",
            fill:  s <= rating ? "#f59e0b" : "transparent",
          }}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminFeedbackPage() {
  const [items, setItems]     = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    fetch("/api/v1/admin/feedback/", { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject("Failed to load."))
      .then(setItems)
      .catch((e) => setError(typeof e === "string" ? e : "Failed to load feedback."))
      .finally(() => setLoading(false));
  }, []);

  // Compute summary stats
  const avgRating = items.length
    ? (items.reduce((s, f) => s + f.rating, 0) / items.length).toFixed(1)
    : null;
  const dist = [5, 4, 3, 2, 1].map((r) => ({
    rating: r,
    count: items.filter((f) => f.rating === r).length,
  }));

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Support quality</p>
          <h1>Satisfaction Feedback</h1>
          <p>Ratings submitted by requesters after their tickets were resolved.</p>
        </div>
      </header>

      {error && (
        <p className="admin-error" role="alert">{error}</p>
      )}

      {loading ? (
        <div className="empty-row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Loader2 className="spin" size={18} aria-hidden="true" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="empty-row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <MessageSquareDashed size={20} style={{ color: "#234395" }} aria-hidden="true" />
          No feedback submitted yet.
        </div>
      ) : (
        <>
          {/* ── Summary ── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{
              display: "grid", gridTemplateColumns: "auto 1fr",
              gap: 32, alignItems: "center",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 16, padding: "20px 28px", marginBottom: 28,
            }}
          >
            {/* Average */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "3rem", fontWeight: 900, color: "#234395", lineHeight: 1 }}>
                {avgRating}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 3, margin: "6px 0 4px" }}>
                {[1,2,3,4,5].map((s) => (
                  <Star key={s} size={18}
                    style={{
                      color: s <= Math.round(Number(avgRating)) ? "#f59e0b" : "#d1d5db",
                      fill:  s <= Math.round(Number(avgRating)) ? "#f59e0b" : "transparent",
                    }}
                    aria-hidden="true"
                  />
                ))}
              </div>
              <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>
                {items.length} response{items.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Distribution bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {dist.map(({ rating, count }) => {
                const pct = items.length ? (count / items.length) * 100 : 0;
                const meta = RATING_COLORS[rating];
                return (
                  <div key={rating} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: ".78rem", fontWeight: 700, minWidth: 8 }}>{rating}</span>
                    <Star size={12} style={{ color: "#f59e0b", fill: "#f59e0b" }} aria-hidden="true" />
                    <div style={{ flex: 1, height: 8, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: meta.bg === "#bbf7d0" ? "#22c55e" : "#f59e0b", borderRadius: 999, transition: "width 0.4s ease" }} />
                    </div>
                    <span style={{ fontSize: ".75rem", color: "var(--muted)", minWidth: 24, textAlign: "right" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* ── List ── */}
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((fb, i) => {
              const meta = RATING_COLORS[fb.rating] ?? RATING_COLORS[3];
              return (
                <motion.article
                  key={fb.id}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.2) }}
                  style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 12, padding: "14px 20px",
                    display: "grid", gridTemplateColumns: "1fr auto",
                    gap: 12, alignItems: "start",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                      <StarRow rating={fb.rating} />
                      <span style={{
                        background: meta.bg, color: meta.text,
                        borderRadius: 999, padding: "2px 10px",
                        fontSize: ".74rem", fontWeight: 800,
                      }}>
                        {fb.rating_label}
                      </span>
                      <Link href={`/admin/tickets`} style={{ fontSize: ".78rem", color: "var(--brand)", fontFamily: "ui-monospace,monospace" }}>
                        #{fb.ticket.split("-")[0]}
                      </Link>
                    </div>
                    {fb.comment && (
                      <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", fontStyle: "italic" }}>
                        &ldquo;{fb.comment}&rdquo;
                      </p>
                    )}
                    <p style={{ margin: "6px 0 0", fontSize: ".75rem", color: "var(--muted)" }}>
                      By {fb.submitted_by_name} &middot;{" "}
                      {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(fb.created_at))}
                    </p>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
