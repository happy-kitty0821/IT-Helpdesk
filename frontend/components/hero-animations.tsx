"use client";

/**
 * Thin client wrapper that animates the two hero children (hero-copy + quick-panel)
 * using a staggered reveal. The server component (app/page.tsx) passes them as
 * children so the HTML is still server-rendered for SEO.
 */
import { motion } from "motion/react";
import { heroContainer, heroItem } from "@/lib/animations";

export function HeroAnimations({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={heroContainer}
      initial="hidden"
      animate="show"
      style={{ display: "contents" }}
    >
      {/* Each direct child gets the heroItem reveal */}
      {(Array.isArray(children) ? children : [children]).map((child, i) => (
        <motion.div key={i} variants={heroItem} style={{ display: "contents" }}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
