"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  Edit3, Loader2, Plus, RefreshCw, ShieldAlert, ShieldOff,
  Trash2, X, Zap,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { csrfToken } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateLimitRule {
  id: number;
  scope: string;
  label: string;
  description: string;
  limit: number;
  window: "second" | "minute" | "hour" | "day";
  violation_action: "block" | "warn" | "suspend";
  violation_threshold: number;
  is_active: boolean;
  violation_count: number;
  updated_at: string;
}

interface Violation {
  id: number;
  rule: number;
  rule_scope: string;
  rule_label: string;
  identifier: string;
  user: number | null;
  user_name: string;
  request_count: number;
  action_taken: "blocked" | "warned" | "suspended";
  request_path: string;
  request_method: string;
  ip_address: string | null;
  is_resolved: boolean;
  notes: string;
  created_at: string;
}

interface PagedViolations {
  count: number; num_pages: number; page: number; page_size: number;
  results: Violation[];
}

interface Stats {
  total_rules: number; active_rules: number;
  violations_24h: number; violations_7d: number;
  unresolved: number; auto_suspended: number;
  top_scopes: { scope: string; label: string; count: number }[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOW_LABELS: Record<string, string> = { second: "/ second", minute: "/ minute", hour: "/ hour", day: "/ day" };
const ACTION_META: Record<string, { label: string; color: string; bg: string }> = {
  block:   { label: "Block (429)",     color: "#dc2626", bg: "#fee2e2" },
  warn:    { label: "Allow + log",     color: "#92400e", bg: "#fef3c7" },
  suspend: { label: "Suspend account", color: "#7c3aed", bg: "#ede9fe" },
};
const TAKEN_META: Record<string, { label: string; color: string; bg: string }> = {
  blocked:   { label: "Blocked",   color: "#dc2626", bg: "#fee2e2" },
  warned:    { label: "Warned",    color: "#92400e", bg: "#fef3c7" },
  suspended: { label: "Suspended", color: "#7c3aed", bg: "#ede9fe" },
};

function formatDt(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function messageFrom(d: unknown): string {
  if (d && typeof d === "object") {
    const r = d as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r)) {
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  return "The request could not be completed.";
}

const BLANK_RULE: Omit<RateLimitRule, "id" | "violation_count" | "updated_at"> = {
  scope: "", label: "", description: "", limit: 60, window: "minute",
  violation_action: "block", violation_threshold: 0, is_active: true,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RateLimitsPage() {
  const [tab, setTab] = useState<"rules" | "violations">("rules");

  // ── Rules state ───────────────────────────────────────────────────────────
  const [rules, setRules]           = useState<RateLimitRule[]>([]);
  const [rulesLoading, setRL]       = useState(true);
  const [stats, setStats]           = useState<Stats | null>(null);

  // ── Rule editor ───────────────────────────────────────────────────────────
  const [editingRule, setEditingRule] = useState<RateLimitRule | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ ...BLANK_RULE });
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // ── Violations state ──────────────────────────────────────────────────────
  const [violations, setViolations] = useState<Violation[]>([]);
  const [vPage, setVPage]           = useState(1);
  const [vNumPages, setVNumPages]   = useState(1);
  const [vCount, setVCount]         = useState(0);
  const [vLoading, setVL]           = useState(false);
  const [vFilter, setVFilter]       = useState<"all" | "unresolved">("unresolved");
  const [vAction, setVAction]       = useState("");
  const [vRule, setVRule]           = useState("");
  const [editingViolation, setEditingViolation] = useState<Violation | null>(null);
  const [vNotes, setVNotes]         = useState("");
  const [vSaving, setVSaving]       = useState(false);
  const [bulkResolving, setBulkResolving] = useState(false);

  // ── Shared feedback ───────────────────────────────────────────────────────
  const [notice, setNotice] = useState("");
  const [error, setError]   = useState("");

  // ── API helpers ───────────────────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    setRL(true);
    try {
      const [rRes, sRes] = await Promise.all([
        fetch("/api/v1/admin/rate-limits/rules/", { credentials: "include", cache: "no-store" }),
        fetch("/api/v1/admin/rate-limits/stats/", { credentials: "include", cache: "no-store" }),
      ]);
      if (rRes.ok) setRules(await rRes.json() as RateLimitRule[]);
      if (sRes.ok) setStats(await sRes.json() as Stats);
    } catch { /* ignore */ }
    finally { setRL(false); }
  }, []);

  const loadViolations = useCallback(async (p: number) => {
    setVL(true);
    try {
      const params = new URLSearchParams({ page: String(p), page_size: "25" });
      if (vFilter === "unresolved") params.set("unresolved", "1");
      if (vAction) params.set("action", vAction);
      if (vRule)   params.set("rule",   vRule);
      const res = await fetch(`/api/v1/admin/rate-limits/violations/?${params}`, { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const d = await res.json() as PagedViolations;
        setViolations(d.results); setVPage(d.page);
        setVNumPages(d.num_pages); setVCount(d.count);
      }
    } catch { /* ignore */ }
    finally { setVL(false); }
  }, [vFilter, vAction, vRule]);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => { if (tab === "violations") loadViolations(vPage); }, [tab, vPage, vFilter, vAction, vRule, loadViolations]);

  // ── Rule CRUD ─────────────────────────────────────────────────────────────
  function openCreate() {
    setCreatingRule(true); setEditingRule(null);
    setRuleForm({ ...BLANK_RULE }); setRuleErrors({});
    setError(""); setNotice("");
  }
  function openEdit(rule: RateLimitRule) {
    setEditingRule(rule); setCreatingRule(false);
    setRuleForm({
      scope: rule.scope, label: rule.label, description: rule.description,
      limit: rule.limit, window: rule.window, violation_action: rule.violation_action,
      violation_threshold: rule.violation_threshold, is_active: rule.is_active,
    });
    setRuleErrors({}); setError(""); setNotice("");
  }
  function closeRuleEditor() { setEditingRule(null); setCreatingRule(false); }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    setRuleSaving(true); setRuleErrors({}); setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const url    = editingRule ? `/api/v1/admin/rate-limits/rules/${editingRule.id}/` : "/api/v1/admin/rate-limits/rules/";
      const method = editingRule ? "PATCH" : "POST";
      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(ruleForm),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) errs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        setRuleErrors(Object.keys(errs).length ? errs : { _: messageFrom(data) }); return;
      }
      setNotice(editingRule ? "Rule updated." : "Rule created.");
      closeRuleEditor(); loadRules();
    } catch { setRuleErrors({ _: "Network error." }); }
    finally { setRuleSaving(false); }
  }

  async function deleteRule(id: number) {
    setDeletingRuleId(id);
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/rate-limits/rules/${id}/`, {
        method: "DELETE", credentials: "include", headers: { "X-CSRFToken": token },
      });
      if (!res.ok) throw new Error("Could not delete rule.");
      setNotice("Rule deleted."); setConfirmDeleteId(null); loadRules();
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); }
    finally { setDeletingRuleId(null); }
  }

  async function toggleRule(rule: RateLimitRule) {
    try {
      const token = await csrfToken();
      await fetch(`/api/v1/admin/rate-limits/rules/${rule.id}/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      loadRules();
    } catch { /* ignore */ }
  }

  async function seedDefaults() {
    try {
      const token = await csrfToken();
      const res = await fetch("/api/v1/admin/rate-limits/seed/", {
        method: "POST", credentials: "include", headers: { "X-CSRFToken": token },
      });
      const d = await res.json().catch(() => ({})) as { created?: number };
      setNotice(d.created ? `${d.created} default rule${d.created !== 1 ? "s" : ""} created.` : "All default rules already exist.");
      loadRules();
    } catch { setError("Could not seed defaults."); }
  }

  // ── Violation actions ─────────────────────────────────────────────────────
  function openViolation(v: Violation) { setEditingViolation(v); setVNotes(v.notes); }

  async function resolveViolation(v: Violation) {
    setVSaving(true);
    try {
      const token = await csrfToken();
      await fetch(`/api/v1/admin/rate-limits/violations/${v.id}/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ is_resolved: true, notes: vNotes }),
      });
      setNotice("Violation resolved."); setEditingViolation(null);
      loadViolations(vPage);
    } catch { setError("Could not resolve."); }
    finally { setVSaving(false); }
  }

  async function bulkResolve() {
    setBulkResolving(true);
    try {
      const token = await csrfToken();
      const body: Record<string, unknown> = {};
      if (vRule) body.rule_id = Number(vRule);
      const res = await fetch("/api/v1/admin/rate-limits/violations/resolve-all/", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({})) as { resolved?: number };
      setNotice(`${d.resolved ?? 0} violation${d.resolved !== 1 ? "s" : ""} resolved.`);
      loadViolations(1); setVPage(1);
    } catch { setError("Could not bulk resolve."); }
    finally { setBulkResolving(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const ruleEditorOpen = editingRule !== null || creatingRule;

  return (
    <div className="admin-content" style={{
      maxWidth:    ruleEditorOpen ? "calc(100% - 500px - 24px)" : undefined,
      marginLeft:  ruleEditorOpen ? 0 : undefined,
      marginRight: ruleEditorOpen ? 0 : undefined,
      transition:  "max-width 280ms ease",
    }}>

      {/* ── Page header ── */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Security</p>
          <h1>Rate limiting</h1>
          <p>Configure request limits per endpoint, choose what happens when they are violated, and review the violation log.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary-button" onClick={seedDefaults} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} aria-hidden="true" /> Seed defaults
          </button>
          <button className="primary-button" onClick={openCreate} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Plus size={15} aria-hidden="true" /> New rule
          </button>
        </div>
      </header>

      {/* ── Feedback ── */}
      <AnimatePresence mode="wait">
        {notice && <motion.p key="n" className="admin-notice" role="status" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{notice}</motion.p>}
        {error  && <motion.p key="e" className="admin-error"  role="alert"  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error}</motion.p>}
      </AnimatePresence>

      {/* ── Stats strip ── */}
      {stats && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Active rules",    value: stats.active_rules,    icon: <Zap size={16} />,        color: "#234395", bg: "#eef2ff" },
            { label: "Violations 24h",  value: stats.violations_24h,  icon: <Activity size={16} />,   color: "#92400e", bg: "#fef3c7" },
            { label: "Violations 7d",   value: stats.violations_7d,   icon: <Activity size={16} />,   color: "#475569", bg: "#f1f5f9" },
            { label: "Unresolved",      value: stats.unresolved,      icon: <AlertTriangle size={16} />, color: "#dc2626", bg: "#fee2e2" },
            { label: "Auto-suspended",  value: stats.auto_suspended,  icon: <ShieldOff size={16} />,  color: "#7c3aed", bg: "#ede9fe" },
          ].map(({ label, value, icon, color, bg }) => (
            <div key={label} style={{ background: "#fff", border: "1px solid #e8edf4", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, color, display: "grid", placeItems: "center", flexShrink: 0 }}>{icon}</div>
              <div>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: ".74rem", color: "#64748b", marginTop: 2 }}>{label}</div>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* ── Tab bar ── */}
      <div className="svc-tab-bar" style={{ margin: "0 0 20px", borderRadius: 10 }}>
        <button className={`svc-tab${tab === "rules" ? " active" : ""}`} onClick={() => setTab("rules")}>
          <Zap aria-hidden="true" /> Rules ({rules.length})
        </button>
        <button className={`svc-tab${tab === "violations" ? " active" : ""}`} onClick={() => setTab("violations")}>
          <ShieldAlert aria-hidden="true" /> Violations {stats?.unresolved ? `(${stats.unresolved} unresolved)` : ""}
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          RULES TAB
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "rules" && (
        <AnimatePresence mode="wait">
          {rulesLoading ? (
            <motion.div key="loading" className="user-table-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Loader2 className="spin" size={28} aria-hidden="true" /><p>Loading rules…</p>
            </motion.div>
          ) : rules.length === 0 ? (
            <motion.div key="empty" className="user-table-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Zap aria-hidden="true" />
              <p>No rules defined. Click <strong>Seed defaults</strong> to load the recommended set.</p>
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "grid", gap: 10 }}>
              {rules.map((rule) => {
                const am = ACTION_META[rule.violation_action] ?? ACTION_META.block;
                return (
                  <motion.div key={rule.id}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    style={{
                      background: "#fff", border: `1.5px solid ${rule.is_active ? "#e2e8f0" : "#f1f5f9"}`,
                      borderRadius: 14, padding: "16px 18px",
                      display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center",
                      opacity: rule.is_active ? 1 : 0.6,
                    }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.4fr) 1fr 1fr 1fr", gap: 12, alignItems: "center" }}>
                      {/* Scope + label */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                          <strong style={{ fontSize: ".9rem", color: "#0f172a" }}>{rule.label || rule.scope}</strong>
                          {!rule.is_active && <span style={{ fontSize: ".68rem", fontWeight: 700, background: "#f1f5f9", color: "#94a3b8", borderRadius: 999, padding: "2px 7px" }}>INACTIVE</span>}
                        </div>
                        <code style={{ fontSize: ".72rem", color: "#64748b", background: "#f8fafc", borderRadius: 4, padding: "1px 6px" }}>{rule.scope}</code>
                      </div>

                      {/* Limit */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: ".7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>Limit</span>
                        <span style={{ fontSize: ".9rem", fontWeight: 700, color: "#1e293b" }}>{rule.limit} <span style={{ fontWeight: 400, color: "#64748b", fontSize: ".82rem" }}>{WINDOW_LABELS[rule.window]}</span></span>
                      </div>

                      {/* Action */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: ".7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>On violation</span>
                        <span style={{ fontSize: ".78rem", fontWeight: 700, color: am.color, background: am.bg, borderRadius: 6, padding: "3px 8px", width: "fit-content" }}>{am.label}</span>
                      </div>

                      {/* Violations */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: ".7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>Open violations</span>
                        <span style={{ fontSize: ".9rem", fontWeight: 700, color: rule.violation_count > 0 ? "#dc2626" : "#64748b" }}>
                          {rule.violation_count > 0 ? rule.violation_count : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => toggleRule(rule)}
                        style={{ border: `1px solid ${rule.is_active ? "#86efac" : "#e2e8f0"}`, borderRadius: 8, padding: "6px 11px", background: rule.is_active ? "#f0fdf4" : "#f8fafc", color: rule.is_active ? "#166534" : "#64748b", cursor: "pointer", fontSize: ".78rem", fontWeight: 700, fontFamily: "inherit" }}>
                        {rule.is_active ? "Active" : "Inactive"}
                      </button>
                      <button onClick={() => openEdit(rule)}
                        style={{ width: 34, height: 34, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", color: "#234395", cursor: "pointer", display: "grid", placeItems: "center" }}>
                        <Edit3 size={14} aria-hidden="true" />
                      </button>
                      {confirmDeleteId === rule.id ? (
                        <div style={{ display: "flex", gap: 5 }}>
                          <button onClick={() => deleteRule(rule.id)} disabled={deletingRuleId === rule.id}
                            style={{ border: 0, borderRadius: 7, padding: "6px 10px", background: "#dc2626", color: "#fff", cursor: "pointer", fontSize: ".78rem", fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                            {deletingRuleId === rule.id ? <Loader2 size={12} className="spin" /> : "Delete"}
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)}
                            style={{ border: "1px solid #e2e8f0", borderRadius: 7, padding: "6px 10px", background: "#fff", cursor: "pointer", fontSize: ".78rem", fontFamily: "inherit" }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(rule.id)}
                          style={{ width: 34, height: 34, border: "1px solid #fca5a5", borderRadius: 8, background: "#fff", color: "#dc2626", cursor: "pointer", display: "grid", placeItems: "center" }}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          VIOLATIONS TAB
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "violations" && (
        <div>
          {/* Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <select value={vFilter} onChange={(e) => { setVFilter(e.target.value as "all" | "unresolved"); setVPage(1); }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: ".85rem", background: "#fff" }}>
              <option value="unresolved">Unresolved only</option>
              <option value="all">All violations</option>
            </select>
            <select value={vAction} onChange={(e) => { setVAction(e.target.value); setVPage(1); }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: ".85rem", background: "#fff" }}>
              <option value="">All actions</option>
              <option value="blocked">Blocked</option>
              <option value="warned">Warned</option>
              <option value="suspended">Suspended</option>
            </select>
            <select value={vRule} onChange={(e) => { setVRule(e.target.value); setVPage(1); }}
              style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: ".85rem", background: "#fff" }}>
              <option value="">All rules</option>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.label || r.scope}</option>)}
            </select>
            <span style={{ marginLeft: "auto", fontSize: ".82rem", color: "#64748b" }}>
              {vLoading ? "Loading…" : `${vCount} violation${vCount !== 1 ? "s" : ""}`}
            </span>
            {vCount > 0 && (
              <button onClick={bulkResolve} disabled={bulkResolving}
                style={{ border: "1px solid #86efac", borderRadius: 8, padding: "7px 14px", background: "#f0fdf4", color: "#166534", cursor: bulkResolving ? "wait" : "pointer", fontSize: ".82rem", fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
                {bulkResolving ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                Resolve all shown
              </button>
            )}
          </div>

          {/* Violations table */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
            {/* Head */}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.7fr 0.7fr 0.55fr 42px", padding: "0 16px", height: 38, background: "#f8fafc", borderBottom: "1.5px solid #e8edf4", alignItems: "center", color: "#64748b", fontSize: ".7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em" }}>
              <span>Identifier</span><span>Rule</span><span>Action</span><span>Path</span><span>Time</span><span />
            </div>

            {vLoading && violations.length === 0 ? (
              <div className="user-table-empty"><Loader2 className="spin" size={26} /><p>Loading…</p></div>
            ) : violations.length === 0 ? (
              <div className="user-table-empty"><ShieldAlert aria-hidden="true" /><p>No violations match the current filter.</p></div>
            ) : violations.map((v) => {
              const tm = TAKEN_META[v.action_taken] ?? TAKEN_META.blocked;
              return (
                <div key={v.id}
                  style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.7fr 0.7fr 0.55fr 42px", padding: "12px 16px", borderTop: "1px solid #f1f5f9", alignItems: "center", background: v.is_resolved ? "#fafafa" : "#fff", opacity: v.is_resolved ? 0.65 : 1, transition: "background 120ms" }}>
                  <div>
                    <div style={{ fontSize: ".84rem", fontWeight: 600, color: "#0f172a" }}>{v.identifier}</div>
                    {v.user_name && <div style={{ fontSize: ".73rem", color: "#64748b" }}>{v.user_name}</div>}
                  </div>
                  <div style={{ fontSize: ".8rem", color: "#475569" }}>
                    <div style={{ fontWeight: 700 }}>{v.rule_label || v.rule_scope}</div>
                    <code style={{ fontSize: ".69rem", color: "#94a3b8" }}>{v.rule_scope}</code>
                  </div>
                  <span style={{ fontSize: ".75rem", fontWeight: 700, color: tm.color, background: tm.bg, borderRadius: 6, padding: "3px 8px", width: "fit-content" }}>{tm.label}</span>
                  <div style={{ fontSize: ".73rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 700 }}>{v.request_method}</span> {v.request_path || "—"}
                  </div>
                  <span style={{ fontSize: ".73rem", color: "#94a3b8" }}>{formatDt(v.created_at)}</span>
                  <button onClick={() => openViolation(v)}
                    style={{ width: 32, height: 32, border: "1px solid #e2e8f0", borderRadius: 7, background: "#fff", color: "#234395", cursor: "pointer", display: "grid", placeItems: "center" }}>
                    <Edit3 size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {vNumPages > 1 && (
            <div className="user-pagination">
              <span className="user-pagination-info">Page <strong>{vPage}</strong> of <strong>{vNumPages}</strong> · {vCount} total</span>
              <div className="user-pagination-controls">
                <button className="upg-btn" onClick={() => setVPage(1)} disabled={vPage === 1}>«</button>
                <button className="upg-btn" onClick={() => setVPage((p) => Math.max(1, p - 1))} disabled={vPage === 1}><ChevronLeft size={13} /> Prev</button>
                <button className="upg-btn" onClick={() => setVPage((p) => Math.min(vNumPages, p + 1))} disabled={vPage === vNumPages}>Next <ChevronRight size={13} /></button>
                <button className="upg-btn" onClick={() => setVPage(vNumPages)} disabled={vPage === vNumPages}>»</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Rule editor panel
      ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {ruleEditorOpen && (
          <motion.aside key={editingRule?.id ?? "new"} className="editor-panel guide-editor"
            initial={{ opacity: 0, x: 28, scale: .985 }} animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }} transition={{ type: "spring", stiffness: 340, damping: 32 }}>
            <header>
              <div>
                <span>{creatingRule ? "New rule" : "Edit rule"}</span>
                <h2>{creatingRule ? "Create rate limit rule" : (editingRule?.label || editingRule?.scope || "")}</h2>
              </div>
              <button aria-label="Close" onClick={closeRuleEditor}><X aria-hidden="true" /></button>
            </header>

            <form onSubmit={saveRule} style={{ overflowY: "auto", flex: 1 }}>
              <div className="ep-form">
                {ruleErrors._ && <p style={{ margin: 0, background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "9px 12px", fontSize: ".85rem" }} role="alert">{ruleErrors._}</p>}

                {/* Scope */}
                <div className="user-editor-field">
                  <label htmlFor="rl-scope">Scope key <span style={{ color: "#ef4444" }}>*</span></label>
                  <input id="rl-scope" type="text" required value={ruleForm.scope}
                    onChange={(e) => setRuleForm((p) => ({ ...p, scope: e.target.value }))}
                    placeholder="e.g. ticket_create" disabled={!!editingRule}
                    style={{ fontFamily: "monospace", background: editingRule ? "#f8fafc" : "#fff" }} />
                  {ruleErrors.scope && <span style={{ color: "#dc2626", fontSize: ".75rem" }}>{ruleErrors.scope}</span>}
                  <small style={{ color: "#94a3b8", fontSize: ".73rem" }}>Lowercase letters, digits and underscores. Immutable after creation.</small>
                </div>

                {/* Label */}
                <div className="user-editor-field">
                  <label htmlFor="rl-label">Label</label>
                  <input id="rl-label" type="text" value={ruleForm.label}
                    onChange={(e) => setRuleForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="Human-readable name" />
                </div>

                {/* Description */}
                <div className="user-editor-field">
                  <label htmlFor="rl-desc">Description</label>
                  <textarea id="rl-desc" rows={2} value={ruleForm.description}
                    onChange={(e) => setRuleForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="What does this rule protect?" style={{ resize: "vertical" }} />
                </div>

                {/* Limit + window */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="user-editor-field">
                    <label htmlFor="rl-limit">Max requests <span style={{ color: "#ef4444" }}>*</span></label>
                    <input id="rl-limit" type="number" min={1} max={100000} required
                      value={ruleForm.limit}
                      onChange={(e) => setRuleForm((p) => ({ ...p, limit: Number(e.target.value) }))} />
                    {ruleErrors.limit && <span style={{ color: "#dc2626", fontSize: ".75rem" }}>{ruleErrors.limit}</span>}
                  </div>
                  <div className="user-editor-field">
                    <label htmlFor="rl-window">Window <span style={{ color: "#ef4444" }}>*</span></label>
                    <select id="rl-window" value={ruleForm.window}
                      onChange={(e) => setRuleForm((p) => ({ ...p, window: e.target.value as RateLimitRule["window"] }))}>
                      <option value="second">Per second</option>
                      <option value="minute">Per minute</option>
                      <option value="hour">Per hour</option>
                      <option value="day">Per day</option>
                    </select>
                  </div>
                </div>

                {/* Violation action */}
                <div className="user-editor-field">
                  <label htmlFor="rl-action">Violation action</label>
                  <select id="rl-action" value={ruleForm.violation_action}
                    onChange={(e) => setRuleForm((p) => ({ ...p, violation_action: e.target.value as RateLimitRule["violation_action"] }))}>
                    <option value="block">Block the request (HTTP 429)</option>
                    <option value="warn">Allow but log the violation</option>
                    <option value="suspend">Suspend the user account automatically</option>
                  </select>
                  {ruleForm.violation_action === "suspend" && (
                    <p style={{ margin: "4px 0 0", fontSize: ".74rem", background: "#ede9fe", color: "#5b21b6", borderRadius: 7, padding: "7px 10px", lineHeight: 1.5 }}>
                      ⚠ The user's account will be automatically suspended and all active sessions invalidated. Use with caution.
                    </p>
                  )}
                </div>

                {/* Violation threshold */}
                <div className="user-editor-field">
                  <label htmlFor="rl-threshold">Violation threshold</label>
                  <input id="rl-threshold" type="number" min={0} max={1000}
                    value={ruleForm.violation_threshold}
                    onChange={(e) => setRuleForm((p) => ({ ...p, violation_threshold: Number(e.target.value) }))} />
                  <small style={{ color: "#94a3b8", fontSize: ".73rem" }}>
                    Number of excess requests before the action fires. 0 = fire on the first request over the limit.
                  </small>
                </div>

                {/* Active */}
                <div className="perm-section">
                  <div className="perm-section-header">Rule status</div>
                  <label className="perm-checkbox-row">
                    <input type="checkbox" checked={ruleForm.is_active}
                      onChange={(e) => setRuleForm((p) => ({ ...p, is_active: e.target.checked }))} />
                    <div className="perm-checkbox-text">
                      <strong>Active</strong>
                      <small>Inactive rules are ignored by the throttle engine.</small>
                    </div>
                  </label>
                </div>
              </div>
            </form>

            {/* Footer */}
            <div className="user-editor-footer">
              <div />
              <div className="user-editor-footer-right">
                <button type="button" className="secondary-button" onClick={closeRuleEditor}>Cancel</button>
                <button type="submit" form="" className="primary-button" disabled={ruleSaving}
                  onClick={(e) => { e.preventDefault(); const f = document.querySelector<HTMLFormElement>(".editor-panel form"); f?.requestSubmit(); }}>
                  {ruleSaving ? "Saving…" : creatingRule ? "Create rule" : "Save changes"}
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Violation detail panel ── */}
      <AnimatePresence>
        {editingViolation && (
          <>
            <motion.div key="vbd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 1100 }}
              onClick={() => !vSaving && setEditingViolation(null)} />
            <div style={{ position: "fixed", inset: 0, zIndex: 1101, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
              <motion.div role="dialog" aria-modal="true" initial={{ opacity: 0, scale: .94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: .94 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}
                style={{ background: "#fff", borderRadius: 16, boxShadow: "0 24px 64px rgba(15,23,42,.28)", width: "min(92vw, 520px)", pointerEvents: "all", overflow: "hidden" }}>

                <div style={{ padding: "18px 20px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: ".7rem", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".08em" }}>Violation #{editingViolation.id}</p>
                    <h2 style={{ margin: "3px 0 0", fontSize: "1rem", fontWeight: 800 }}>{editingViolation.rule_label || editingViolation.rule_scope}</h2>
                  </div>
                  <button onClick={() => setEditingViolation(null)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 4 }}><X size={18} /></button>
                </div>

                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Detail grid */}
                  {([
                    ["Identifier",    editingViolation.identifier],
                    ["User",          editingViolation.user_name || "—"],
                    ["Action taken",  TAKEN_META[editingViolation.action_taken]?.label ?? editingViolation.action_taken],
                    ["Request count", String(editingViolation.request_count)],
                    ["Method + path", `${editingViolation.request_method} ${editingViolation.request_path || "—"}`],
                    ["IP address",    editingViolation.ip_address || "—"],
                    ["Time",          formatDt(editingViolation.created_at)],
                    ["Status",        editingViolation.is_resolved ? "Resolved" : "Unresolved"],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, fontSize: ".85rem" }}>
                      <span style={{ color: "#64748b", fontWeight: 600 }}>{k}</span>
                      <span style={{ color: "#0f172a", wordBreak: "break-word" }}>{v}</span>
                    </div>
                  ))}

                  {/* Notes */}
                  {!editingViolation.is_resolved && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <label style={{ fontSize: ".78rem", fontWeight: 700, color: "#374151" }}>Admin notes (optional)</label>
                      <textarea rows={3} value={vNotes} onChange={(e) => setVNotes(e.target.value)}
                        placeholder="Describe what action was taken or why this is resolved…"
                        style={{ border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".85rem", fontFamily: "inherit", resize: "vertical" }} />
                    </div>
                  )}
                </div>

                <div style={{ padding: "13px 20px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" className="secondary-button" onClick={() => setEditingViolation(null)} disabled={vSaving}>Close</button>
                  {!editingViolation.is_resolved && (
                    <button type="button" className="primary-button" disabled={vSaving}
                      style={{ display: "flex", alignItems: "center", gap: 7 }}
                      onClick={() => resolveViolation(editingViolation)}>
                      {vSaving ? <><Loader2 size={13} className="spin" /> Saving…</> : <><CheckCircle2 size={13} /> Mark resolved</>}
                    </button>
                  )}
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
