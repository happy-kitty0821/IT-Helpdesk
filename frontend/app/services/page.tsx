import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { getServices } from "@/lib/services";
import { ServiceGrid } from "@/components/service-grid";

export const metadata: Metadata = {
  title: "Services",
  description: "Browse IT support services at Itahari International College — account recovery, device support, ID replacement, Wi-Fi issues, and more.",
  openGraph: {
    title:       "Services · IIC IT & NOC Helpdesk",
    description: "Find the right IT support service for your need at IIC.",
    url:         "/services",
  },
  alternates: { canonical: "/services" },
};

export default async function ServicesPage() {
  const services = await getServices();

  return (
    <>
      <SiteHeader />
      <main className="shell page-enter" style={{ paddingBlock: "56px 80px" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 40 }}>
          <p className="eyebrow">Available services</p>
          <h1 style={{ fontSize: "clamp(2.4rem,5vw,3.8rem)", letterSpacing: "-.045em", margin: "8px 0 14px" }}>
            How can we help?
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "1.05rem", maxWidth: 560, margin: 0 }}>
            Choose the service that best describes your issue. Each service has a dedicated
            form and workflow so the right team can help you quickly.
          </p>
        </div>

        {/* ── Grid ── */}
        {services.length > 0
          ? <ServiceGrid services={services} />
          : (
            <div className="no-results">
              <h3>No services available</h3>
              <p>Services will appear here once an administrator publishes them.</p>
            </div>
          )
        }

        {/* ── Bottom CTA ── */}
        <div style={{
          marginTop: 48, padding: "28px 32px",
          background: "var(--brand-soft)", borderRadius: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 20, flexWrap: "wrap",
        }}>
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: ".95rem" }}>
              Not sure which service to choose?
            </p>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: ".88rem" }}>
              Submit a General IT support request and the team will route it correctly.
            </p>
          </div>
          <Link
            href="/tickets/new?service=general-support"
            className="primary-button"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
          >
            General IT support <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>

      </main>
    </>
  );
}
