import { ArrowRight, BookOpen, Clock3, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ServiceGrid } from "@/components/service-grid";
import { SiteHeader } from "@/components/site-header";
import { getServices } from "@/lib/services";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const services = await getServices();
  const { q = "" } = await searchParams;
  const normalizedQuery = q.trim().toLowerCase();
  const visibleServices = normalizedQuery
    ? services.filter((service) => `${service.name} ${service.summary}`.toLowerCase().includes(normalizedQuery))
    : services;
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero shell" aria-labelledby="page-title">
          <div className="hero-copy">
            <span className="system-state"><i aria-hidden="true" /> IT support is available during college hours</span>
            <h1 id="page-title">What can we help you with?</h1>
            <p>Report an issue, follow your request, or find a trusted guide from the IIC IT & NOC team.</p>
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
            <p>Choose a service and we’ll route it to the right IT team.</p>
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
            {normalizedQuery && <p className="search-summary" role="status">{visibleServices.length} service{visibleServices.length === 1 ? "" : "s"} found for “{q}”</p>}
            {visibleServices.length > 0 ? <ServiceGrid services={visibleServices} /> : <div className="no-results"><h3>No matching service</h3><p>Try “Wi-Fi”, “account”, “device”, or choose General IT support.</p><Link href="/#services">Clear search</Link></div>}
          </div>
        </section>

        <section className="resource-strip shell" aria-label="Self-service resources">
          <article><BookOpen aria-hidden="true" /><div><h2>Guides & software</h2><p>Installation steps and approved downloads are being prepared for the IIC catalogue.</p></div><span aria-label="Coming soon">Coming soon</span></article>
          <article id="status"><Clock3 aria-hidden="true" /><div><h2>Service status</h2><p>All published services currently show their latest available status.</p></div><strong><i aria-hidden="true" /> Operational</strong></article>
        </section>
      </main>
      <footer><div className="shell"><span>© 2026 Itahari International College · IT & NOC Department</span><span>Support contact and office hours pending confirmation</span></div></footer>
    </>
  );
}
