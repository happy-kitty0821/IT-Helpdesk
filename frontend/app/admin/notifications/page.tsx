"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  CheckCircle2,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Route,
  Send,
  Settings,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { csrfToken } from "@/lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChannelType =
  | "discord"
  | "google_workspace"
  | "teams"
  | "slack"
  | "email_smtp"
  | "email_mailgun";

interface NotificationChannel {
  id: number;
  type: ChannelType;
  name: string;
  is_active: boolean;
  config_display: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type EventType =
  | "ticket_submitted"
  | "ticket_resolved"
  | "ticket_assigned"
  | "status_changed"
  | "account_recovery";

interface EmailTemplate {
  id: number;
  event_type: EventType;
  name: string;
  subject_template: string;
  body_html_template: string;
  is_active: boolean;
  updated_at: string;
}

type RecipientType = 'requester' | 'assignee' | 'all_staff' | 'custom';

interface NotificationRule {
  id: number;
  event_type: EventType;
  channel: number;
  channel_name: string;
  channel_type: string;
  channel_emoji: string;
  is_active: boolean;
  recipient_type: RecipientType;
  custom_emails: string;
  created_at: string;
  updated_at: string;
}

interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "email" | "number" | "checkbox";
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

const RECIPIENT_LABELS: Record<RecipientType, string> = {
  requester: 'Ticket requester',
  assignee: 'Assigned staff member',
  all_staff: 'All active staff (email)',
  custom: 'Custom email list',
};

const CHANNEL_META: Record<
  ChannelType,
  { label: string; emoji: string; configFields: ConfigField[] }
> = {
  discord: {
    label: "Discord",
    emoji: "🎮",
    configFields: [{ key: "webhook_url", label: "Webhook URL", type: "password" }],
  },
  google_workspace: {
    label: "Google Workspace",
    emoji: "📊",
    configFields: [{ key: "webhook_url", label: "Webhook URL", type: "password" }],
  },
  teams: {
    label: "Microsoft Teams",
    emoji: "🔵",
    configFields: [{ key: "webhook_url", label: "Webhook URL", type: "password" }],
  },
  slack: {
    label: "Slack",
    emoji: "💬",
    configFields: [{ key: "webhook_url", label: "Webhook URL", type: "password" }],
  },
  email_smtp: {
    label: "Email (SMTP)",
    emoji: "📧",
    configFields: [
      { key: "host", label: "SMTP Host", type: "text" },
      { key: "port", label: "Port", type: "number" },
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "App Password", type: "password" },
      { key: "from_email", label: "From Email", type: "email" },
      { key: "use_tls", label: "Use TLS", type: "checkbox" },
      { key: "use_ssl", label: "Use SSL", type: "checkbox" },
    ],
  },
  email_mailgun: {
    label: "Email (Mailgun)",
    emoji: "📨",
    configFields: [
      { key: "api_url", label: "API URL", type: "text" },
      { key: "api_key", label: "API Key", type: "password" },
      { key: "from_email", label: "From Email", type: "email" },
      { key: "domain", label: "Domain", type: "text" },
    ],
  },
};

const EVENT_META: Record<EventType, { label: string; variables: string[] }> = {
  ticket_submitted: {
    label: "Ticket Submitted",
    variables: [
      "ticket_reference",
      "ticket_subject",
      "requester_name",
      "category_name",
      "helpdesk_url",
    ],
  },
  ticket_resolved: {
    label: "Ticket Resolved",
    variables: [
      "ticket_reference",
      "ticket_subject",
      "requester_name",
      "resolution_note",
      "helpdesk_url",
    ],
  },
  ticket_assigned: {
    label: "Ticket Assigned",
    variables: [
      "ticket_reference",
      "ticket_subject",
      "assignee_name",
      "requester_name",
      "helpdesk_url",
    ],
  },
  status_changed: {
    label: "Status Changed",
    variables: [
      "ticket_reference",
      "ticket_subject",
      "requester_name",
      "old_status",
      "new_status",
      "helpdesk_url",
    ],
  },
  account_recovery: {
    label: "Account Recovery",
    variables: ["requester_name", "college_email", "support_email", "helpdesk_url"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function messageFrom(data: unknown): string {
  if (!data || typeof data !== "object") return "An error occurred.";
  const obj = data as Record<string, unknown>;
  if (typeof obj.detail === "string") return obj.detail;
  const first = Object.values(obj).flat().find((v) => typeof v === "string");
  return typeof first === "string" ? first : "An error occurred.";
}

// ─── CustomEmailInput ─────────────────────────────────────────────────────────

function CustomEmailInput({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="a@b.com, c@d.com"
        disabled={disabled}
        style={{ fontSize: ".72rem", border: "1px solid #dbe2ee", borderRadius: 6, padding: "2px 6px", flex: 1, background: "#fff" }}
        aria-label="Custom email addresses"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSave(local)}
        style={{ fontSize: ".72rem", padding: "2px 7px", border: "1px solid #234395", borderRadius: 6, background: "#234395", color: "#fff", cursor: "pointer" }}
      >
        Save
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<"channels" | "templates" | "routing">("channels");

  // List state
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Channel editor state
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [channelForm, setChannelForm] = useState<{
    type: ChannelType;
    name: string;
    is_active: boolean;
    config: Record<string, string | boolean>;
  }>({ type: "discord", name: "", is_active: true, config: {} });
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [channelNotice, setChannelNotice] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(
    null
  );
  const [testing, setTesting] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [inlineTestResults, setInlineTestResults] = useState<
    Record<number, { success: boolean; message: string }>
  >({});

  // Template editor state
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<{
    name: string;
    subject_template: string;
    body_html_template: string;
    is_active: boolean;
  }>({ name: "", subject_template: "", body_html_template: "", is_active: true });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateNotice, setTemplateNotice] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [lastFocusedField, setLastFocusedField] = useState<"subject" | "body">("body");

  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [savingRule, setSavingRule] = useState<number | string | null>(null);
  const [ruleNotice, setRuleNotice] = useState('');
  const [ruleError, setRuleError] = useState('');

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // ─── Load data ──────────────────────────────────────────────────────────────

  function loadAll() {
    setLoading(true);
    Promise.all([
      fetch("/api/v1/admin/notifications/channels/", {
        credentials: "include",
        cache: "no-store",
      }).then((r) => (r.ok ? (r.json() as Promise<NotificationChannel[]>) : [])),
      fetch("/api/v1/admin/notifications/templates/", {
        credentials: "include",
        cache: "no-store",
      }).then((r) => (r.ok ? (r.json() as Promise<EmailTemplate[]>) : [])),
      fetch("/api/v1/admin/notifications/rules/", {
        credentials: "include",
        cache: "no-store",
      }).then((r) => (r.ok ? (r.json() as Promise<NotificationRule[]>) : [])),
    ])
      .then(([ch, tmpl, ruleData]) => {
        setChannels(Array.isArray(ch) ? ch : []);
        setTemplates(Array.isArray(tmpl) ? tmpl : []);
        setRules(Array.isArray(ruleData) ? ruleData : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load data."))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, []);

  // ─── Channel editor helpers ──────────────────────────────────────────────────

  function openCreateChannel() {
    const defaultType: ChannelType = "discord";
    setEditingChannel(null);
    setCreatingChannel(true);
    setChannelForm({ type: defaultType, name: "", is_active: true, config: {} });
    setChannelError("");
    setChannelNotice("");
    setTestResult(null);
  }

  function openEditChannel(channel: NotificationChannel) {
    setEditingChannel(channel);
    setCreatingChannel(false);
    // Pre-populate config display values (masked)
    const initialConfig: Record<string, string | boolean> = {};
    CHANNEL_META[channel.type].configFields.forEach((field) => {
      if (field.type === "checkbox") {
        initialConfig[field.key] =
          typeof channel.config_display[field.key] === "boolean"
            ? (channel.config_display[field.key] as boolean)
            : false;
      } else if (field.type === "password") {
        // Show placeholder for existing password fields
        initialConfig[field.key] = "";
      } else {
        initialConfig[field.key] = String(channel.config_display[field.key] ?? "");
      }
    });
    setChannelForm({
      type: channel.type,
      name: channel.name,
      is_active: channel.is_active,
      config: initialConfig,
    });
    setChannelError("");
    setChannelNotice("");
    setTestResult(null);
  }

  function closeChannelEditor() {
    setEditingChannel(null);
    setCreatingChannel(false);
    setChannelError("");
    setChannelNotice("");
    setTestResult(null);
  }

  function updateChannelConfig(key: string, value: string | boolean) {
    setChannelForm((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }));
  }

  function onChannelTypeChange(newType: ChannelType) {
    setChannelForm((prev) => ({ ...prev, type: newType, config: {} }));
  }

  async function saveChannel() {
    setSavingChannel(true);
    setChannelError("");
    setChannelNotice("");
    try {
      const token = await csrfToken();
      const body: Record<string, unknown> = {
        name: channelForm.name,
        type: channelForm.type,
        is_active: channelForm.is_active,
        config: channelForm.config,
      };

      const url = editingChannel
        ? `/api/v1/admin/notifications/channels/${editingChannel.id}/`
        : "/api/v1/admin/notifications/channels/";

      const res = await fetch(url, {
        method: editingChannel ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setChannelError(messageFrom(data));
      } else {
        setChannelNotice(editingChannel ? "Channel updated." : "Channel created.");
        closeChannelEditor();
        loadAll();
      }
    } catch {
      setChannelError("A network error occurred.");
    } finally {
      setSavingChannel(false);
    }
  }

  async function deleteChannel(id: number) {
    if (!confirm("Delete this notification channel? This cannot be undone.")) return;
    try {
      const token = await csrfToken();
      await fetch(`/api/v1/admin/notifications/channels/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      loadAll();
    } catch {
      setError("Could not delete channel.");
    }
  }

  async function testChannelInline(id: number) {
    setTestingId(id);
    try {
      const token = await csrfToken();
      const res = await fetch("/api/v1/admin/notifications/channels/test/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      setInlineTestResults((prev) => ({
        ...prev,
        [id]: {
          success: res.ok,
          message: res.ok
            ? String(data.message ?? "Test sent successfully.")
            : messageFrom(data),
        },
      }));
    } catch {
      setInlineTestResults((prev) => ({
        ...prev,
        [id]: { success: false, message: "Network error." },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function testChannelForm() {
    setTesting(true);
    setTestResult(null);
    try {
      const token = await csrfToken();
      const body: Record<string, unknown> = {
        type: channelForm.type,
        name: channelForm.name,
        config: channelForm.config,
      };
      if (editingChannel) body.id = editingChannel.id;

      const res = await fetch("/api/v1/admin/notifications/channels/test/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      setTestResult({
        success: res.ok,
        message: res.ok
          ? String(data.message ?? "Test sent successfully.")
          : messageFrom(data),
      });
    } catch {
      setTestResult({ success: false, message: "Network error." });
    } finally {
      setTesting(false);
    }
  }

  // ─── Template editor helpers ─────────────────────────────────────────────────

  function openEditTemplate(template: EmailTemplate) {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      subject_template: template.subject_template,
      body_html_template: template.body_html_template,
      is_active: template.is_active,
    });
    setTemplateError("");
    setTemplateNotice("");
    setPreviewHtml(null);
  }

  function closeTemplateEditor() {
    setEditingTemplate(null);
    setTemplateError("");
    setTemplateNotice("");
    setPreviewHtml(null);
  }

  function insertVariable(varName: string) {
    const token = `{{${varName}}}`;
    if (lastFocusedField === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + token + el.value.slice(end);
      setTemplateForm((prev) => ({ ...prev, subject_template: newVal }));
      // Restore cursor after state update
      requestAnimationFrame(() => {
        el.setSelectionRange(start + token.length, start + token.length);
        el.focus();
      });
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + token + el.value.slice(end);
      setTemplateForm((prev) => ({ ...prev, body_html_template: newVal }));
      requestAnimationFrame(() => {
        el.setSelectionRange(start + token.length, start + token.length);
        el.focus();
      });
    }
  }

  async function saveTemplate() {
    if (!editingTemplate) return;
    setSavingTemplate(true);
    setTemplateError("");
    setTemplateNotice("");
    try {
      const token = await csrfToken();
      const res = await fetch(
        `/api/v1/admin/notifications/templates/${editingTemplate.id}/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": token },
          body: JSON.stringify(templateForm),
        }
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setTemplateError(messageFrom(data));
      } else {
        setTemplateNotice("Template saved.");
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === editingTemplate.id ? { ...t, ...(data as Partial<EmailTemplate>) } : t
          )
        );
      }
    } catch {
      setTemplateError("A network error occurred.");
    } finally {
      setSavingTemplate(false);
    }
  }

  // ─── Derived values ──────────────────────────────────────────────────────────

  /** Find the rule for a given (event_type, channel_id) combination. */
  function findRule(eventType: EventType, channelId: number): NotificationRule | undefined {
    return rules.find((r) => r.event_type === eventType && r.channel === channelId);
  }

  async function toggleRule(eventType: EventType, channelId: number, currentRule: NotificationRule | undefined) {
    const key = `${eventType}-${channelId}`;
    setSavingRule(key);
    setRuleError('');
    setRuleNotice('');
    try {
      const token = await csrfToken();
      if (currentRule) {
        // Toggle is_active
        const res = await fetch(`/api/v1/admin/notifications/rules/${currentRule.id}/`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
          body: JSON.stringify({ is_active: !currentRule.is_active }),
        });
        const data = await res.json().catch(() => ({})) as NotificationRule;
        if (res.ok) {
          setRules((prev) => prev.map((r) => r.id === currentRule.id ? { ...r, ...data } : r));
        } else {
          setRuleError(messageFrom(data));
        }
      } else {
        // Create new rule
        const res = await fetch('/api/v1/admin/notifications/rules/', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
          body: JSON.stringify({ event_type: eventType, channel: channelId, is_active: true, recipient_type: 'requester' }),
        });
        const data = await res.json().catch(() => ({})) as NotificationRule;
        if (res.ok) {
          setRules((prev) => [...prev, data]);
        } else {
          setRuleError(messageFrom(data));
        }
      }
    } catch {
      setRuleError('A network error occurred.');
    } finally {
      setSavingRule(null);
    }
  }

  async function updateRuleRecipient(ruleId: number, recipientType: RecipientType, customEmails?: string) {
    setSavingRule(ruleId);
    setRuleError('');
    try {
      const token = await csrfToken();
      const body: Record<string, unknown> = { recipient_type: recipientType };
      if (customEmails !== undefined) body.custom_emails = customEmails;
      const res = await fetch(`/api/v1/admin/notifications/rules/${ruleId}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as NotificationRule;
      if (res.ok) {
        setRules((prev) => prev.map((r) => r.id === ruleId ? { ...r, ...data } : r));
        setRuleNotice('Rule updated.');
      } else {
        setRuleError(messageFrom(data));
      }
    } catch {
      setRuleError('A network error occurred.');
    } finally {
      setSavingRule(null);
    }
  }

  const channelEditorOpen = editingChannel !== null || creatingChannel;
  const activeChannels = channels.filter((c) => c.is_active).length;
  const activeTemplates = templates.filter((t) => t.is_active).length;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">System settings</p>
          <h1>Notifications</h1>
          <p>Configure delivery channels and email templates for automated alerts.</p>
        </div>
        <div className="user-summary">
          <span>
            <Bell aria-hidden="true" />
            <strong>{activeChannels}</strong> active channel{activeChannels !== 1 ? "s" : ""}
          </span>
          <span>
            <Mail aria-hidden="true" />
            <strong>{activeTemplates}</strong> active template{activeTemplates !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      {channelNotice && (
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="admin-notice"
          role="status"
        >
          {channelNotice}
        </motion.p>
      )}
      {error && (
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="admin-error"
          role="alert"
        >
          {error}
        </motion.p>
      )}

      {/* Tab switcher */}
      <div className="notif-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "channels"}
          className={`notif-tab${activeTab === "channels" ? " active" : ""}`}
          onClick={() => setActiveTab("channels")}
        >
          <Settings aria-hidden="true" size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Channels
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "templates"}
          className={`notif-tab${activeTab === "templates" ? " active" : ""}`}
          onClick={() => setActiveTab("templates")}
        >
          <Mail aria-hidden="true" size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Templates
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "routing"}
          className={`notif-tab${activeTab === "routing" ? " active" : ""}`}
          onClick={() => setActiveTab("routing")}
        >
          <Route aria-hidden="true" size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Routing
        </button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading notifications…</div>
      ) : (
        <>
          {/* ── Channels tab ── */}
          {activeTab === "channels" && (
            <motion.div
              key="channels"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1e293b" }}>
                  Delivery channels
                </h2>
                <button
                  className="primary-button"
                  style={{ display: "flex", alignItems: "center", gap: 7 }}
                  onClick={openCreateChannel}
                >
                  <Plus aria-hidden="true" size={16} /> Add channel
                </button>
              </div>

              <div className="notif-channels">
                {channels.length === 0 && (
                  <div className="admin-loading" style={{ textAlign: "center", color: "#64748b" }}>
                    <MessageSquare
                      aria-hidden="true"
                      size={32}
                      style={{ display: "block", margin: "0 auto 12px", color: "#234395" }}
                    />
                    No channels configured yet. Add one to start sending notifications.
                  </div>
                )}
                {channels.map((channel, i) => {
                  const meta = CHANNEL_META[channel.type];
                  const inline = inlineTestResults[channel.id];
                  return (
                    <motion.div
                      key={channel.id}
                      className="notif-channel-row"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.18) }}
                    >
                      <div className="notif-channel-icon" aria-hidden="true">
                        {meta.emoji}
                      </div>
                      <div className="notif-channel-info">
                        <strong>{channel.name}</strong>
                        <small>{meta.label}</small>
                      </div>
                      <div className="notif-channel-actions">
                        <span
                          className={`status-chip ${channel.is_active ? "active" : "archived"}`}
                        >
                          {channel.is_active ? "Active" : "Inactive"}
                        </span>
                        {inline && (
                          <span
                            className={`notif-test-result ${inline.success ? "notif-test-ok" : "notif-test-fail"}`}
                          >
                            {inline.success ? (
                              <CheckCircle2 size={11} style={{ marginRight: 3, verticalAlign: "middle" }} />
                            ) : (
                              <XCircle size={11} style={{ marginRight: 3, verticalAlign: "middle" }} />
                            )}
                            {inline.message}
                          </span>
                        )}
                        <button
                          className="secondary-button"
                          style={{ display: "flex", alignItems: "center", gap: 5, minHeight: 36, padding: "0 12px", fontSize: ".8rem" }}
                          onClick={() => testChannelInline(channel.id)}
                          disabled={testingId === channel.id}
                          aria-label={`Test ${channel.name}`}
                        >
                          <Send size={13} aria-hidden="true" />
                          {testingId === channel.id ? "Testing…" : "Test"}
                        </button>
                        <button
                          style={{
                            width: 36,
                            height: 36,
                            border: "1px solid #dbe2ee",
                            background: "#fff",
                            color: "#234395",
                            borderRadius: 9,
                            display: "grid",
                            placeItems: "center",
                            cursor: "pointer",
                          }}
                          onClick={() => openEditChannel(channel)}
                          aria-label={`Edit ${channel.name}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button
                          style={{
                            width: 36,
                            height: 36,
                            border: "1px solid #fecaca",
                            background: "#fff",
                            color: "#dc2626",
                            borderRadius: 9,
                            display: "grid",
                            placeItems: "center",
                            cursor: "pointer",
                          }}
                          onClick={() => deleteChannel(channel.id)}
                          aria-label={`Delete ${channel.name}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ── Templates tab ── */}
          {activeTab === "templates" && (
            <motion.div
              key="templates"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1e293b" }}>
                  Email templates
                </h2>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: ".88rem" }}>
                  Customise the subject and body for each automated notification event.
                </p>
              </div>

              <div className="notif-templates">
                {templates.length === 0 && (
                  <div className="admin-loading" style={{ textAlign: "center", color: "#64748b" }}>
                    No email templates found.
                  </div>
                )}
                {templates.map((template, i) => {
                  const eventMeta = EVENT_META[template.event_type];
                  return (
                    <motion.div
                      key={template.id}
                      className="notif-template-row"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.18) }}
                    >
                      <span className="notif-event-badge">
                        {eventMeta?.label ?? template.event_type}
                      </span>
                      <div className="notif-channel-info" style={{ flex: 1 }}>
                        <strong>{template.name}</strong>
                        <small style={{ fontFamily: "ui-monospace, monospace" }}>
                          {template.subject_template}
                        </small>
                      </div>
                      <div className="notif-channel-actions">
                        <span
                          className={`status-chip ${template.is_active ? "active" : "archived"}`}
                        >
                          {template.is_active ? "Active" : "Inactive"}
                        </span>
                        <button
                          style={{
                            width: 36,
                            height: 36,
                            border: "1px solid #dbe2ee",
                            background: "#fff",
                            color: "#234395",
                            borderRadius: 9,
                            display: "grid",
                            placeItems: "center",
                            cursor: "pointer",
                          }}
                          onClick={() => openEditTemplate(template)}
                          aria-label={`Edit ${template.name}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ── Routing tab ── */}
          {activeTab === "routing" && (
            <motion.div
              key="routing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1e293b" }}>Routing rules</h2>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: ".88rem" }}>
                  Choose which channels receive each event and who the recipients are.
                  Tick a cell to enable delivery — the rule is created immediately.
                  If no rules are configured for an event, all active channels receive it.
                </p>
              </div>

              {ruleNotice && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="admin-notice" style={{ marginBottom: 16 }} role="status">
                  {ruleNotice}
                </motion.p>
              )}
              {ruleError && (
                <p className="admin-error" style={{ marginBottom: 16 }} role="alert">{ruleError}</p>
              )}

              {channels.length === 0 ? (
                <div className="admin-loading" style={{ textAlign: "center", color: "#64748b" }}>
                  Configure at least one channel before setting up routing rules.
                </div>
              ) : (
                <div className="notif-routing-wrap">
                  {/* Matrix header */}
                  <div className="notif-routing-table">
                    <div className="notif-routing-head">
                      <div className="notif-routing-cell notif-routing-event-col">
                        <span style={{ color: "#64748b", fontSize: ".75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em" }}>
                          Event
                        </span>
                      </div>
                      {channels.map((ch) => (
                        <div key={ch.id} className="notif-routing-cell notif-routing-channel-col" title={ch.name}>
                          <span className="notif-channel-icon" style={{ width: 32, height: 32, fontSize: ".9rem", margin: "0 auto 4px", display: "grid", placeItems: "center", borderRadius: 9, background: "#eef2ff", color: "#234395" }}>
                            {CHANNEL_META[ch.type]?.emoji ?? "📢"}
                          </span>
                          <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80, display: "block", textAlign: "center" }}>
                            {ch.name}
                          </span>
                          <span className={`status-chip ${ch.is_active ? "active" : "archived"}`} style={{ margin: "3px auto 0", fontSize: ".68rem" }}>
                            {ch.is_active ? "Active" : "Off"}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Matrix rows — one per event type */}
                    {(Object.entries(EVENT_META) as [EventType, typeof EVENT_META[EventType]][]).map(([eventType, meta]) => (
                      <div key={eventType} className="notif-routing-row">
                        <div className="notif-routing-cell notif-routing-event-col">
                          <span className="notif-event-badge" style={{ fontSize: ".75rem" }}>{meta.label}</span>
                        </div>
                        {channels.map((ch) => {
                          const rule = findRule(eventType, ch.id);
                          const key = `${eventType}-${ch.id}`;
                          const isSaving = savingRule === key || savingRule === rule?.id;
                          const isEnabled = rule?.is_active === true;
                          return (
                            <div key={ch.id} className="notif-routing-cell notif-routing-channel-col">
                              <label className="notif-routing-toggle" title={isEnabled ? "Disable this route" : "Enable this route"}>
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  disabled={isSaving || !ch.is_active}
                                  onChange={() => toggleRule(eventType, ch.id, rule)}
                                  aria-label={`${isEnabled ? "Disable" : "Enable"} ${meta.label} notifications via ${ch.name}`}
                                />
                                <span className="notif-routing-check" />
                              </label>
                              {/* Recipient selector — only shown when rule is enabled */}
                              {rule && rule.is_active && (
                                <div style={{ marginTop: 6 }}>
                                  <select
                                    value={rule.recipient_type}
                                    onChange={(e) => updateRuleRecipient(rule.id, e.target.value as RecipientType)}
                                    disabled={savingRule === rule.id}
                                    style={{ fontSize: ".72rem", border: "1px solid #dbe2ee", borderRadius: 6, padding: "2px 5px", width: "100%", background: "#f8fafc", cursor: "pointer", color: "#334155" }}
                                    aria-label={`Recipient for ${meta.label} via ${ch.name}`}
                                  >
                                    {(Object.entries(RECIPIENT_LABELS) as [RecipientType, string][]).map(([v, l]) => (
                                      <option key={v} value={v}>{l}</option>
                                    ))}
                                  </select>
                                  {rule.recipient_type === 'custom' && (
                                    <CustomEmailInput
                                      value={rule.custom_emails}
                                      disabled={savingRule === rule.id}
                                      onSave={(emails) => updateRuleRecipient(rule.id, 'custom', emails)}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap", color: "#64748b", fontSize: ".8rem" }}>
                    <span>☑ Enabled — notification sent via that channel for this event</span>
                    <span>◻ Disabled — channel not used for this event</span>
                    <span style={{ color: "#94a3b8" }}>Grey channels are inactive globally</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}

      {/* ── Channel editor panel ── */}
      <AnimatePresence>
        {channelEditorOpen && (
          <motion.aside
            key={editingChannel?.id ?? "new-channel"}
            className="editor-panel guide-editor"
            initial={{ opacity: 0, x: 28, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label="Channel editor"
          >
            <header>
              <div>
                <span>{editingChannel ? "Edit channel" : "New channel"}</span>
                <h2>
                  {editingChannel
                    ? editingChannel.name
                    : channelForm.name || "Configure channel"}
                </h2>
              </div>
              <button aria-label="Close editor" onClick={closeChannelEditor}>
                <X aria-hidden="true" />
              </button>
            </header>

            <div style={{ padding: "20px", display: "grid", gap: 16, maxHeight: "calc(100vh - 130px)", overflowY: "auto" }}>
              {/* Channel name */}
              <label className="notif-form-group">
                Channel name
                <input
                  type="text"
                  value={channelForm.name}
                  onChange={(e) => setChannelForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. IT Support Discord"
                  maxLength={120}
                />
              </label>

              {/* Channel type */}
              <label className="notif-form-group">
                Channel type
                <select
                  value={channelForm.type}
                  onChange={(e) => onChannelTypeChange(e.target.value as ChannelType)}
                  disabled={!!editingChannel}
                >
                  {(Object.keys(CHANNEL_META) as ChannelType[]).map((t) => (
                    <option key={t} value={t}>
                      {CHANNEL_META[t].emoji} {CHANNEL_META[t].label}
                    </option>
                  ))}
                </select>
                {editingChannel && (
                  <small style={{ color: "#64748b", fontWeight: 400, fontSize: ".78rem" }}>
                    Channel type cannot be changed after creation.
                  </small>
                )}
              </label>

              {/* Dynamic config fields */}
              {CHANNEL_META[channelForm.type].configFields.map((field) => {
                if (field.type === "checkbox") {
                  return (
                    <label key={field.key} className="notif-checkbox-row">
                      <input
                        type="checkbox"
                        checked={channelForm.config[field.key] === true}
                        onChange={(e) => updateChannelConfig(field.key, e.target.checked)}
                      />
                      {field.label}
                    </label>
                  );
                }
                return (
                  <label key={field.key} className="notif-form-group">
                    {field.label}
                    <input
                      type={field.type}
                      value={String(channelForm.config[field.key] ?? "")}
                      onChange={(e) => updateChannelConfig(field.key, e.target.value)}
                      placeholder={
                        field.type === "password" && editingChannel
                          ? "Leave blank to keep existing"
                          : field.label
                      }
                    />
                  </label>
                );
              })}

              {/* Active toggle */}
              <label className="notif-checkbox-row">
                <input
                  type="checkbox"
                  checked={channelForm.is_active}
                  onChange={(e) =>
                    setChannelForm((p) => ({ ...p, is_active: e.target.checked }))
                  }
                />
                Active — enable this channel for sending notifications
              </label>

              {/* Test result */}
              {testResult && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={testResult.success ? "admin-notice" : "admin-error"}
                  style={{ margin: 0 }}
                  role={testResult.success ? "status" : "alert"}
                >
                  {testResult.success ? (
                    <CheckCircle2 size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  ) : (
                    <XCircle size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  )}
                  {testResult.message}
                </motion.div>
              )}

              {channelError && (
                <p className="admin-error" style={{ margin: 0 }} role="alert">
                  {channelError}
                </p>
              )}

              {/* Actions */}
              <div className="editor-actions" style={{ flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeChannelEditor}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                  onClick={testChannelForm}
                  disabled={testing}
                >
                  <Send size={14} aria-hidden="true" />
                  {testing ? "Testing…" : "Test"}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={saveChannel}
                  disabled={savingChannel}
                >
                  {savingChannel ? "Saving…" : editingChannel ? "Save changes" : "Create channel"}
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Template editor panel ── */}
      <AnimatePresence>
        {editingTemplate && (
          <motion.aside
            key={editingTemplate.id}
            className="editor-panel guide-editor"
            initial={{ opacity: 0, x: 28, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label="Template editor"
          >
            <header>
              <div>
                <span>
                  {EVENT_META[editingTemplate.event_type]?.label ?? editingTemplate.event_type}
                </span>
                <h2>{templateForm.name || editingTemplate.name}</h2>
              </div>
              <button aria-label="Close editor" onClick={closeTemplateEditor}>
                <X aria-hidden="true" />
              </button>
            </header>

            <div style={{ padding: "20px", display: "grid", gap: 16, maxHeight: "calc(100vh - 130px)", overflowY: "auto" }}>
              {/* Template name */}
              <label className="notif-form-group">
                Template name
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={(e) =>
                    setTemplateForm((p) => ({ ...p, name: e.target.value }))
                  }
                  maxLength={160}
                />
              </label>

              {/* Subject */}
              <label className="notif-form-group">
                Subject
                <input
                  ref={subjectRef}
                  type="text"
                  value={templateForm.subject_template}
                  onChange={(e) =>
                    setTemplateForm((p) => ({ ...p, subject_template: e.target.value }))
                  }
                  onFocus={() => setLastFocusedField("subject")}
                  placeholder="e.g. Your ticket {{ticket_reference}} has been received"
                />
              </label>

              {/* Body */}
              <div className="notif-form-group">
                Body HTML
                <textarea
                  ref={bodyRef}
                  rows={15}
                  style={{ fontFamily: "ui-monospace, monospace" }}
                  value={templateForm.body_html_template}
                  onChange={(e) =>
                    setTemplateForm((p) => ({ ...p, body_html_template: e.target.value }))
                  }
                  onFocus={() => setLastFocusedField("body")}
                  placeholder="<p>Hello {{requester_name}},</p>"
                />
                {/* Variable chips */}
                <div>
                  <small style={{ color: "#64748b", fontWeight: 600 }}>
                    Click to insert into {lastFocusedField === "subject" ? "subject" : "body"}:
                  </small>
                  <div className="notif-var-chips">
                    {(EVENT_META[editingTemplate.event_type]?.variables ?? []).map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="notif-var-chip"
                        onClick={() => insertVariable(v)}
                        title={`Insert {{${v}}}`}
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Active toggle */}
              <label className="notif-checkbox-row">
                <input
                  type="checkbox"
                  checked={templateForm.is_active}
                  onChange={(e) =>
                    setTemplateForm((p) => ({ ...p, is_active: e.target.checked }))
                  }
                />
                Active — use this template for outgoing emails
              </label>

              {/* Preview */}
              {previewHtml !== null && (
                <div
                  className="notif-preview"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                  aria-label="Email preview"
                />
              )}

              {templateNotice && (
                <p className="admin-notice" style={{ margin: 0 }} role="status">
                  {templateNotice}
                </p>
              )}
              {templateError && (
                <p className="admin-error" style={{ margin: 0 }} role="alert">
                  {templateError}
                </p>
              )}

              {/* Actions */}
              <div className="editor-actions" style={{ flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeTemplateEditor}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                  onClick={() => setPreviewHtml(templateForm.body_html_template)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={saveTemplate}
                  disabled={savingTemplate}
                >
                  {savingTemplate ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
