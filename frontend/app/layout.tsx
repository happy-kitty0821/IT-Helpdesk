import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IIC IT & NOC Helpdesk",
  description: "IT support, service requests, and self-service resources for Itahari International College.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
