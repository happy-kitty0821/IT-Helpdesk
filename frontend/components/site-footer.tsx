import Link from "next/link";
import { Mail, MapPin } from "lucide-react";

// ── Link columns ──────────────────────────────────────────────────────────────

const COLUMNS = [
  {
    heading: "Get support",
    links: [
      { href: "/services",       label: "All services" },
      { href: "/tickets/new",    label: "Submit a request" },
      { href: "/tickets",        label: "My tickets" },
      { href: "/dashboard",      label: "My dashboard" },
    ],
  },
  {
    heading: "Self-service",
    links: [
      { href: "/help",           label: "Help guides" },
      { href: "/software",       label: "Software catalogue" },
    ],
  },
  {
    heading: "Services",
    links: [
      { href: "/services/account-recovery",  label: "Account recovery" },
      { href: "/services/device-support",    label: "Device support" },
      { href: "/services/id-card-replacement", label: "ID card replacement" },
      { href: "/services/wifi-issue",        label: "Wi-Fi issue" },
      { href: "/services/cctv-review",       label: "CCTV review" },
      { href: "/services/general-support",   label: "General IT support" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/login",          label: "Sign in" },
      { href: "/register",       label: "Create account" },
      { href: "/profile",        label: "My profile" },
      { href: "/forgot-password", label: "Forgot password" },
      { href: "/contact",        label: "Contact IT & NOC" },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="shell site-footer-inner">

        {/* ── Brand column ── */}
        <div className="site-footer-brand">
          {/* Logo / wordmark */}
          <div className="site-footer-logo" aria-label="IIC IT & NOC Helpdesk">
            <span className="site-footer-logo-badge" aria-hidden="true">IIC</span>
            <div>
              <strong>IT &amp; NOC Helpdesk</strong>
              <small>Itahari International College</small>
            </div>
          </div>

          <p className="site-footer-tagline">
            Your first point of contact for IT support, account help, and
            self-service resources at IIC.
          </p>

          {/* Contact strip */}
          <address className="site-footer-contact">
            <a href="mailto:support@iic.edu.np" className="site-footer-contact-item">
              <Mail size={14} aria-hidden="true" />
              support@iic.edu.np
            </a>
            <span className="site-footer-contact-item">
              <MapPin size={14} aria-hidden="true" />
              IT &amp; NOC Dept, Itahari, Sunsari, Nepal
            </span>
          </address>
        </div>

        {/* ── Link columns ── */}
        <nav className="site-footer-nav" aria-label="Footer navigation">
          {COLUMNS.map((col) => (
            <div key={col.heading} className="site-footer-col">
              <h3 className="site-footer-col-heading">{col.heading}</h3>
              <ul>
                {col.links.map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href} className="site-footer-link">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

      </div>

      {/* ── Bottom bar ── */}
      <div className="site-footer-bar">
        <div className="shell site-footer-bar-inner">
          <span>© {year} Itahari International College · IT &amp; NOC Department</span>
          <span className="site-footer-bar-links">
            <Link href="/contact">Contact</Link>
            <Link href="/help">Help guides</Link>
            <Link href="/software">Software</Link>
            <Link href="/services">Services</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
