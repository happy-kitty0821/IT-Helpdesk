import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Badge, Camera, KeyRound, Laptop, LifeBuoy, Wifi } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getServices } from "@/lib/services";
import type { Service } from "@/lib/services";

// ── Icon map (matches service-grid.tsx) ───────────────────────────────────────

const ICONS = {
  "key-round": KeyRound,
  laptop:      Laptop,
  badge:       Badge,
  wifi:        Wifi,
  camera:      Camera,
  "life-buoy": LifeBuoy,
};

// ── Audience label ────────────────────────────────────────────────────────────

function audienceLabel(audience: Service["audience"]) {
  switch (audience) {
    case "public":  return "Available without sign-in";
    case "student": return "Students only";
    case "staff":   return "Faculty & staff only";
    default:        return "Students & staff";
  }
}

// ── Static params for SSG ─────────────────────────────────────────────────────

export async function generateStaticParams() {
  try {
    const services = await getServices();
    return services.map((s) => ({ slug: s.slug }));
  } catch {
    return [];
  }
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const services  = await getServices();
  const service   = services.find((s) => s.slug === slug);
  if (!service) return { title: "Service not found" };
  return {
    title:       service.name,
    description: service.summary,
    openGraph: {
      title:       `${service.name} · IIC IT & NOC Helpdesk`,
      description: service.summary,
      url:         `/services/${slug}`,
    },
    alternates: { canonical: `/services/${slug}` },
  };
}

// ── Stage step list ───────────────────────────────────────────────────────────

function StageList({ stages }: { stages: Service["stages"] }) {
  if (!stages || stages.length === 0) return null;
  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 800, marginBottom: 16 }}>What happens next</h2>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {stages.map((stage, i) => (
          <li key={stage.key} style={{
            display: "flex", alignItems: "flex-start", gap: 14,
            background: "var(--background)", border: "1px solid var(--border)",
            borderRadius: 12, padding: "14px 16px",
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: "var(--brand)", color: "#fff",
              display: "grid", placeItems: "center",
              fontSize: ".78rem", fontWeight: 800,
            }}>
              {i + 1}
            </span>
            <div>
              <p style={{ margin: "0 0 3px", fontWeight: 750, fontSize: ".9rem" }}>
                {stage.icon && <span aria-hidden="true" style={{ marginRight: 6 }}>{stage.icon}</span>}
                {stage.label}
              </p>
              {stage.description && (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: ".83rem", lineHeight: 1.55 }}>
                  {stage.description}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ServiceDetailPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const services  = await getServices();
  const service   = services.find((s) => s.slug === slug);
  if (!service) notFound();

  const Icon = ICONS[service.icon as keyof typeof ICONS] ?? LifeBuoy;

  return (
    <>
      <SiteHeader />
      <main className="shell page-enter" style={{ paddingBlock: "48px 80px" }}>

        {/* ── Back ── */}
        <Link href="/services" className="back-link" style={{ marginBottom: 32, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ArrowLeft size={17} aria-hidden="true" /> All services
        </Link>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(260px,340px)", gap: 40, alignItems: "start" }}>

          {/* ── Main content ── */}
          <div>
            {/* Service header */}
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 28 }}>
              <div style={{
                width: 60, height: 60, borderRadius: 16, flexShrink: 0,
                background: "var(--brand-soft)", display: "grid", placeItems: "center",
              }}>
                <Icon size={26} style={{ color: "var(--brand)" }} aria-hidden="true" />
              </div>
              <div>
                <p className="eyebrow" style={{ marginBottom: 4 }}>{audienceLabel(service.audience)}</p>
                <h1 style={{ margin: 0, fontSize: "clamp(1.7rem,4vw,2.6rem)", letterSpacing: "-.04em", lineHeight: 1.15 }}>
                  {service.name}
                </h1>
              </div>
            </div>

            <p style={{ fontSize: "1.05rem", color: "var(--muted)", marginBottom: 32, maxWidth: 580, lineHeight: 1.65 }}>
              {service.summary}
            </p>

            {/* What to prepare section */}
            {service.form_schema.length > 0 && (
              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 14, padding: "22px 24px", marginBottom: 24,
              }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 14px" }}>
                  Information you&apos;ll need to provide
                </h2>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                  {service.form_schema.map((field) => (
                    <li key={field.key} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: ".9rem" }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                        background: field.required ? "var(--brand)" : "var(--muted)",
                        marginTop: 6,
                      }} aria-hidden="true" />
                      <span>
                        {field.label}
                        {!field.required && (
                          <span style={{ color: "var(--muted)", fontSize: ".82rem", marginLeft: 6 }}>(optional)</span>
                        )}
                        {field.help_text && (
                          <span style={{ display: "block", color: "var(--muted)", fontSize: ".82rem", marginTop: 2, lineHeight: 1.45 }}>
                            {field.help_text}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Workflow stages */}
            <StageList stages={service.stages} />

            {/* CTA */}
            <div style={{ marginTop: 36 }}>
              <Link
                href={`/tickets/new?service=${service.slug}`}
                className="primary-button"
                style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: "1rem", padding: "13px 26px" }}
              >
                Submit a {service.name.toLowerCase()} request
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* ── Aside ── */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 110 }}>

            {/* Eligibility */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, padding: "20px 22px",
            }}>
              <h3 style={{ margin: "0 0 10px", fontSize: ".9rem", fontWeight: 800 }}>Eligibility</h3>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: ".85rem", lineHeight: 1.6 }}>
                {audienceLabel(service.audience)}.{" "}
                {service.audience === "public"
                  ? "You can submit this request without signing in."
                  : service.audience === "staff"
                  ? "You must sign in with a verified staff account to submit this request."
                  : "You must sign in with a verified IIC account to submit this request."}
              </p>
            </div>

            {/* Privacy note */}
            <div style={{
              background: "#fef9c3", border: "1px solid #fde047",
              borderRadius: 14, padding: "16px 18px",
            }}>
              <h3 style={{ margin: "0 0 8px", fontSize: ".88rem", fontWeight: 800, color: "#713f12" }}>
                Privacy reminder
              </h3>
              <p style={{ margin: 0, fontSize: ".82rem", color: "#78350f", lineHeight: 1.6 }}>
                Never include your password, one-time codes, or verification secrets
                in a support ticket.
              </p>
            </div>

            {/* Help guides link */}
            <Link
              href="/help"
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px 18px", background: "var(--brand-soft)",
                borderRadius: 14, color: "var(--brand)", fontWeight: 700, fontSize: ".88rem",
                textDecoration: "none",
              }}
            >
              <span>Browse self-service guides</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>

          </aside>
        </div>
      </main>
    </>
  );
}
