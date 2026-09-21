"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2, Eye, EyeOff, ImagePlus, Loader2,
  Megaphone, Pencil, Plus, Trash2, X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { csrfToken } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Announcement {
  id: number;
  campaign_id: string;
  title: string;
  image_url: string | null;
  alt_text: string;
  link_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

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

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

const EMPTY_FORM = {
  campaign_id: "", title: "", alt_text: "", link_url: "", is_active: false,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const [list, setList]       = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [notice, setNotice]   = useState("");

  // Editor state
  const [editing, setEditing]   = useState<Announcement | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm]         = useState({ ...EMPTY_FORM });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
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

  // ── Open editor ───────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null);
    setCreating(true);
    setForm({ ...EMPTY_FORM });
    setImageFile(null);
    setImagePreview(null);
    setError(""); setNotice("");
  }

  function openEdit(ann: Announcement) {
    setEditing(ann);
    setCreating(false);
    setForm({
      campaign_id: ann.campaign_id,
      title:       ann.title,
      alt_text:    ann.alt_text,
      link_url:    ann.link_url,
      is_active:   ann.is_active,
    });
    setImageFile(null);
    setImagePreview(ann.image_url);
    setError(""); setNotice("");
  }

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setImageFile(null);
    setImagePreview(null);
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
    setSaving(true);
    setError(""); setNotice("");

    try {
      const token = await csrfToken();
      const fd = new FormData();
      fd.append("campaign_id", form.campaign_id);
      fd.append("title",       form.title);
      fd.append("alt_text",    form.alt_text);
      fd.append("link_url",    form.link_url);
      fd.append("is_active",   String(form.is_active));
      if (imageFile) fd.append("image", imageFile);

      const url = editing
        ? `/api/v1/admin/announcements/${editing.id}/`
        : "/api/v1/admin/announcements/";
      const method = editing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "X-CSRFToken": token },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(messageFrom(data));

      setNotice(editing ? "Announcement updated." : "Announcement created.");
      closeEditor();
      load();
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
      setNotice(ann.is_active ? "Deactivated." : "Activated — all others deactivated.");
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
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Home page</p>
          <h1>Announcements</h1>
          <p>Manage the welcome modal shown to visitors on the home page.</p>
        </div>
        <button className="primary-button" onClick={openCreate} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Plus size={16} aria-hidden="true" /> New announcement
        </button>
      </header>

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

      {/* ── Announcement list ── */}
      {loading ? (
        <div className="empty-row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Loader2 className="spin" size={18} aria-hidden="true" /> Loading…
        </div>
      ) : list.length === 0 ? (
        <div className="empty-row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Megaphone size={20} style={{ color: "#234395" }} aria-hidden="true" />
          No announcements yet. Create one to show a welcome modal on the home page.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {list.map((ann, i) => (
            <motion.article
              key={ann.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.18) }}
              style={{
                background: "#fff", border: `1.5px solid ${ann.is_active ? "#a5b4fc" : "#e2e8f0"}`,
                borderRadius: 14, padding: "16px 20px",
                display: "grid", gridTemplateColumns: "64px 1fr auto",
                gap: 16, alignItems: "center",
                boxShadow: ann.is_active ? "0 0 0 3px rgba(165,180,252,.25)" : "none",
              }}
            >
              {/* Thumbnail */}
              <div style={{
                width: 64, height: 64, borderRadius: 10, overflow: "hidden",
                background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {ann.image_url
                  ? <img src={ann.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <ImagePlus size={22} style={{ color: "#94a3b8" }} aria-hidden="true" />
                }
              </div>

              {/* Info */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: ".95rem" }}>{ann.title || ann.campaign_id}</strong>
                  {ann.is_active
                    ? <span className="status-chip active" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle2 size={11} aria-hidden="true" /> Active</span>
                    : <span className="status-chip archived">Inactive</span>
                  }
                </div>
                <p style={{ margin: "3px 0 0", fontSize: ".8rem", color: "#64748b" }}>
                  <code style={{ fontSize: ".78rem", background: "#f1f5f9", borderRadius: 4, padding: "1px 5px" }}>{ann.campaign_id}</code>
                  {ann.alt_text && <span style={{ marginLeft: 8 }}>{ann.alt_text}</span>}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: ".75rem", color: "#94a3b8" }}>
                  Updated {formatDate(ann.updated_at)}
                </p>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <button
                  onClick={() => toggleActive(ann)}
                  title={ann.is_active ? "Deactivate" : "Activate"}
                  style={{
                    border: "1px solid #dbe2ee", borderRadius: 9, padding: "7px 10px",
                    background: "#fff", cursor: "pointer", color: ann.is_active ? "#166534" : "#64748b",
                    display: "flex", alignItems: "center", gap: 5, fontSize: ".8rem", fontWeight: 700,
                  }}
                >
                  {ann.is_active ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  {ann.is_active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => openEdit(ann)}
                  aria-label={`Edit ${ann.title || ann.campaign_id}`}
                  style={{ border: "1px solid #dbe2ee", borderRadius: 9, padding: 8, background: "#fff", cursor: "pointer", color: "#234395" }}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  onClick={() => deleteAnn(ann.id)}
                  disabled={deleting === ann.id}
                  aria-label={`Delete ${ann.title || ann.campaign_id}`}
                  style={{ border: "1px solid #fecaca", borderRadius: 9, padding: 8, background: "#fff", cursor: "pointer", color: "#dc2626" }}
                >
                  {deleting === ann.id
                    ? <Loader2 size={15} className="spin" aria-hidden="true" />
                    : <Trash2 size={15} aria-hidden="true" />}
                </button>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      {/* ── Editor panel ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            key={editing?.id ?? "new"}
            className="editor-panel guide-editor"
            initial={{ opacity: 0, x: 28, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label={creating ? "New announcement" : "Edit announcement"}
          >
            <header>
              <div>
                <span>{creating ? "New announcement" : "Edit announcement"}</span>
                <h2>{creating ? "Create announcement" : (editing?.title || editing?.campaign_id || "")}</h2>
              </div>
              <button aria-label="Close editor" onClick={closeEditor}><X aria-hidden="true" /></button>
            </header>

            <form onSubmit={submit} style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
              <div className="svc-details-form" style={{ display: "flex", flexDirection: "column", gap: 14, padding: "20px 22px", flex: 1 }}>

                {error && (
                  <p style={{ margin: 0, color: "#991b1b", background: "#fee2e2", borderRadius: 8, padding: "9px 12px", fontSize: ".85rem" }} role="alert">
                    {error}
                  </p>
                )}

                {/* Campaign ID */}
                <div>
                  <label htmlFor="ann-campaign-id">
                    Campaign ID <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    id="ann-campaign-id"
                    type="text" required
                    value={form.campaign_id}
                    onChange={(e) => setForm((p) => ({ ...p, campaign_id: e.target.value }))}
                    placeholder="e.g. orientation-2026"
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    title="Lowercase letters, digits and hyphens only"
                    disabled={!!editing} /* immutable after creation */
                  />
                  <small style={{ color: "#64748b", fontSize: ".75rem" }}>
                    Unique slug. Changing it will re-show the modal to users who already dismissed it.
                    {editing && " (Cannot be changed after creation.)"}
                  </small>
                </div>

                {/* Title */}
                <div>
                  <label htmlFor="ann-title">Internal title</label>
                  <input
                    id="ann-title" type="text"
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Orientation Week 2026"
                    maxLength={160}
                  />
                </div>

                {/* Alt text */}
                <div>
                  <label htmlFor="ann-alt">
                    Alt text <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    id="ann-alt" type="text" required
                    value={form.alt_text}
                    onChange={(e) => setForm((p) => ({ ...p, alt_text: e.target.value }))}
                    placeholder="Describe the banner for screen readers"
                    maxLength={300}
                  />
                </div>

                {/* Link URL */}
                <div>
                  <label htmlFor="ann-link">Link URL <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span></label>
                  <input
                    id="ann-link" type="url"
                    value={form.link_url}
                    onChange={(e) => setForm((p) => ({ ...p, link_url: e.target.value }))}
                    placeholder="https://..."
                  />
                </div>

                {/* Image upload */}
                <div>
                  <label>
                    Banner image {creating && <span style={{ color: "#ef4444" }}>*</span>}
                  </label>
                  <div
                    className="pdf-dropzone"
                    style={{ minHeight: 100 }}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                    tabIndex={0}
                    role="button"
                    aria-label="Choose banner image"
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
                        src={imagePreview}
                        alt="Preview"
                        style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 8, objectFit: "contain" }}
                      />
                    ) : (
                      <>
                        <ImagePlus aria-hidden="true" />
                        <strong>Click to upload image</strong>
                        <span>JPEG, PNG or WebP — recommended 800 × 600 px</span>
                      </>
                    )}
                  </div>
                  {imagePreview && (
                    <button
                      type="button"
                      onClick={() => { setImageFile(null); setImagePreview(editing?.image_url ?? null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      style={{ marginTop: 6, fontSize: ".78rem", color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      {imageFile ? "Remove new image" : "Keep existing image"}
                    </button>
                  )}
                </div>

                {/* Active toggle */}
                <div>
                  <label>Active</label>
                  <div
                    className="svc-active-toggle"
                    onClick={() => setForm((p) => ({ ...p, is_active: !p.is_active }))}
                  >
                    <span style={{ fontSize: ".88rem", color: form.is_active ? "#166534" : "#64748b" }}>
                      {form.is_active ? "Enabled — visible on home page" : "Disabled — not shown"}
                    </span>
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                      aria-label="Active"
                    />
                  </div>
                  {form.is_active && (
                    <small style={{ color: "#92400e", fontSize: ".75rem" }}>
                      Activating this will automatically deactivate all other announcements.
                    </small>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div style={{
                borderTop: "1px solid #e2e8f0", padding: "14px 22px",
                background: "#f8fafc", display: "flex", justifyContent: "flex-end",
                gap: 10, flexShrink: 0,
              }}>
                <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}
                  style={{ display: "flex", alignItems: "center", gap: 7 }}>
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
  );
}
