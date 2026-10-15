/**
 * 06_notifications.js
 * ─────────────────────
 * Notification system — admin-only endpoints:
 *   - Create a Discord notification channel
 *   - List channels
 *   - Update (PATCH) channel
 *   - List email templates
 *   - Create email template
 *   - Update template (toggle use_file_fallback)
 *   - Create routing rule
 *   - List routing rules
 *   - Toggle rule active/inactive
 *   - List notification logs
 *   - Delete channel (cleanup)
 *   - Non-admin access → 403
 *
 * Environment variables required:
 *   ADMIN_EMAIL, ADMIN_PASSWORD, STUDENT_EMAIL, STUDENT_PASSWORD
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import {
  API, login, logout, jsonPost, jsonPatch, jsonDelete, parseBody,
} from "./helpers.js";

export const options = {
  vus: 1,
  iterations: 2,
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

const ADMIN_EMAIL      = __ENV.ADMIN_EMAIL      || "admin@iic.edu.np";
const ADMIN_PASSWORD   = __ENV.ADMIN_PASSWORD   || "TestAdminPassword123!";
const STUDENT_EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";

export default function () {

  // ── Non-admin access guard ────────────────────────────────────────────
  group("non_admin_blocked", () => {
    const csrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);
    const res  = http.get(`${API}/admin/notifications/channels/`);
    check(res, {
      "student cannot access notification channels": (r) =>
        r.status === 403 || r.status === 401,
    });
    logout(csrf);
  });

  const csrf = login(ADMIN_EMAIL, ADMIN_PASSWORD);

  // ── Create channel ─────────────────────────────────────────────────────
  let channelId = null;
  group("create_channel", () => {
    const res  = jsonPost(`${API}/admin/notifications/channels/`, {
      name:      "k6 Test Discord Channel",
      type:      "discord",
      is_active: true,
      config:    { webhook_url: "https://discord.com/api/webhooks/k6test/placeholder" },
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "create channel 201":      (r) => r.status === 201,
      "channel has id":          () => typeof body.id === "number",
      "channel type is discord": () => body.type === "discord",
    });
    channelId = body.id;
  });

  // ── List channels ──────────────────────────────────────────────────────
  group("list_channels", () => {
    const res      = http.get(`${API}/admin/notifications/channels/`);
    const channels = parseBody(res);
    check(res, {
      "list channels 200":   (r) => r.status === 200,
      "channels is array":   () => Array.isArray(channels),
      "new channel present": () => Array.isArray(channels) &&
                                    channels.some((c) => c.id === channelId),
    });
  });

  // ── Update channel ─────────────────────────────────────────────────────
  group("update_channel", () => {
    if (!channelId) return;
    const res = jsonPatch(`${API}/admin/notifications/channels/${channelId}/`, {
      name: "k6 Test Discord Channel (updated)",
    }, csrf);
    check(res, { "update channel 200": (r) => r.status === 200 });
  });

  // ── List email templates ───────────────────────────────────────────────
  group("list_templates", () => {
    const res       = http.get(`${API}/admin/notifications/templates/`);
    const templates = parseBody(res);
    check(res, {
      "list templates 200":      (r) => r.status === 200,
      "templates is array":      () => Array.isArray(templates),
      "templates have event_type": () =>
        Array.isArray(templates) && templates.every((t) => typeof t.event_type === "string"),
      "templates have use_file_fallback": () =>
        Array.isArray(templates) && templates.every((t) => typeof t.use_file_fallback === "boolean"),
    });
  });

  // ── Create email template ──────────────────────────────────────────────
  let templateId = null;
  group("create_template", () => {
    const res  = jsonPost(`${API}/admin/notifications/templates/`, {
      event_type:          "ticket_stale",
      name:                "k6 Test Stale Alert",
      subject_template:    "k6 test: Ticket {{ticket_reference}} is overdue",
      body_html_template:  "<p>k6 test body for {{ticket_reference}}</p>",
      is_active:           false,
      use_file_fallback:   false,
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "create template 201":         (r) => r.status === 201,
      "template has id":             () => typeof body.id === "number",
      "template is inactive":        () => body.is_active === false,
      "use_file_fallback is false":  () => body.use_file_fallback === false,
    });
    templateId = body.id;
  });

  // ── Toggle use_file_fallback ───────────────────────────────────────────
  group("toggle_file_fallback", () => {
    if (!templateId) return;
    const res  = jsonPatch(`${API}/admin/notifications/templates/${templateId}/`, {
      use_file_fallback: true,
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "toggle fallback 200":         (r) => r.status === 200,
      "use_file_fallback is now true": () => body.use_file_fallback === true,
    });
  });

  // ── Create routing rule ────────────────────────────────────────────────
  let ruleId = null;
  group("create_routing_rule", () => {
    if (!channelId) return;
    const res  = jsonPost(`${API}/admin/notifications/rules/`, {
      event_type:     "ticket_submitted",
      channel:        channelId,
      is_active:      true,
      recipient_type: "requester",
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "create rule 201":        (r) => r.status === 201,
      "rule has id":            () => typeof body.id === "number",
      "rule channel matches":   () => body.channel === channelId,
    });
    ruleId = body.id;
  });

  // ── List rules ─────────────────────────────────────────────────────────
  group("list_rules", () => {
    const res   = http.get(`${API}/admin/notifications/rules/`);
    const rules = parseBody(res);
    check(res, {
      "list rules 200":  (r) => r.status === 200,
      "rules is array":  () => Array.isArray(rules),
    });
  });

  // ── Toggle rule inactive ───────────────────────────────────────────────
  group("toggle_rule", () => {
    if (!ruleId) return;
    const res  = jsonPatch(`${API}/admin/notifications/rules/${ruleId}/`, {
      is_active: false,
    }, csrf);
    check(res, { "disable rule 200": (r) => r.status === 200 });
  });

  // ── Notification logs ──────────────────────────────────────────────────
  group("notification_logs", () => {
    const res  = http.get(`${API}/admin/notifications/logs/`);
    const body = parseBody(res);
    check(res, {
      "logs 200":           (r) => r.status === 200,
      "logs has results":   () => Array.isArray(body.results) || Array.isArray(body),
    });
  });

  // ── Cleanup ────────────────────────────────────────────────────────────
  group("cleanup", () => {
    if (ruleId)    jsonDelete(`${API}/admin/notifications/rules/${ruleId}/`,    csrf);
    if (templateId) jsonDelete(`${API}/admin/notifications/templates/${templateId}/`, csrf);
    if (channelId) jsonDelete(`${API}/admin/notifications/channels/${channelId}/`, csrf);
  });

  logout(csrf);
  sleep(1);
}
