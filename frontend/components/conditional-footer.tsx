"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";

/**
 * Renders SiteFooter on every route EXCEPT the /admin/* subtree.
 * Admin pages use AdminShell which has its own full-viewport layout.
 */
export function ConditionalFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  return <SiteFooter />;
}
