import type { Metadata } from "next";
import { Mail, MapPin, Clock, Phone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Contact — IIC IT & NOC Support",
  description:
    "Visit the IIC IT & NOC department in person, email us, or submit a support ticket. "
    + "Office hours, location, and direct contact details.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title:       "Contact · IIC IT & NOC Helpdesk",
    description: "Walk-in hours, location, and email for the IIC IT & NOC support team.",
    url:         "/contact",
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SiteSettings {
  office_hours?: { day: string; hours: string }[];
  support_email?: string;
  office_location?: string;
  office_phone?: string;
}

// ── Server-side data fetch ────────────────────────────────────────────────────

async function getSiteSettings(): Promise<SiteSettings> {
  const FALLBACK: SiteSettings = {
    support_email:   "support@iic.edu.np",
    office_location: "IIC IT & NOC Department, Itahari International College",
    office_phone:    "",
    office_hours: [
      { day: "Sunday",    hours: "10:00 AM – 4:00 PM" },
      { day: "Monday",    hours: "10:00 AM – 4:00 PM" },
      { day: "Tuesday",   hours: "10:00 AM – 4:00 PM" },
      { day: "Wednesday", hours: "10:00 AM – 4:00 PM" },
      { day: "Thursday",  hours: "10:00 AM – 4:00 PM" },
      { day: "Friday",    hours: "10:00 AM – 4:00 PM" },
      { day: "Saturday",  hours: "Closed" },
    ],
  };
  try {
    const res = await fetch(
      `${process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000"}/api/v1/settings/site/`,
      { cache: "no-store" },
    );
    if (!res.ok) return FALLBACK;
    const data = await res.json() as Partial<SiteSettings>;
    return {
      ...FALLBACK,
      ...data,
      office_hours:
        Array.isArray(data.office_hours) && data.office_hours.length > 0
          ? data.office_hours
          : FALLBACK.office_hours,
    };
  } catch {
    return FALLBACK;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ContactPage() {
  const settings = await getSiteSettings();

  return (
    <>
      <SiteHeader />
      <main className="shell" style={{ paddingBlock: "48px 80px" }}>

        {/* ── Heading ── */}
        <div style={{ marginBottom: 40 }}>
          <p style={{ margin: "0 0 6px", fontSize: ".78rem", fontWeight: 800, color: "var(--brand)", textTransform: "uppercase", letterSpacing: ".1em" }}>
            Get in touch
          </p>
          <h1 style={{ margin: "0 0 12px", fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: "-.04em", lineHeight: 1.15 }}>
            Contact IT &amp; NOC Support
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", maxWidth: 560, lineHeight: 1.7 }}>
            The quickest way to get help is to{" "}
            <a href="/tickets/new" style={{ color: "var(--brand)", fontWeight: 700, textDecoration: "none" }}>
              submit a support ticket
            </a>
            . For urgent issues or in-person assistance, you can also reach us
            directly using the details below.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>

          {/* Email */}
          {settings.support_email && (
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 16, padding: "24px 26px",
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "var(--brand-soft, #eff6ff)",
                display: "grid", placeItems: "center", marginBottom: 16,
              }}>
                <Mail size={20} color="var(--brand)" aria-hidden="true" />
              </div>
              <h2 style={{ margin: "0 0 6px", fontSize: "1rem", fontWeight: 800 }}>Email us</h2>
              <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: ".9rem", lineHeight: 1.6 }}>
                Send us an email for non-urgent queries. We aim to respond within one business day.
              </p>
              <a
                href={`mailto:${settings.support_email}`}
                style={{ color: "var(--brand)", fontWeight: 700, fontSize: ".92rem", wordBreak: "break-all" }}
              >
                {settings.support_email}
              </a>
            </div>
          )}

          {/* Location */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "24px 26px",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "var(--brand-soft, #eff6ff)",
              display: "grid", placeItems: "center", marginBottom: 16,
            }}>
              <MapPin size={20} color="var(--brand)" aria-hidden="true" />
            </div>
            <h2 style={{ margin: "0 0 6px", fontSize: "1rem", fontWeight: 800 }}>Walk in</h2>
            <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: ".9rem", lineHeight: 1.6 }}>
              Bring a valid college ID for in-person support requests. No appointment needed during office hours.
            </p>
            <p style={{ margin: 0, fontSize: ".92rem", fontWeight: 600, lineHeight: 1.6 }}>
              {settings.office_location ?? "IIC IT & NOC Department"}
            </p>
            {settings.office_phone && (
              <p style={{ margin: "6px 0 0", fontSize: ".88rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <Phone size={14} aria-hidden="true" />
                {settings.office_phone}
              </p>
            )}
          </div>

          {/* Office hours */}
          {settings.office_hours && settings.office_hours.length > 0 && (
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 16, padding: "24px 26px",
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "var(--brand-soft, #eff6ff)",
                display: "grid", placeItems: "center", marginBottom: 16,
              }}>
                <Clock size={20} color="var(--brand)" aria-hidden="true" />
              </div>
              <h2 style={{ margin: "0 0 14px", fontSize: "1rem", fontWeight: 800 }}>Office hours</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {settings.office_hours.map(({ day, hours }) => (
                    <tr key={day} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "7px 0", fontSize: ".88rem", fontWeight: 600, color: "var(--foreground)" }}>
                        {day}
                      </td>
                      <td style={{ padding: "7px 0", fontSize: ".88rem", color: hours === "Closed" ? "var(--muted)" : "var(--foreground)", textAlign: "right" }}>
                        {hours}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: "12px 0 0", fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.6 }}>
                All times are Nepal Standard Time (NST, UTC+5:45).
              </p>
            </div>
          )}

        </div>

        {/* ── Submit ticket CTA ── */}
        <div style={{
          marginTop: 40, background: "#eff6ff", border: "1px solid #bfdbfe",
          borderRadius: 16, padding: "28px 32px",
          display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: "1rem", color: "#1e40af" }}>
              Have a support issue?
            </p>
            <p style={{ margin: 0, color: "#3b5bdb", fontSize: ".9rem", lineHeight: 1.6 }}>
              Submit a ticket online and track its progress in real time.
              Most requests are responded to within one business day.
            </p>
          </div>
          <a
            href="/tickets/new"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#234395", color: "#fff",
              fontWeight: 700, fontSize: ".92rem",
              padding: "12px 22px", borderRadius: 10, textDecoration: "none",
              flexShrink: 0,
            }}
          >
            Submit a ticket →
          </a>
        </div>

      </main>
    </>
  );
}
