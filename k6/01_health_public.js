/**
 * 01_health_public.js
 * ───────────────────
 * Tests that require NO authentication:
 *   - Health check
 *   - CSRF endpoint
 *   - Public service category list
 *   - Public guides list
 *   - Public software list
 *   - Site settings (office hours)
 *   - Active announcement
 *   - Service status board
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { API } from "./helpers.js";

export const options = {
  vus: 5,
  duration: "20s",
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

export default function () {
  // ── Health ─────────────────────────────────────────────────────────────
  group("health", () => {
    const res = http.get(`${API}/health/`);
    check(res, {
      "health 200":          (r) => r.status === 200,
      "health status ok":    (r) => {
        try { return JSON.parse(r.body).status === "ok"; } catch { return false; }
      },
    });
  });

  // ── CSRF ───────────────────────────────────────────────────────────────
  group("csrf", () => {
    const res = http.get(`${API}/auth/csrf/`);
    check(res, {
      "csrf 200":        (r) => r.status === 200,
      "csrf has detail": (r) => {
        try { const b = JSON.parse(r.body); return typeof b.detail === "string"; }
        catch { return false; }
      },
    });
  });

  // ── Public services ────────────────────────────────────────────────────
  group("services", () => {
    const res = http.get(`${API}/services/`);
    check(res, {
      "services 200":         (r) => r.status === 200,
      "services is array":    (r) => {
        try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
      },
    });
  });

  // ── Public guides ──────────────────────────────────────────────────────
  group("guides", () => {
    const res = http.get(`${API}/guides/`);
    check(res, {
      "guides 200":      (r) => r.status === 200,
      "guides is array": (r) => {
        try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
      },
    });
  });

  // ── Public software ────────────────────────────────────────────────────
  group("software", () => {
    const res = http.get(`${API}/software/`);
    check(res, {
      "software 200":      (r) => r.status === 200,
      "software is array": (r) => {
        try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
      },
    });
  });

  // ── Site settings (public) ─────────────────────────────────────────────
  group("site_settings", () => {
    const res = http.get(`${API}/settings/site/`);
    check(res, {
      "site settings 200": (r) => r.status === 200,
    });
  });

  // ── Announcement ───────────────────────────────────────────────────────
  group("announcement", () => {
    const res = http.get(`${API}/announcement/`);
    // 200 with data or 204 with no active announcement — both valid
    check(res, {
      "announcement 200 or 204": (r) => r.status === 200 || r.status === 204,
    });
  });

  // ── Service status board ───────────────────────────────────────────────
  group("status_board", () => {
    const res = http.get(`${API}/status/`);
    check(res, {
      "status board 200": (r) => r.status === 200,
    });
  });

  sleep(1);
}
