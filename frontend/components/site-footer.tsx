"use client";

import Link from "next/link";
import { Mail, MapPin } from "lucide-react";
import { useEffect, useState } from "react";

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
      { href: "/status",         label: "Service status" },
      { href: "/contact",        label: "Contact IT & NOC" },
    ],
  },
];

// ── Site settings fetched from the backend ─────────────────────────────────

interface SiteSettings {
  support_email: string;
  office_location: string;
  office_phone: string;
  institution_name: string;
  department_name: string;
  helpdesk_tagline: string;
}

const DEFAULT_SETTINGS: SiteSettings = {
  support_email: "support@iic.edu.np",
  office_location: "IT & NOC Department, Itahari International College, ING, Itahari, Sunsari, Nepal",
  office_phone: "",
  institution_name: "Itahari International College",
  department_name: "IT & NOC Department",
  helpdesk_tagline:
    "Your first point of contact for IT support, account help, and self-service resources at IIC.",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function SiteFooter() {
  const year = new Date().getFullYear();
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let mounted = true;
    fetch("/api/v1/settings/site/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Partial<SiteSettings> | null) => {
        if (mounted && data) {
          setSettings((prev) => ({
            support_email:     data.support_email     ?? prev.support_email,
            office_location:   data.office_location   ?? prev.office_location,
            office_phone:      data.office_phone      ?? prev.office_phone,
            institution_name:  data.institution_name  ?? prev.institution_name,
            department_name:   data.department_name    ?? prev.department_name,
            helpdesk_tagline:  data.helpdesk_tagline   ?? prev.helpdesk_tagline,
          }));
        }
      })
      .catch(() => {/* keep defaults on error */});
    return () => { mounted = false; };
  }, []);

  // Short label for the address line (strip the long prefix used in admin)
  const shortLocation = settings.office_location
    .replace(/Itahari International College,?\s*/i, "")
    .replace(/ING,?\s*/i, "");

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="shell site-footer-inner">

        {/* ── Brand column ── */}
        <div className="site-footer-brand">
          {/* Logo / wordmark */}
          <div className="site-footer-logo" aria-label="IIC IT & NOC Helpdesk">
            <span className="site-footer-logo-badge" aria-hidden="true">IIC</span>
            <div>
              <strong>{settings.department_name}</strong>
              <small>{settings.institution_name}</small>
            </div>
          </div>

          <p className="site-footer-tagline">
            {settings.helpdesk_tagline}
          </p>

          {/* Contact strip */}
          <address className="site-footer-contact">
            <a
              href={`mailto:${settings.support_email}`}
              className="site-footer-contact-item"
            >
              <Mail size={14} aria-hidden="true" />
              {settings.support_email}
            </a>
            <span className="site-footer-contact-item">
              <MapPin size={14} aria-hidden="true" />
              {shortLocation || settings.office_location}
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
          <span>© {year} {settings.institution_name} · {settings.department_name}</span>
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
