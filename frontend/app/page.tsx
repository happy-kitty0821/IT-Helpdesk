import { ArrowRight, BookOpen, Clock3, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ServiceSection } from "@/components/service-section";
import { SiteHeader } from "@/components/site-header";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero shell" aria-labelledby="page-title">
          <div className="hero-copy">
            <span className="system-state"><i aria-hidden="true" /> IT support is available during college hours</span>
            <h1 id="page-title">What can we help you with?</h1>
            <p>Report an issue, follow your request, or find a trusted guide from the IIC IT &amp; NOC team.</p>
            <form className="help-search" action="/" method="get">
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="help-query">Search help</label>
              <input id="help-query" name="q" type="search" defaultValue={q} placeholder="Search Wi-Fi, email, software…" />
              <button type="submit">Search</button>
            </form>
          </div>
          <aside className="quick-panel" aria-label="Quick help">
            <span className="panel-kicker">Need support now?</span>
            <h2>Start with the right request.</h2>
            <p>Choose a service and we&apos;ll route it to the right IT team.</p>
            <Link href="#services">View services <ArrowRight aria-hidden="true" /></Link>
            <div className="trust-row"><ShieldCheck aria-hidden="true" /><span>Your request is visible only to authorized staff.</span></div>
          </aside>
        </section>

        <section className="services-section" id="services" aria-labelledby="services-heading">
          <div className="shell">
            <div className="section-heading">
              <div><p className="eyebrow">Support services</p><h2 id="services-heading">Choose what you need</h2></div>
              <p>Sign-in is required for most requests. Account recovery stays available when you are locked out.</p>
            </div>
            {q && (
              <p className="search-summary" role="status">
                Showing results for &ldquo;{q}&rdquo;
              </p>
            )}
            {/*
              ServiceSection is a client component that fetches /api/v1/services/ with
              credentials. This means the backend sees the session cookie and can apply
              per-user audience filtering — staff-only services (e.g. CCTV Review) will
              appear for logged-in staff/faculty but not for students or anonymous visitors.
            */}
            <ServiceSection initialQuery={q} />
          </div>
        </section>

        <section className="resource-strip shell" aria-label="Self-service resources">
          <article>
            <BookOpen aria-hidden="true" />
            <div><h2>Guides &amp; software</h2><p>Read approved setup instructions and find software resources.</p></div>
            <span className="resource-links"><Link href="/help">Guides</Link><Link href="/software">Software</Link></span>
          </article>
          <article id="status">
            <Clock3 aria-hidden="true" />
            <div><h2>Service status</h2><p>All published services currently show their latest available status.</p></div>
            <strong><i aria-hidden="true" /> Operational</strong>
          </article>
        </section>
      </main>
      <footer>
        <div className="shell">
          <span>© 2026 Itahari International College · IT &amp; NOC Department</span>
          <span>Support contact and office hours pending confirmation</span>
        </div>
      </footer>
    </>
  );
}
