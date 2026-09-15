"use client";

import { useEffect, useState } from "react";
import { ServiceGrid } from "@/components/service-grid";
import { type Service, fallbackServices } from "@/lib/services";

interface Props {
  initialQuery?: string;
}

/**
 * Client component that fetches services WITH auth credentials so the
 * backend can apply per-user audience filtering correctly.
 *
 * Replaces the previous server-side unauthenticated fetch which always
 * treated every visitor as anonymous and therefore never returned
 * staff-only services (e.g. CCTV Review Request) even for logged-in staff.
 */
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
    ? services.filter((s) =>
        `${s.name} ${s.summary}`.toLowerCase().includes(query)
      )
    : services;

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: ".9rem" }}>
        Loading services…
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="no-results">
        <h3>No matching service</h3>
        <p>Try "Wi-Fi", "account", "device", or choose General IT support.</p>
        <a href="/#services">Clear search</a>
      </div>
    );
  }

  return <ServiceGrid services={visible} />;
}
