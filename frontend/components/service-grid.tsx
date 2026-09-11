"use client";

import { Badge, Camera, KeyRound, Laptop, LifeBuoy, Wifi } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { Service } from "@/lib/services";

const icons = { "key-round": KeyRound, laptop: Laptop, badge: Badge, wifi: Wifi, camera: Camera, "life-buoy": LifeBuoy };

export function ServiceGrid({ services }: { services: Service[] }) {
  const reducedMotion = useReducedMotion();
  return (
    <div className="service-grid">
      {services.map((service, index) => {
        const Icon = icons[service.icon as keyof typeof icons] ?? LifeBuoy;
        return (
          <motion.article
            className="service-card"
            key={service.slug}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: reducedMotion ? 0 : Math.min(index * 0.04, 0.2) }}
          >
            <span className="service-icon"><Icon aria-hidden="true" /></span>
            <div className="service-copy">
              <p className="eyebrow">{service.audience === "staff" ? "Faculty & staff" : service.audience === "public" ? "Available without sign-in" : "Students & staff"}</p>
              <h3>{service.name}</h3>
              <p>{service.summary}</p>
            </div>
            <Link href={`/tickets/new?service=${service.slug}`} aria-label={`Request ${service.name}`}>
              Request help <span aria-hidden="true">→</span>
            </Link>
          </motion.article>
        );
      })}
    </div>
  );
}
