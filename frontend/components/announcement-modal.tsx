"use client";

/**
 * AnnouncementModal
 *
 * Fetches GET /api/v1/announcement/ on mount.
 * Shows a lightbox when:
 *   - the endpoint returns an active announcement, AND
 *   - the dismissal cookie for this campaign_id is absent.
 *
 * On dismiss (X / backdrop / Escape) writes:
 *   announcement_seen_<campaign_id>=1; Max-Age=21600; Path=/; SameSite=Lax[; Secure]
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnnouncementData {
  id: number;
  campaign_id: string;
  title: string;
  image_url: string | null;
  alt_text: string;
  link_url: string;
  is_active: boolean;
  updated_at: string;
}

// ── Cookie helpers ─────────────────────────────────────────────────────────────

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(name + "="));
  return match ? match.split("=")[1] : undefined;
}

function setDismissalCookie(campaignId: string) {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `announcement_seen_${campaignId}=1; Max-Age=21600; Path=/; SameSite=Lax${secure}`;
}

function hasDismissed(campaignId: string): boolean {
  return getCookie(`announcement_seen_${campaignId}`) === "1";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnnouncementModal() {
  const [data, setData]       = useState<AnnouncementData | null>(null);
  const [visible, setVisible] = useState(false);

  const closeButtonRef   = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ── Fetch on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/v1/announcement/", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (res.status === 204) return;
        if (!res.ok) return;
        const ann: AnnouncementData = await res.json();
        if (!ann.is_active) return;
        if (hasDismissed(ann.campaign_id)) return;
        setData(ann);
        setVisible(true);
      })
      .catch(() => { /* non-critical — silently swallow */ });
  }, []);

  // ── Focus trap + Escape ────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { dismiss(); return; }
      if (e.key !== "Tab") return;

      const modal = document.getElementById("ann-dialog");
      if (!modal) return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Dismiss ────────────────────────────────────────────────────────────────
  function dismiss() {
    if (data) setDismissalCookie(data.campaign_id);
    setVisible(false);
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {visible && data && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            key="ann-backdrop"
            className="ann-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={dismiss}
          />

          {/*
            ── Centering wrapper ──
            A plain fixed div handles the viewport centering via flex so that
            Framer Motion's own transform (scale + y) on the inner motion.div
            does NOT clobber the translate(-50%,-50%) trick.
          */}
          <div
            className="ann-centering"
            aria-hidden="true"   /* the real dialog is inside */
          >
            <motion.div
              key="ann-dialog"
              id="ann-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={data.title || "Announcement"}
              aria-hidden={false}
              className="ann-card"
              initial={{ opacity: 0, scale: 0.93, y: 18 }}
              animate={{ opacity: 1, scale: 1,    y: 0  }}
              exit={{    opacity: 0, scale: 0.93, y: 12 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                ref={closeButtonRef}
                className="ann-close"
                aria-label="Close announcement"
                onClick={dismiss}
              >
                <X size={18} aria-hidden="true" />
              </button>

              {/* Banner image */}
              {data.image_url && (
                data.link_url ? (
                  <a
                    href={data.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ann-image-link"
                    onClick={dismiss}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={data.image_url}
                      alt={data.alt_text}
                      className="ann-image"
                    />
                  </a>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={data.image_url}
                    alt={data.alt_text}
                    className="ann-image"
                  />
                )
              )}

              {/* Dismiss hint */}
              <p className="ann-hint">
                This notice will not show again for 6 hours.
              </p>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
