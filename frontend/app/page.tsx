import type { Metadata } from "next";
import { ArrowRight, BookOpen, Clock3, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AnnouncementModal } from "@/components/announcement-modal";
import { HeroAnimations } from "@/components/hero-animations";
import { ResourceStripAnimated } from "@/components/resource-strip-animated";
import { ServiceSection } from "@/components/service-section";
import { SiteHeader } from "@/components/site-header";

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
              <span className="system-state">
                <i aria-hidden="true" /> IT support is available during college hours
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

      <footer>
        <div className="shell">
          <span>© 2026 Itahari International College · IT &amp; NOC Department</span>
          <span>Support contact and office hours pending confirmation</span>
        </div>
      </footer>

      {/* Announcement modal — only mounts on /, rendered client-side */}
      <AnnouncementModal />
    </>
  );
}
