"use client";

import { motion } from "motion/react";
import { CalendarDays, ExternalLink, FileText, Tag } from "lucide-react";
import type { Guide } from "@/lib/admin-api";

function absolutePdfUrl(url: string | null): string | null {
  if (!url) return null;
  // Already an absolute URL - use as-is
  if (url.startsWith("http")) return url;
  // Relative path like /media/guides/... 
  // In local dev the Next.js proxy handles /media/* -> Django, so keep relative.
  // In production NEXT_PUBLIC_DJANGO_URL provides the origin (e.g. https://domain.com).
  const origin = process.env.NEXT_PUBLIC_DJANGO_URL ?? "";
  if (!origin || origin.includes("localhost") || origin.includes("127.0.0.1")) return url;
  return `${origin}${url}`;
}

export function PdfGuideLibrary({ guides }: { guides: Guide[] }) {
  return (
    <div className="catalog-grid pdf-catalog-grid">
      {guides.map((guide, index) => (
        <motion.article key={guide.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .06, .3) }}>
          <div className="public-pdf-icon"><FileText aria-hidden="true" /><span>PDF</span></div>
          <div>
            <span className="status-chip published">Published</span>
            <h2>{guide.title}</h2>
            <p>{guide.summary}</p>
            <div className="catalog-meta">
              <span><Tag aria-hidden="true" />{guide.tags.join(", ") || "General"}</span>
              {guide.reviewed_at && <span><CalendarDays aria-hidden="true" />Reviewed {guide.reviewed_at}</span>}
            </div>
            {guide.pdf_url
              ? <a href={absolutePdfUrl(guide.pdf_url)!} target="_blank" rel="noreferrer" className="guide-open-button">
                  Open PDF guide <ExternalLink aria-hidden="true" />
                </a>
              : <button className="guide-open-button" disabled>No PDF available</button>
            }
          </div>
        </motion.article>
      ))}
    </div>
  );
}