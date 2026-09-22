/**
 * Shared Framer Motion variants and helpers used across user-facing pages.
 * Import from "@/lib/animations".
 */
import type { Variants } from "motion/react";

// ── Fade + slide up (most common page element reveal) ─────────────────────────
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 22 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
};

// ── Fade in only (for panels / cards) ─────────────────────────────────────────
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.35, ease: "easeOut" } },
};

// ── Slide in from right (editor panels, sidebars) ─────────────────────────────
export const slideRight: Variants = {
  hidden: { opacity: 0, x: 28, scale: 0.985 },
  show:   { opacity: 1, x: 0,  scale: 1,    transition: { type: "spring", stiffness: 340, damping: 32 } },
};

// ── Stagger container — wraps a list of children ──────────────────────────────
export const staggerContainer: Variants = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

// ── Stagger item — used inside a staggerContainer ─────────────────────────────
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] } },
};

// ── Scale pop (confirmation icons, success states) ────────────────────────────
export const scalePop: Variants = {
  hidden: { opacity: 0, scale: 0.7 },
  show:   { opacity: 1, scale: 1,   transition: { type: "spring", stiffness: 420, damping: 20 } },
};

// ── Hero stagger — slightly slower for large headings ─────────────────────────
export const heroContainer: Variants = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

export const heroItem: Variants = {
  hidden: { opacity: 0, y: 30 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.52, ease: [0.22, 1, 0.36, 1] } },
};
