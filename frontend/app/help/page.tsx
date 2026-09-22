import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { PdfGuideLibrary } from "@/components/pdf-guide-library";
import { SiteHeader } from "@/components/site-header";
import { getGuides } from "@/lib/content";

export const metadata: Metadata = {
  title: "Help Guides",
  description: "Browse step-by-step PDF guides from the IIC IT & NOC team — MFA setup, account recovery, Wi-Fi configuration, and more.",
  openGraph: {
    title:       "Help Guides · IIC IT & NOC Helpdesk",
    description: "PDF setup guides and how-to articles from the IIC IT & NOC team.",
    url:         "/help",
  },
  alternates: { canonical: "/help" },
};

export default async function HelpPage() {
  const guides = await getGuides();
  return (
    <>
      <SiteHeader />
      <main className="catalog-page shell page-enter">
        <header>
          <p className="eyebrow">Self-service library</p>
          <h1>Help guides</h1>
          <p>Open reviewed PDF instructions from the IIC IT &amp; NOC team without leaving the helpdesk.</p>
        </header>
        {guides.length
          ? <PdfGuideLibrary guides={guides} />
          : (
            <div className="catalog-empty">
              <BookOpen aria-hidden="true" />
              <h2>No guides published yet</h2>
              <p>Published PDF guides will appear here after an administrator reviews them.</p>
            </div>
          )
        }
      </main>
    </>
  );
}
