"use client";

import { motion } from "motion/react";
import { CalendarDays, ExternalLink, FileText, Tag } from "lucide-react";
import type { Guide } from "@/lib/admin-api";

const DJANGO_ORIGIN = process.env.NEXT_PUBLIC_DJANGO_URL ?? "http://127.0.0.1:8000";

function absolutePdfUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${DJANGO_ORIGIN}${url}`;
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