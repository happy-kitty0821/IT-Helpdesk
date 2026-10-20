"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Calendar, CheckCircle2, Eye, EyeOff, ImagePlus,
  Loader2, Megaphone, Pencil, Plus, Trash2, X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { csrfToken } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Announcement {
  id: number;
  campaign_id: string;
  title: string;
  body: string;
  image_url: string | null;
  alt_text: string;
  link_url: string;
  audience: string;
  priority: number;
  is_active: boolean;
  scheduled_start: string | null;
  scheduled_end:   string | null;
  created_at: string;
  updated_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUDIENCE_LABELS: Record<string, string> = {
  all:     "Everyone",
  public:  "Visitors (unauthenticated)",
  student: "Students",
  staff:   "Faculty & staff",
};

const PRIORITY_LABELS: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: "Low",    color: "#64748b", bg: "#f1f5f9" },
  1: { label: "Normal", color: "#1e40af", bg: "#dbeafe" },
  2: { label: "High",   color: "#92400e", bg: "#fef3c7" },
  3: { label: "Urgent", color: "#991b1b", bg: "#fee2e2" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function messageFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r)) {
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  return "The change could not be saved.";
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(iso));
}

const EMPTY_FORM = {
  campaign_id: "", title: "", body: "", alt_text: "", link_url: "",
  audience: "all", priority: 1, is_active: false,
  scheduled_start: "", scheduled_end: "",
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 999, fontSize: ".73rem", fontWeight: 800,
      background: active ? "#dcfce7" : "#f1f5f9",
      color:      active ? "#166534" : "#64748b",
    }}>
      {active && <CheckCircle2 size={10} aria-hidden="true" />}
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const [list, setList]         = useState<Announcement[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState("");

  const [editing, setEditing]   = useState<Announcement | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm]         = useState({ ...EMPTY_FORM });
  const [imageFile, setImageFile]     = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/announcements/", {
        credentials: "include", cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load announcements.");
      setList(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ── Editor helpers ────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null); setCreating(true);
    setForm({ ...EMPTY_FORM });
    setImageFile(null); setImagePreview(null);
    setError(""); setNotice("");
  }

  function openEdit(ann: Announcement) {
    setEditing(ann); setCreating(false);
    setForm({
      campaign_id:     ann.campaign_id,
      title:           ann.title,
      body:            ann.body ?? "",
      alt_text:        ann.alt_text,
      link_url:        ann.link_url,
      audience:        ann.audience ?? "all",
      priority:        ann.priority ?? 1,
      is_active:       ann.is_active,
      scheduled_start: ann.scheduled_start ? ann.scheduled_start.slice(0, 16) : "",
      scheduled_end:   ann.scheduled_end   ? ann.scheduled_end.slice(0, 16)   : "",
    });
    setImageFile(null); setImagePreview(ann.image_url ?? null);
    setError(""); setNotice("");
  }

  function closeEditor() {
    setEditing(null); setCreating(false);
    setImageFile(null); setImagePreview(null);
  }

  function patchForm<K extends keyof typeof EMPTY_FORM>(k: K, v: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // ── Image picker ──────────────────────────────────────────────────────────
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const token = await csrfToken();
      const fd = new FormData();
      fd.append("campaign_id", form.campaign_id);
      fd.append("title",       form.title);
      fd.append("body",        form.body);
      fd.append("alt_text",    form.alt_text);
      fd.append("link_url",    form.link_url);
      fd.append("audience",    form.audience);
      fd.append("priority",    String(form.priority));
      fd.append("is_active",   String(form.is_active));
      fd.append("scheduled_start", form.scheduled_start || "");
      fd.append("scheduled_end",   form.scheduled_end   || "");
      if (imageFile) fd.append("image", imageFile);

      const url    = editing ? `/api/v1/admin/announcements/${editing.id}/` : "/api/v1/admin/announcements/";
      const method = editing ? "PATCH" : "POST";
      const res    = await fetch(url, {
        method, credentials: "include",
        headers: { "X-CSRFToken": token },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(messageFrom(data));
      setNotice(editing ? "Announcement updated." : "Announcement created.");
      closeEditor(); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle active ─────────────────────────────────────────────────────────
  async function toggleActive(ann: Announcement) {
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/announcements/${ann.id}/`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ is_active: !ann.is_active }),
      });
      if (!res.ok) throw new Error("Could not update.");
      setNotice(ann.is_active ? "Deactivated." : "Activated.");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update.");
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function deleteAnn(id: number) {
    if (!window.confirm("Delete this announcement permanently?")) return;
    setDeleting(id);
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/announcements/${id}/`, {
        method: "DELETE", credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      if (!res.ok && res.status !== 204) throw new Error("Could not delete.");
      setNotice("Announcement deleted.");
      if (editing?.id === id) closeEditor();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setDeleting(null);
    }
  }

  const isOpen = creating || editing !== null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="admin-content">

      {/* Header */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Home page</p>
          <h1>Announcements</h1>
          <p>Manage the welcome banner shown to visitors on the home page.</p>
        </div>
        <button className="primary-button" onClick={openCreate}>
          <Plus size={16} aria-hidden="true" /> New announcement
        </button>
      </header>

      {/* Feedback */}
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p key="n" className="admin-notice" role="status"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {notice}
          </motion.p>
        )}
        {error && !isOpen && (
          <motion.p key="e" className="admin-error" role="alert"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Two-column layout when editor is open */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isOpen ? "1fr 400px" : "1fr",
        gap: 24,
        alignItems: "start",
        transition: "grid-template-columns 220ms ease",
      }}>

        {/* ── Announcement list ── */}
        <section aria-label="Announcement list">
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "40px 0", color: "#94a3b8", fontSize: ".9rem" }}>
              <Loader2 className="spin" size={18} aria-hidden="true" /> Loading announcements…
            </div>
          ) : list.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "60px 20px",
              border: "1.5px dashed #dbe2ee", borderRadius: 16,
              background: "#fafcff",
            }}>
              <Megaphone size={36} style={{ color: "#c7d2fe", margin: "0 auto 14px", display: "block" }} aria-hidden="true" />
              <p style={{ margin: "0 0 6px", fontWeight: 700, color: "#1e293b" }}>No announcements yet</p>
              <p style={{ margin: 0, fontSize: ".85rem", color: "#94a3b8" }}>
                Create one to show a welcome banner on the home page.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {list.map((ann, i) => {
                const isEditing = editing?.id === ann.id;
                const prio = PRIORITY_LABELS[ann.priority] ?? PRIORITY_LABELS[1];
                return (
                  <motion.article
                    key={ann.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.2) }}
                    style={{
                      background: "#fff",
                      border: `1.5px solid ${isEditing ? "#818cf8" : ann.is_active ? "#bbf7d0" : "#e2e8f0"}`,
                      borderRadius: 14,
                      boxShadow: isEditing
                        ? "0 0 0 3px rgba(129,140,248,.15)"
                        : ann.is_active
                          ? "0 0 0 3px rgba(187,247,208,.25)"
                          : "0 1px 4px rgba(15,23,42,.04)",
                      overflow: "hidden",
                      transition: "border-color 180ms, box-shadow 180ms",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 0, alignItems: "stretch" }}>

                      {/* Thumbnail strip */}
                      <div style={{
                        width: 80, minHeight: 80,
                        background: "#f8fafc",
                        borderRight: "1px solid #f1f5f9",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                        overflow: "hidden",
                      }}>
                        {ann.image_url
                          ? <img src={ann.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          : <ImagePlus size={20} style={{ color: "#cbd5e1" }} aria-hidden="true" />
                        }
                      </div>

                      {/* Content */}
                      <div style={{ padding: "14px 18px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                          <span style={{ fontWeight: 800, fontSize: ".93rem", color: "#1e293b" }}>
                            {ann.title || ann.campaign_id}
                          </span>
                          <StatusBadge active={ann.is_active} />
                          <span style={{
                            padding: "2px 9px", borderRadius: 999, fontSize: ".72rem", fontWeight: 700,
                            background: prio.bg, color: prio.color,
                          }}>
                            {prio.label}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: ".78rem", color: "#64748b" }}>
                          <span>
                            <code style={{ background: "#f1f5f9", borderRadius: 4, padding: "1px 6px", fontSize: ".74rem", color: "#475569" }}>
                              {ann.campaign_id}
                            </code>
                          </span>
                          <span>Audience: {AUDIENCE_LABELS[ann.audience] ?? ann.audience}</span>
                          {(ann.scheduled_start || ann.scheduled_end) && (
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Calendar size={11} aria-hidden="true" />
                              {ann.scheduled_start && formatDate(ann.scheduled_start)}
                              {ann.scheduled_start && ann.scheduled_end && " → "}
                              {ann.scheduled_end && formatDate(ann.scheduled_end)}
                            </span>
                          )}
                        </div>

                        {ann.body && (
                          <p style={{
                            margin: "7px 0 0", fontSize: ".8rem", color: "#475569",
                            lineHeight: 1.5,
                            display: "-webkit-box", WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical", overflow: "hidden",
                          }}>
                            {ann.body}
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div style={{
                        display: "flex", flexDirection: "column", gap: 0,
                        borderLeft: "1px solid #f1f5f9", flexShrink: 0,
                      }}>
                        <button
                          onClick={() => openEdit(ann)}
                          aria-label={`Edit ${ann.title || ann.campaign_id}`}
                          style={{
                            flex: 1, padding: "0 14px", background: isEditing ? "#eef2ff" : "#fff",
                            border: "none", borderBottom: "1px solid #f1f5f9",
                            cursor: "pointer", color: isEditing ? "#4338ca" : "#234395",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                            fontSize: ".78rem", fontWeight: 700, minWidth: 86, minHeight: 44,
                            transition: "background 120ms, color 120ms",
                          }}
                          onMouseEnter={(e) => { if (!isEditing) e.currentTarget.style.background = "#f8fafc"; }}
                          onMouseLeave={(e) => { if (!isEditing) e.currentTarget.style.background = "#fff"; }}
                        >
                          <Pencil size={13} aria-hidden="true" /> Edit
                        </button>

                        <button
                          onClick={() => toggleActive(ann)}
                          aria-label={ann.is_active ? `Deactivate ${ann.title}` : `Activate ${ann.title}`}
                          style={{
                            flex: 1, padding: "0 14px", background: "#fff",
                            border: "none", borderBottom: "1px solid #f1f5f9",
                            cursor: "pointer",
                            color: ann.is_active ? "#166534" : "#64748b",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                            fontSize: ".78rem", fontWeight: 700, minHeight: 44,
                            transition: "background 120ms",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                        >
                          {ann.is_active
                            ? <><EyeOff size={13} aria-hidden="true" /> Deactivate</>
                            : <><Eye    size={13} aria-hidden="true" /> Activate</>
                          }
                        </button>

                        <button
                          onClick={() => deleteAnn(ann.id)}
                          disabled={deleting === ann.id}
                          aria-label={`Delete ${ann.title || ann.campaign_id}`}
                          style={{
                            flex: 1, padding: "0 14px", background: "#fff",
                            border: "none",
                            cursor: deleting === ann.id ? "default" : "pointer",
                            color: "#dc2626", opacity: deleting === ann.id ? 0.5 : 1,
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                            fontSize: ".78rem", fontWeight: 700, minHeight: 44,
                            transition: "background 120ms",
                          }}
                          onMouseEnter={(e) => { if (deleting !== ann.id) e.currentTarget.style.background = "#fff5f5"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                        >
                          {deleting === ann.id
                            ? <Loader2 size={13} className="spin" aria-hidden="true" />
                            : <Trash2  size={13} aria-hidden="true" />
                          }
                          Delete
                        </button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Editor panel ── */}
        <AnimatePresence>
          {isOpen && (
            <motion.aside
              key={editing?.id ?? "new"}
              className="editor-panel guide-editor"
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              aria-label={creating ? "New announcement" : "Edit announcement"}
            >
              {/* Panel header */}
              <header>
                <div>
                  <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>
                    {creating ? "New announcement" : "Editing"}
                  </span>
                  <h2 style={{ marginTop: 2 }}>
                    {creating ? "Create announcement" : (editing?.title || editing?.campaign_id)}
                  </h2>
                </div>
                <button aria-label="Close editor" onClick={closeEditor}><X aria-hidden="true" /></button>
              </header>

              <form onSubmit={submit} style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 22px", flex: 1 }}>

                  {error && (
                    <p role="alert" style={{
                      margin: 0, color: "#991b1b", background: "#fee2e2",
                      border: "1px solid #fca5a5", borderRadius: 9,
                      padding: "10px 14px", fontSize: ".84rem",
                    }}>
                      {error}
                    </p>
                  )}

                  {/* Campaign ID */}
                  <label>
                    Campaign ID <span style={{ color: "#ef4444" }}>*</span>
                    <input
                      type="text" required
                      value={form.campaign_id}
                      onChange={(e) => patchForm("campaign_id", e.target.value)}
                      placeholder="e.g. orientation-2026"
                      pattern="[a-z0-9][-a-z0-9]*"
                      title="Lowercase letters, digits and hyphens only"
                      disabled={!!editing}
                    />
                    <small style={{ color: "#64748b", fontSize: ".74rem", fontWeight: 400 }}>
                      Unique slug. {editing ? "Cannot be changed after creation." : "Changing it re-shows the modal to returning users."}
                    </small>
                  </label>

                  {/* Title */}
                  <label>
                    Internal title
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => patchForm("title", e.target.value)}
                      placeholder="e.g. Orientation Week 2026"
                      maxLength={160}
                    />
                  </label>

                  {/* Alt text */}
                  <label>
                    Alt text <span style={{ color: "#ef4444" }}>*</span>
                    <input
                      type="text" required
                      value={form.alt_text}
                      onChange={(e) => patchForm("alt_text", e.target.value)}
                      placeholder="Describe the banner for screen readers"
                      maxLength={300}
                    />
                  </label>

                  {/* Link URL */}
                  <label>
                    <span>Link URL <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: ".8rem" }}>optional</span></span>
                    <input
                      type="url"
                      value={form.link_url}
                      onChange={(e) => patchForm("link_url", e.target.value)}
                      placeholder="https://…"
                    />
                  </label>

                  {/* Body */}
                  <label>
                    <span>Body text <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: ".8rem" }}>optional</span></span>
                    <textarea
                      rows={3}
                      value={form.body}
                      onChange={(e) => patchForm("body", e.target.value)}
                      placeholder="Short announcement text shown in the modal"
                    />
                  </label>

                  {/* Audience + Priority */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label>
                      Audience
                      <select value={form.audience} onChange={(e) => patchForm("audience", e.target.value)}>
                        <option value="all">Everyone</option>
                        <option value="public">Visitors only</option>
                        <option value="student">Students</option>
                        <option value="staff">Faculty &amp; staff</option>
                      </select>
                    </label>
                    <label>
                      Priority
                      <select value={form.priority} onChange={(e) => patchForm("priority", Number(e.target.value))}>
                        <option value={0}>Low</option>
                        <option value={1}>Normal</option>
                        <option value={2}>High</option>
                        <option value={3}>Urgent</option>
                      </select>
                    </label>
                  </div>

                  {/* Image upload */}
                  <label>
                    Banner image {creating && <span style={{ color: "#ef4444" }}>*</span>}
                    <div
                      className="pdf-dropzone"
                      style={{ minHeight: 90, cursor: "pointer" }}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                      tabIndex={0} role="button" aria-label="Choose banner image"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={onFileChange}
                        required={creating && !imagePreview}
                      />
                      {imagePreview ? (
                        <img
                          src={imagePreview} alt="Preview"
                          style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8, objectFit: "contain" }}
                        />
                      ) : (
                        <>
                          <ImagePlus aria-hidden="true" />
                          <strong>Click to upload image</strong>
                          <span>JPEG, PNG or WebP — 800 × 600 px recommended</span>
                        </>
                      )}
                    </div>
                    {imagePreview && (
                      <button
                        type="button"
                        onClick={() => {
                          setImageFile(null);
                          setImagePreview(editing?.image_url ?? null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        style={{
                          marginTop: 4, fontSize: ".75rem", color: "#64748b",
                          background: "none", border: "none", cursor: "pointer", padding: 0,
                        }}
                      >
                        {imageFile ? "Remove new image" : "Keep existing image"}
                      </button>
                    )}
                  </label>

                  {/* Active toggle */}
                  <label>
                    Visibility
                    <div
                      onClick={() => patchForm("is_active", !form.is_active)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 12, padding: "11px 14px", cursor: "pointer",
                        background: form.is_active ? "#f0fdf4" : "#f8fafc",
                        border: `1.5px solid ${form.is_active ? "#86efac" : "#dbe2ee"}`,
                        borderRadius: 10, transition: "all 140ms",
                      }}
                    >
                      <span style={{ fontSize: ".85rem", fontWeight: 600, color: form.is_active ? "#166534" : "#64748b" }}>
                        {form.is_active ? "Enabled — visible on home page" : "Disabled — not shown to users"}
                      </span>
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(e) => patchForm("is_active", e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Active"
                        style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer" }}
                      />
                    </div>
                    {form.is_active && (
                      <small style={{ color: "#92400e", fontSize: ".74rem", fontWeight: 400 }}>
                        Activating this will automatically deactivate all other announcements.
                      </small>
                    )}
                  </label>

                  {/* Scheduling */}
                  <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                    <p style={{ margin: "0 0 12px", fontSize: ".85rem", fontWeight: 700, color: "#334155" }}>
                      Schedule{" "}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: ".78rem" }}>
                        optional — leave blank to always show while active
                      </span>
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label style={{ fontSize: ".8rem" }}>
                        Starts
                        <input
                          type="datetime-local"
                          value={form.scheduled_start}
                          onChange={(e) => patchForm("scheduled_start", e.target.value)}
                        />
                      </label>
                      <label style={{ fontSize: ".8rem" }}>
                        Ends
                        <input
                          type="datetime-local"
                          value={form.scheduled_end}
                          onChange={(e) => patchForm("scheduled_end", e.target.value)}
                        />
                      </label>
                    </div>
                    <small style={{ color: "#64748b", fontSize: ".74rem", fontWeight: 400, marginTop: 6, display: "block" }}>
                      Times are in your local timezone.
                    </small>
                  </div>
                </div>

                {/* Footer */}
                <div style={{
                  borderTop: "1px solid #e2e8f0", padding: "14px 22px",
                  background: "#f8fafc", display: "flex", justifyContent: "flex-end",
                  gap: 10, flexShrink: 0,
                }}>
                  <button type="button" className="secondary-button" onClick={closeEditor}>
                    Cancel
                  </button>
                  <button
                    type="submit" className="primary-button" disabled={saving}
                    style={{ display: "flex", alignItems: "center", gap: 7 }}
                  >
                    {saving
                      ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Saving…</>
                      : creating ? "Create announcement" : "Save changes"
                    }
                  </button>
                </div>
              </form>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
