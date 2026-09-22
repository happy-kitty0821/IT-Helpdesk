"use client";

import { Badge, Camera, KeyRound, Laptop, LifeBuoy, Wifi } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { Service } from "@/lib/services";
import { staggerContainer, staggerItem } from "@/lib/animations";

const icons = {
  "key-round": KeyRound,
  laptop:      Laptop,
  badge:       Badge,
  wifi:        Wifi,
  camera:      Camera,
  "life-buoy": LifeBuoy,
};

export function ServiceGrid({ services }: { services: Service[] }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className="service-grid"
      variants={reducedMotion ? undefined : staggerContainer}
      initial={reducedMotion ? false : "hidden"}
      animate="show"
    >
      {services.map((service) => {
        const Icon = icons[service.icon as keyof typeof icons] ?? LifeBuoy;
        return (
          <motion.article
            className="service-card"
            key={service.slug}
            variants={reducedMotion ? undefined : staggerItem}
            whileHover={reducedMotion ? undefined : { y: -4, transition: { duration: 0.18 } }}
          >
            <span className="service-icon"><Icon aria-hidden="true" /></span>
            <div className="service-copy">
              <p className="eyebrow">
                {service.audience === "staff"
                  ? "Faculty & staff"
                  : service.audience === "public"
                    ? "Available without sign-in"
                    : "Students & staff"}
              </p>
              <h3>{service.name}</h3>
              <p>{service.summary}</p>
            </div>
            <Link href={`/tickets/new?service=${service.slug}`} aria-label={`Request ${service.name}`}>
              Request help <span aria-hidden="true">→</span>
            </Link>
          </motion.article>
        );
      })}
    </motion.div>
  );
}
