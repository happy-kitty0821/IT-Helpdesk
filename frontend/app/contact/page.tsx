import type { Metadata } from "next";
import {
  Clock, Mail, MapPin, MessageSquare, Phone, ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Contact IT & NOC Support",
  description: "Visit the IIC IT & NOC department in person, email us, or submit a support ticket online. Office hours, location, and direct contact details.",
  openGraph: {
    title:       "Contact · IIC IT & NOC Helpdesk",
    description: "Office hours, location, email and walk-in details for the IIC IT & NOC support team.",
    url:         "/contact",
  },
  alternates: { canonical: "/contact" },
};

// ── Data ──────────────────────────────────────────────────────────────────────

const HOURS = [
  { day: "Sunday",    hours: "10:00 AM – 4:00 PM" },
  { day: "Monday",    hours: "10:00 AM – 4:00 PM" },
  { day: "Tuesday",   hours: "10:00 AM – 4:00 PM" },
  { day: "Wednesday", hours: "10:00 AM – 4:00 PM" },
  { day: "Thursday",  hours: "10:00 AM – 4:00 PM" },
  { day: "Friday",    hours: "10:00 AM – 4:00 PM" },
  { day: "Saturday",  hours: "Closed" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContactPage() {
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

        {/* ── Grid ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 20,
          marginBottom: 48,
        }}>

          {/* Location */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "28px 28px 24px",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "var(--brand-soft)", display: "grid", placeItems: "center", marginBottom: 18,
            }}>
              <MapPin size={20} style={{ color: "var(--brand)" }} aria-hidden="true" />
            </div>
            <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 8px" }}>Office location</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 6px", fontSize: ".95rem", lineHeight: 1.65 }}>
              IT &amp; NOC Department<br />
              Itahari International College, ING<br />
              Itahari, Sunsari, Nepal
            </p>
          </div>

          {/* Email */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "28px 28px 24px",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "var(--brand-soft)", display: "grid", placeItems: "center", marginBottom: 18,
            }}>
              <Mail size={20} style={{ color: "var(--brand)" }} aria-hidden="true" />
            </div>
            <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 8px" }}>Email</h2>
            <a
              href="mailto:support@iic.edu.np"
              style={{ color: "var(--brand)", fontWeight: 700, fontSize: ".95rem", textDecoration: "none" }}
            >
              support@iic.edu.np
            </a>
            <p style={{ color: "var(--muted)", margin: "8px 0 0", fontSize: ".88rem" }}>
              For general IT enquiries and follow-ups.
            </p>
          </div>

          {/* Ticket */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "28px 28px 24px",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "var(--brand-soft)", display: "grid", placeItems: "center", marginBottom: 18,
            }}>
              <MessageSquare size={20} style={{ color: "var(--brand)" }} aria-hidden="true" />
            </div>
            <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 8px" }}>Submit a ticket</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 14px", fontSize: ".88rem", lineHeight: 1.6 }}>
              The fastest way to get help. Track progress, reply, and receive email updates.
            </p>
            <Link href="/tickets/new" className="primary-button" style={{
              display: "inline-flex", alignItems: "center", gap: 7, fontSize: ".88rem",
            }}>
              <MessageSquare size={15} aria-hidden="true" /> Open a request
            </Link>
          </div>

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
                {HOURS.map(({ day, hours }) => (
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

          {/* Notes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <div style={{
              background: "#eff6ff", border: "1px solid #bfdbfe",
              borderRadius: 14, padding: "20px 22px",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <ShieldCheck size={20} style={{ color: "#1d4ed8", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <div>
                  <h3 style={{ margin: "0 0 6px", fontSize: ".92rem", fontWeight: 800, color: "#1e3a8a" }}>
                    Account recovery — visit in person
                  </h3>
                  <p style={{ margin: 0, fontSize: ".85rem", color: "#1e40af", lineHeight: 1.65 }}>
                    If you are locked out of your IIC college account, please visit us in person
                    with a valid college ID. Identity must be verified by staff before any account
                    changes are made.
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              background: "#fef9c3", border: "1px solid #fde047",
              borderRadius: 14, padding: "20px 22px",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <Phone size={20} style={{ color: "#854d0e", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <div>
                  <h3 style={{ margin: "0 0 6px", fontSize: ".92rem", fontWeight: 800, color: "#713f12" }}>
                    Walk-in support
                  </h3>
                  <p style={{ margin: 0, fontSize: ".85rem", color: "#78350f", lineHeight: 1.65 }}>
                    Walk-in support is available during office hours for urgent device issues,
                    hardware drop-offs, and ID card replacements.
                    We recommend submitting a ticket in advance for faster service.
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, padding: "20px 22px",
            }}>
              <h3 style={{ margin: "0 0 8px", fontSize: ".92rem", fontWeight: 800 }}>
                Accessibility support
              </h3>
              <p style={{ margin: 0, fontSize: ".85rem", color: "var(--muted)", lineHeight: 1.65 }}>
                If you need assistance accessing this service, please email{" "}
                <a href="mailto:support@iic.edu.np" style={{ color: "var(--brand)", fontWeight: 700 }}>
                  support@iic.edu.np
                </a>{" "}
                or visit the IT &amp; NOC office directly.
              </p>
            </div>

          </div>
        </div>
      </main>
    </>
  );
}
