"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ServiceGrid } from "@/components/service-grid";
import { type Service, fallbackServices } from "@/lib/services";
import { fadeIn } from "@/lib/animations";

interface Props {
  initialQuery?: string;
}

// ── Skeleton placeholder ───────────────────────────────────────────────────────
function ServiceSkeleton() {
  return (
    <motion.div
      className="service-grid"
      variants={fadeIn}
      initial="hidden"
      animate="show"
      aria-hidden="true"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="service-card"
          style={{
            background: "var(--surface)",
            minHeight: 275,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Icon placeholder */}
          <span
            className="service-icon"
            style={{ background: "var(--background)", borderRadius: 14 }}
          />
          {/* Text placeholders */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            <div className="skel-line" style={{ width: "40%", height: 10 }} />
            <div className="skel-line" style={{ width: "75%", height: 18 }} />
            <div className="skel-line" style={{ width: "90%", height: 12 }} />
            <div className="skel-line" style={{ width: "70%", height: 12 }} />
          </div>
          <div className="skel-line" style={{ width: "50%", height: 14, marginTop: "auto" }} />
        </div>
      ))}
    </motion.div>
  );
}

export function ServiceSection({ initialQuery = "" }: Props) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const query = initialQuery.trim().toLowerCase();

  useEffect(() => {
    fetch("/api/v1/services/", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Service[]>) : fallbackServices))
      .then((data) => setServices(Array.isArray(data) ? data : fallbackServices))
      .catch(() => setServices(fallbackServices))
      .finally(() => setLoading(false));
  }, []);

  const visible = query
    ? services.filter((s) => `${s.name} ${s.summary}`.toLowerCase().includes(query))
    : services;

  if (loading) return <ServiceSkeleton />;

  if (visible.length === 0) {
    return (
      <motion.div
        className="no-results"
        variants={fadeIn}
        initial="hidden"
        animate="show"
      >
        <h3>No matching service</h3>
        <p>Try &ldquo;Wi-Fi&rdquo;, &ldquo;account&rdquo;, &ldquo;device&rdquo;, or choose General IT support.</p>
        <a href="/#services">Clear search</a>
      </motion.div>
    );
  }

  return <ServiceGrid services={visible} />;
}
