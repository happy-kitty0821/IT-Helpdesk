import type { Metadata } from "next";
import { ArrowRight, BookOpen, Clock3, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AnnouncementModal } from "@/components/announcement-modal";
import { HeroAnimations } from "@/components/hero-animations";
import { ResourceStripAnimated } from "@/components/resource-strip-animated";
import { ServiceSection } from "@/components/service-section";
import { SiteHeader } from "@/components/site-header";

// ── Office-hours helpers ──────────────────────────────────────────────────────

interface OfficeHourRow { day: string; hours: string; }

/** Map day names to JS getDay() values (0 = Sunday). */
const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Parse "10:00 AM" / "4:00 PM" style time strings into minutes since midnight.
 * Returns null if the string doesn't match.
 */
function parseTime(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/**
 * Determine whether the current Nepal time (UTC+5:45) falls inside any open
 * office-hours slot from the provided rows.
 *
 * Nepal Standard Time is UTC+5:45 (offset = 5*60+45 = 345 minutes).
 */
function isWithinOfficeHours(rows: OfficeHourRow[]): boolean {
  // Current time in Asia/Kathmandu (NST = UTC+5:45)
  const nowUtcMs  = Date.now();
  const nstOffset = (5 * 60 + 45) * 60 * 1000; // 345 min in ms
  const nstDate   = new Date(nowUtcMs + nstOffset);

  const dayOfWeek   = nstDate.getUTCDay();          // 0 = Sunday
  const minuteOfDay = nstDate.getUTCHours() * 60 + nstDate.getUTCMinutes();

  for (const row of rows) {
    // Match today's row by day name
    if (DAY_INDEX[row.day.toLowerCase()] !== dayOfWeek) continue;

    const hrs = row.hours.trim();
    if (!hrs || hrs.toLowerCase() === "closed") return false;

    // Parse "HH:MM AM – HH:MM PM"
    const parts = hrs.split(/[–—-]/); // en-dash, em-dash, or hyphen
    if (parts.length !== 2) continue;
    const start = parseTime(parts[0]);
    const end   = parseTime(parts[1]);
    if (start === null || end === null) continue;

    return minuteOfDay >= start && minuteOfDay < end;
  }
  return false; // no matching row → assume closed
}

/** Fetch office hours from SiteSettings; returns fallback on error. */
async function getOfficeHours(): Promise<OfficeHourRow[]> {
  const FALLBACK: OfficeHourRow[] = [
    { day: "Sunday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Monday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Tuesday",   hours: "10:00 AM – 4:00 PM" },
    { day: "Wednesday", hours: "10:00 AM – 4:00 PM" },
    { day: "Thursday",  hours: "10:00 AM – 4:00 PM" },
    { day: "Friday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Saturday",  hours: "Closed" },
  ];
  try {
    const res = await fetch(`${process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000"}/api/v1/settings/site/`, { cache: "no-store" });
    if (!res.ok) return FALLBACK;
    const data = await res.json() as { office_hours?: OfficeHourRow[] };
    const rows = data.office_hours;
    return Array.isArray(rows) && rows.length > 0 ? rows : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

// ── Per-page metadata ─────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: "IIC IT & NOC Helpdesk",
  description:
    "Report an issue, track your request, or find a guide. IT and NOC support for Itahari International College students and staff.",
  alternates: { canonical: "/" },
  openGraph: {
    url:   "/",
    title: "IIC IT & NOC Helpdesk",
  },
};

// ── JSON-LD structured data ────────────────────────────────────────────────────
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ?? process.env.NEXT_PUBLIC_DJANGO_URL
  ?? "https://ithelpdesk-iic.cloud-dev.tech";

const jsonLd = {
  "@context":  "https://schema.org",
  "@graph": [
    {
      "@type":       "Organization",
      "@id":         `${SITE_URL}/#organization`,
      "name":        "Itahari International College",
      "url":         "https://iic.edu.np",
      "description": "A leading IT-focused college in Itahari, Nepal.",
      "contactPoint": {
        "@type":       "ContactPoint",
        "contactType": "technical support",
        "url":         `${SITE_URL}/tickets/new`,
        "availableLanguage": ["English", "Nepali"],
      },
    },
    {
      "@type":           "WebSite",
      "@id":             `${SITE_URL}/#website`,
      "url":             SITE_URL,
      "name":            "IIC IT & NOC Helpdesk",
      "description":     "IT support, service requests, and self-service guides for Itahari International College.",
      "publisher":       { "@id": `${SITE_URL}/#organization` },
      "potentialAction": {
        "@type":       "SearchAction",
        "target":      {
          "@type":       "EntryPoint",
          "urlTemplate": `${SITE_URL}/?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const officeHours = await getOfficeHours();
  const isOpen      = isWithinOfficeHours(officeHours);

  return (
    <>
      <SiteHeader />

      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main>
        {/* ── Hero ── */}
        <section className="hero shell" aria-labelledby="page-title">
          {/* Animated wrapper handles entry animations for hero children */}
          <HeroAnimations>
            <div className="hero-copy">
              <span className="system-state" style={isOpen ? undefined : {
                background: "#fef2f2",
                color: "#b91c1c",
                borderColor: "color-mix(in srgb, #b91c1c 28%, transparent)",
              }}>
                <i aria-hidden="true" style={isOpen ? undefined : { background: "#b91c1c" }} />
                {isOpen
                  ? "IT support is available during college hours"
                  : "Outside office hours — tickets may not get an immediate response"}
              </span>
              <h1 id="page-title">What can we help you with?</h1>
              <p>
                Report an issue, follow your request, or find a trusted guide from the IIC IT &amp; NOC team.
              </p>
              <form className="help-search" action="/" method="get">
                <Search aria-hidden="true" />
                <label className="sr-only" htmlFor="help-query">Search help</label>
                <input
                  id="help-query" name="q" type="search"
                  defaultValue={q}
                  placeholder="Search Wi-Fi, email, software…"
                />
                <button type="submit">Search</button>
              </form>
            </div>

            <aside className="quick-panel" aria-label="Quick help">
              <span className="panel-kicker">Need support now?</span>
              <h2>Start with the right request.</h2>
              <p>Choose a service and we&apos;ll route it to the right IT team.</p>
              <Link href="#services">View services <ArrowRight aria-hidden="true" /></Link>
              <div className="trust-row">
                <ShieldCheck aria-hidden="true" />
                <span>Your request is visible only to authorized staff.</span>
              </div>
            </aside>
          </HeroAnimations>
        </section>

        {/* ── Services ── */}
        <section className="services-section" id="services" aria-labelledby="services-heading">
          <div className="shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Support services</p>
                <h2 id="services-heading">Choose what you need</h2>
              </div>
              <p>Sign-in is required for most requests. Account recovery stays available when you are locked out.</p>
            </div>
            {q && (
              <p className="search-summary" role="status">
                Showing results for &ldquo;{q}&rdquo;
              </p>
            )}
            <ServiceSection initialQuery={q} />
          </div>
        </section>

        {/* ── Resource strip ── */}
        <ResourceStripAnimated>
          <article>
            <BookOpen aria-hidden="true" />
            <div>
              <h2>Guides &amp; software</h2>
              <p>Read approved setup instructions and find software resources.</p>
            </div>
            <span className="resource-links">
              <Link href="/help">Guides</Link>
              <Link href="/software">Software</Link>
            </span>
          </article>
          <article id="status">
            <Clock3 aria-hidden="true" />
            <div>
              <h2>Service status</h2>
              <p>All published services currently show their latest available status.</p>
            </div>
            <strong><i aria-hidden="true" /> Operational</strong>
          </article>
        </ResourceStripAnimated>
      </main>

      {/* Announcement modal — only mounts on /, rendered client-side */}
      <AnnouncementModal />
    </>
  );
}
