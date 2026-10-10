import type { Metadata } from "next";
import {
  Clock, Mail, MapPin, MessageSquare, Phone, ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OfficeHourRow { day: string; hours: string; }

interface SiteSettings {
  support_email:         string;
  office_location:       string;
  office_phone:          string;
  office_hours:          OfficeHourRow[];
  walk_in_note:          string;
  accessibility_note:    string;
  account_recovery_note: string;
  institution_name:      string;
  department_name:       string;
}

// ── Hardcoded fallback (used when API is unreachable or DB row not seeded) ────

const FALLBACK: SiteSettings = {
  support_email:         "support@iic.edu.np",
  office_location:       "IT & NOC Department, Itahari International College, ING, Itahari, Sunsari, Nepal",
  office_phone:          "",
  office_hours: [
    { day: "Sunday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Monday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Tuesday",   hours: "10:00 AM – 4:00 PM" },
    { day: "Wednesday", hours: "10:00 AM – 4:00 PM" },
    { day: "Thursday",  hours: "10:00 AM – 4:00 PM" },
    { day: "Friday",    hours: "10:00 AM – 4:00 PM" },
    { day: "Saturday",  hours: "Closed" },
  ],
  walk_in_note: "Walk-in support is available during office hours for urgent device issues, hardware drop-offs, and ID card replacements. We recommend submitting a ticket in advance for faster service.",
  accessibility_note: "",
  account_recovery_note: "If you are locked out of your IIC college account, please visit us in person with a valid college ID. Identity must be verified by staff before any account changes are made.",
  institution_name: "Itahari International College",
  department_name:  "IT & NOC Department",
};

// ── Server-side data fetch ────────────────────────────────────────────────────

async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch(`${process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000"}/api/v1/settings/site/`, {
      cache: "no-store",
    });
    if (!res.ok) return FALLBACK;
    const data = await res.json() as Partial<SiteSettings>;
    // Merge with fallback so missing fields always have a value
    return {
      ...FALLBACK,
      ...data,
      // If office_hours is an empty array, fall back to hardcoded schedule
      office_hours:
        Array.isArray(data.office_hours) && data.office_hours.length > 0
          ? data.office_hours
          : FALLBACK.office_hours,
    };
  } catch {
    return FALLBACK;
  }
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Contact IT & NOC Support",
  description:
    "Visit the IIC IT & NOC department in person, email us, or submit a support ticket online. Office hours, location, and direct contact details.",
  openGraph: {
    title:       "Contact · IIC IT & NOC Helpdesk",
    description: "Office hours, location, email and walk-in details for the IIC IT & NOC support team.",
    url:         "/contact",
  },
  alternates: { canonical: "/contact" },
};

// ── Card wrapper ──────────────────────────────────────────────────────────────

function InfoCard({
  icon, heading, children,
}: { icon: React.ReactNode; heading: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 16, padding: "28px 28px 24px",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: "var(--brand-soft)", display: "grid", placeItems: "center", marginBottom: 18,
      }}>
        {icon}
      </div>
      <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 8px" }}>{heading}</h2>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ContactPage() {
  const s = await getSiteSettings();

  // Split multi-line location into separate lines for rendering
  const locationLines = s.office_location.split(",").map((l) => l.trim()).filter(Boolean);

  return (
    <>
      <SiteHeader />
      <main className="shell page-enter" style={{ paddingBlock: "56px 80px" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 48 }}>
          <p className="eyebrow">Get in touch</p>
          <h1 style={{ fontSize: "clamp(2.4rem,5vw,3.8rem)", letterSpacing: "-.045em", margin: "8px 0 14px" }}>
            Contact IT &amp; NOC support
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "1.05rem", maxWidth: 560, margin: 0 }}>
            Submit a ticket online for the fastest response, or visit us in person during office hours.
          </p>
        </div>

        {/* ── Top cards ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 20,
          marginBottom: 48,
        }}>

          {/* Location */}
          <InfoCard icon={<MapPin size={20} style={{ color: "var(--brand)" }} aria-hidden="true" />} heading="Office location">
            <address style={{ fontStyle: "normal", color: "var(--muted)", fontSize: ".95rem", lineHeight: 1.65 }}>
              {locationLines.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < locationLines.length - 1 && <br />}
                </span>
              ))}
            </address>
          </InfoCard>

          {/* Email + optional phone */}
          <InfoCard icon={<Mail size={20} style={{ color: "var(--brand)" }} aria-hidden="true" />} heading="Email">
            <a
              href={`mailto:${s.support_email}`}
              style={{ color: "var(--brand)", fontWeight: 700, fontSize: ".95rem", textDecoration: "none" }}
            >
              {s.support_email}
            </a>
            <p style={{ color: "var(--muted)", margin: "8px 0 0", fontSize: ".88rem" }}>
              For general IT enquiries and follow-ups.
            </p>
            {s.office_phone && (
              <p style={{ margin: "10px 0 0", display: "flex", alignItems: "center", gap: 6, fontSize: ".88rem", color: "var(--muted)" }}>
                <Phone size={14} aria-hidden="true" /> {s.office_phone}
              </p>
            )}
          </InfoCard>

          {/* Submit ticket */}
          <InfoCard icon={<MessageSquare size={20} style={{ color: "var(--brand)" }} aria-hidden="true" />} heading="Submit a ticket">
            <p style={{ color: "var(--muted)", margin: "0 0 14px", fontSize: ".88rem", lineHeight: 1.6 }}>
              The fastest way to get help. Track progress, reply, and receive email updates.
            </p>
            <Link href="/tickets/new" className="primary-button" style={{
              display: "inline-flex", alignItems: "center", gap: 7, fontSize: ".88rem",
            }}>
              <MessageSquare size={15} aria-hidden="true" /> Open a request
            </Link>
          </InfoCard>

        </div>

        {/* ── Office hours + notes ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20,
          alignItems: "start",
        }}>

          {/* Hours table */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, overflow: "hidden",
          }}>
            <div style={{
              padding: "20px 24px 16px", borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <Clock size={18} style={{ color: "var(--brand)" }} aria-hidden="true" />
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>Office hours</h2>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {s.office_hours.map(({ day, hours }) => (
                  <tr key={day} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 24px", fontSize: ".88rem", fontWeight: 700, color: "var(--foreground)" }}>
                      {day}
                    </td>
                    <td style={{
                      padding: "11px 24px", fontSize: ".88rem",
                      color: hours === "Closed" ? "var(--muted)" : "var(--foreground)",
                      textAlign: "right",
                    }}>
                      {hours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ padding: "12px 24px", margin: 0, fontSize: ".78rem", color: "var(--muted)" }}>
              Hours may vary during public holidays and exam periods.
            </p>
          </div>

          {/* Notes column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Account recovery note */}
            {s.account_recovery_note && (
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 14, padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <ShieldCheck size={20} style={{ color: "#1d4ed8", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                  <div>
                    <h3 style={{ margin: "0 0 6px", fontSize: ".92rem", fontWeight: 800, color: "#1e3a8a" }}>
                      Account recovery — visit in person
                    </h3>
                    <p style={{ margin: 0, fontSize: ".85rem", color: "#1e40af", lineHeight: 1.65 }}>
                      {s.account_recovery_note}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Walk-in note */}
            {s.walk_in_note && (
              <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 14, padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <Phone size={20} style={{ color: "#854d0e", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                  <div>
                    <h3 style={{ margin: "0 0 6px", fontSize: ".92rem", fontWeight: 800, color: "#713f12" }}>
                      Walk-in support
                    </h3>
                    <p style={{ margin: 0, fontSize: ".85rem", color: "#78350f", lineHeight: 1.65 }}>
                      {s.walk_in_note}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Accessibility note */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: ".92rem", fontWeight: 800 }}>
                Accessibility support
              </h3>
              <p style={{ margin: 0, fontSize: ".85rem", color: "var(--muted)", lineHeight: 1.65 }}>
                {s.accessibility_note
                  ? s.accessibility_note
                  : <>
                      If you need assistance accessing this service, please email{" "}
                      <a href={`mailto:${s.support_email}`} style={{ color: "var(--brand)", fontWeight: 700 }}>
                        {s.support_email}
                      </a>{" "}
                      or visit the {s.department_name} office directly.
                    </>
                }
              </p>
            </div>

          </div>
        </div>
      </main>
    </>
  );
}
