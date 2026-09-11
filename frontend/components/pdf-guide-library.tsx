"use client";

import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, ExternalLink, FileText, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Guide } from "@/lib/admin-api";

export function PdfGuideLibrary({ guides }: { guides: Guide[] }) {
  const [selected, setSelected] = useState<Guide | null>(null);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  return (
    <>
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
              <button className="guide-open-button" disabled={!guide.pdf_url} onClick={() => setSelected(guide)}>Read PDF guide <ExternalLink aria-hidden="true" /></button>
            </div>
          </motion.article>
        ))}
      </div>

      <AnimatePresence>
        {selected?.pdf_url && (
          <motion.div className="pdf-viewer-backdrop" role="dialog" aria-modal="true" aria-label={selected.title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
            <motion.section className="pdf-viewer" initial={{ opacity: 0, y: 28, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} transition={{ type: "spring", stiffness: 320, damping: 30 }}>
              <header><div><span>Help guide</span><h2>{selected.title}</h2></div><div><a href={selected.pdf_url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open in new tab</a><button aria-label="Close PDF viewer" onClick={() => setSelected(null)}><X aria-hidden="true" /></button></div></header>
              <iframe src={`${selected.pdf_url}#view=FitH`} title={selected.title} />
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
