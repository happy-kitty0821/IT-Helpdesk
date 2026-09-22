"use client";

/**
 * Client wrapper that animates the resource-strip section with a stagger reveal
 * triggered when the section scrolls into view.
 */
import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { staggerContainer, staggerItem } from "@/lib/animations";

export function ResourceStripAnimated({ children }: { children: React.ReactNode }) {
  const ref  = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.section
      ref={ref}
      className="resource-strip shell"
      aria-label="Self-service resources"
      variants={staggerContainer}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
    >
      {(Array.isArray(children) ? children : [children]).map((child, i) => (
        <motion.div key={i} variants={staggerItem} style={{ display: "contents" }}>
          {child}
        </motion.div>
      ))}
    </motion.section>
  );
}
