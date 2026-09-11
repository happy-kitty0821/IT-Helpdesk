import { BookOpen } from "lucide-react";
import { PdfGuideLibrary } from "@/components/pdf-guide-library";
import { SiteHeader } from "@/components/site-header";
import { getGuides } from "@/lib/content";

export default async function HelpPage() {
  const guides = await getGuides();
  return (
    <>
      <SiteHeader />
      <main className="catalog-page shell">
        <header><p className="eyebrow">Self-service library</p><h1>Help guides</h1><p>Open reviewed PDF instructions from the IIC IT & NOC team without leaving the helpdesk.</p></header>
        {guides.length ? <PdfGuideLibrary guides={guides} /> : <div className="catalog-empty"><BookOpen aria-hidden="true" /><h2>No guides published yet</h2><p>Published PDF guides will appear here after an administrator reviews them.</p></div>}
      </main>
    </>
  );
}
