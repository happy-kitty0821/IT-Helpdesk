import type { Metadata, Viewport } from "next";
import "./globals.css";

// ── Site constants ─────────────────────────────────────────────────────────────
const SITE_URL  = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_DJANGO_URL ?? "https://ithelpdesk-iic.cloud-dev.tech";
const SITE_NAME = "IIC IT & NOC Helpdesk";
const SITE_DESC = "IT support, service requests, and self-service guides for Itahari International College students and staff.";

// ── Root metadata ─────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  title: {
    default:  SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESC,
  keywords: [
    "IIC helpdesk", "Itahari International College IT support",
    "college IT helpdesk Nepal", "IIC NOC", "student IT support",
    "Wi-Fi issue", "laptop support", "ID card replacement",
    "account recovery IIC", "IIC email support",
  ],
  authors: [{ name: "Itahari International College IT & NOC Department" }],
  creator:  "IIC IT & NOC Department",
  publisher: "Itahari International College",

  // ── Open Graph ──────────────────────────────────────────────────────────────
  openGraph: {
    type:        "website",
    url:         SITE_URL,
    siteName:    SITE_NAME,
    title:       SITE_NAME,
    description: SITE_DESC,
    locale:      "en_US",
    images: [
      {
        url:    "/og-image.png",   // place a 1200×630 image in public/
        width:  1200,
        height: 630,
        alt:    "IIC IT & NOC Helpdesk",
      },
    ],
  },

  // ── Twitter card ────────────────────────────────────────────────────────────
  twitter: {
    card:        "summary_large_image",
    title:       SITE_NAME,
    description: SITE_DESC,
    images:      ["/og-image.png"],
  },

  // ── Canonical + alternate ───────────────────────────────────────────────────
  alternates: {
    canonical: SITE_URL,
  },

  // ── Crawler directives ──────────────────────────────────────────────────────
  robots: {
    index:          true,
    follow:         true,
    googleBot: {
      index:             true,
      follow:            true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet":       -1,
    },
  },

  // ── Icons ───────────────────────────────────────────────────────────────────
  icons: {
    icon:        "/favicon.ico",
    shortcut:    "/favicon.ico",
    apple:       "/apple-touch-icon.png",
  },

  // ── Verification (add your Google Search Console ID when available) ─────────
  // verification: { google: "YOUR_VERIFICATION_TOKEN" },
};

// ── Viewport (separate export for Next 14+) ───────────────────────────────────
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#234395" },
    { media: "(prefers-color-scheme: dark)",  color: "#0b1220" },
  ],
  width:        "device-width",
  initialScale: 1,
};

// ── Root layout ───────────────────────────────────────────────────────────────
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
