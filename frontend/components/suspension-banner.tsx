"use client";

/**
 * SuspensionBanner
 *
 * Shown at the top of every page for a signed-in user whose account has been
 * marked as suspended (is_suspended=true on their UserProfile).
 *
 * This handles the edge case where someone still has a valid session cookie
 * from before the suspension was applied, or where Google SSO re-authenticated
 * them. The banner does NOT block interaction — the user can still sign out —
 * but makes the situation unmistakably clear.
 */

import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";

interface Props {
  reason?: string;
}

export function SuspensionBanner({ reason }: Props) {
  return (
    <motion.div
      role="alert"
      aria-live="assertive"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      style={{
        background: "linear-gradient(135deg, #7f1d1d, #991b1b)",
        color: "#fff",
        padding: "14px 0",
        position: "relative",
        zIndex: 30,
      }}
    >
      <div
        className="shell"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <AlertTriangle
          aria-hidden="true"
          style={{ flexShrink: 0, width: 20, height: 20, marginTop: 2 }}
        />
        <div>
          <strong style={{ display: "block", fontSize: ".95rem", marginBottom: 4 }}>
            Your account has been suspended
          </strong>
          {reason ? (
            <p style={{ margin: 0, fontSize: ".88rem", color: "#fecaca", lineHeight: 1.5 }}>
              {reason}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: ".88rem", color: "#fecaca", lineHeight: 1.5 }}>
              Please visit the <strong style={{ color: "#fff" }}>IIC IT &amp; NOC department in person</strong> to
              have your account reviewed and reinstated.
            </p>
          )}
          <p style={{ margin: "6px 0 0", fontSize: ".82rem", color: "#fca5a5" }}>
            If you believe this is a mistake, visit the IT &amp; NOC helpdesk counter during office hours.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
