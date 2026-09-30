import type { Metadata } from "next";
import {
  ArrowLeft, BookOpen, Calendar, ExternalLink, FileText, Tag,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getGuides } from "@/lib/content";
import type { Guide } from "@/lib/admin-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function absolutePdfUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const origin = process.env.NEXT_PUBLIC_DJANGO_URL ?? "";
  if (!origin || origin.includes("localhost") || origin.includes("127.0.0.1")) return url;
  return `${origin}${url}`;
}

function audienceLabel(audience: Guide["audience"]) {
  switch (audience) {
    case "public":  return "Available to everyone";
    case "student": return "Students";
    case "staff":   return "Faculty & staff";
    default:        return "Students & staff";
  }
}

function formatDate(date: string | null) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(new Date(date));
}

// ── Static params ─────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  try {
    const guides = await getGuides();
    return guides.map((g) => ({ slug: g.slug }));
  } catch {
    return [];
  }
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const guides    = await getGuides();
  const guide     = guides.find((g) => g.slug === slug);
  if (!guide) return { title: "Guide not found" };
  return {
    title:       guide.title,
    description: guide.summary,
    openGraph: {
      title:       `${guide.title} · IIC IT & NOC Helpdesk`,
      description: guide.summary,
      url:         `/help/${slug}`,
    },
    alternates: { canonical: `/help/${slug}` },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function GuideDetailPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const guides    = await getGuides();
  const guide     = guides.find((g) => g.slug === slug);
  if (!guide) notFound();

  const pdfUrl = absolutePdfUrl(guide.pdf_url);
  const reviewed = formatDate(guide.reviewed_at);

  return (
    <>
      <SiteHeader />
      <main className="shell page-enter" style={{ paddingBlock: "48px 80px" }}>

        {/* ── Back ── */}
        <Link href="/help" className="back-link" style={{ marginBottom: 32, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ArrowLeft size={17} aria-hidden="true" /> All guides
        </Link>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(240px,300px)", gap: 36, alignItems: "start" }}>

          {/* ── Main ── */}
          <div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 18, marginBottom: 24 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14, flexShrink: 0,
                background: "var(--brand-soft)", display: "grid", placeItems: "center",
              }}>
                <FileText size={24} style={{ color: "var(--brand)" }} aria-hidden="true" />
              </div>
              <div>
                <p className="eyebrow" style={{ marginBottom: 4 }}>
                  IT &amp; NOC Guide · {audienceLabel(guide.audience)}
                </p>
                <h1 style={{ margin: 0, fontSize: "clamp(1.6rem,3.5vw,2.4rem)", letterSpacing: "-.04em", lineHeight: 1.2 }}>
                  {guide.title}
                </h1>
              </div>
            </div>

            <p style={{ fontSize: "1rem", color: "var(--muted)", marginBottom: 28, lineHeight: 1.7, maxWidth: 600 }}>
              {guide.summary}
            </p>

            {/* Meta chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
              {guide.tags.length > 0 && guide.tags.map((tag) => (
                <span key={tag} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", background: "var(--brand-soft)", color: "var(--brand)",
                  borderRadius: 999, fontSize: ".76rem", fontWeight: 700,
                }}>
                  <Tag size={11} aria-hidden="true" /> {tag}
                </span>
              ))}
              {reviewed && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", background: "#f8fafc", color: "var(--muted)",
                  border: "1px solid var(--border)", borderRadius: 999, fontSize: ".76rem",
                }}>
                  <Calendar size={11} aria-hidden="true" /> Reviewed {reviewed}
                </span>
              )}
            </div>

            {/* PDF viewer / link */}
            {pdfUrl ? (
              <div>
                {/* Embedded viewer */}
                <div style={{
                  border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden",
                  marginBottom: 16, background: "#f8fafc",
                }}>
                  <iframe
                    src={pdfUrl}
                    title={`PDF guide: ${guide.title}`}
                    style={{ width: "100%", height: "min(70vh, 700px)", border: 0, display: "block" }}
                    aria-label={`Embedded PDF: ${guide.title}`}
                  />
                </div>
                {/* External link fallback */}
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    color: "var(--brand)", fontWeight: 700, fontSize: ".9rem",
                  }}
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  Open PDF in a new tab
                </a>
              </div>
            ) : (
              <div style={{
                padding: "32px 24px", textAlign: "center",
                background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 14,
              }}>
                <BookOpen size={36} style={{ color: "var(--muted)", marginBottom: 12 }} aria-hidden="true" />
                <p style={{ fontWeight: 700, marginBottom: 4 }}>PDF not yet available</p>
                <p style={{ color: "var(--muted)", fontSize: ".88rem", margin: 0 }}>
                  This guide is being prepared. Check back soon or contact IT &amp; NOC.
                </p>
              </div>
            )}
          </div>

          {/* ── Aside ── */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 110 }}>

            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, padding: "20px 22px",
            }}>
              <h3 style={{ margin: "0 0 12px", fontSize: ".9rem", fontWeight: 800 }}>About this guide</h3>
              <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Audience",      value: audienceLabel(guide.audience) },
                  { label: "Last reviewed", value: reviewed ?? "Not recorded" },
                  { label: "Maintained by", value: guide.updated_by_name ?? "IIC IT & NOC" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt style={{ fontSize: ".74rem", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 2 }}>
                      {label}
                    </dt>
                    <dd style={{ margin: 0, fontSize: ".88rem", color: "var(--foreground)" }}>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Still need help CTA */}
            <div style={{
              background: "var(--brand-soft)", borderRadius: 14, padding: "18px 20px",
            }}>
              <h3 style={{ margin: "0 0 8px", fontSize: ".9rem", fontWeight: 800, color: "var(--brand)" }}>
                Still need help?
              </h3>
              <p style={{ margin: "0 0 14px", fontSize: ".83rem", color: "var(--muted)", lineHeight: 1.6 }}>
                If this guide didn&apos;t resolve your issue, submit a support ticket and the
                IT team will assist you directly.
              </p>
              <Link href="/tickets/new" style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                color: "var(--brand)", fontWeight: 750, fontSize: ".85rem",
              }}>
                Submit a ticket <ArrowLeft size={14} style={{ transform: "rotate(180deg)" }} aria-hidden="true" />
              </Link>
            </div>

          </aside>
        </div>
      </main>
    </>
  );
}
