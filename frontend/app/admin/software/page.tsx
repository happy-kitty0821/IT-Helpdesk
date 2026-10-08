"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, CheckCircle2, Clock, Download, ExternalLink,
  FileUp, HardDrive, Loader2, Package, Pencil, Plus,
  Search, Trash2, X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { adminGet, type Guide, type Software } from "@/lib/admin-api";
import { csrfToken } from "@/lib/auth";
import { useUploadQueue } from "@/lib/upload-queue";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_OPTIONS = ["Windows", "macOS", "Linux", "Web", "Android", "iOS"];

const PLATFORM_ICONS: Record<string, string> = {
  Windows: "🪟", macOS: "🍎", Linux: "🐧",
  Web: "🌐", Android: "🤖", iOS: "📱",
};

const AUDIENCE_OPTIONS = [
  { value: "all",     label: "Students & staff" },
  { value: "student", label: "Students only" },
  { value: "staff",   label: "Faculty & staff" },
  { value: "public",  label: "Public" },
];

const AUDIENCE_META: Record<string, { color: string; bg: string }> = {
  all:     { color: "#1d4ed8", bg: "#dbeafe" },
  student: { color: "#0f766e", bg: "#ccfbf1" },
  staff:   { color: "#7c3aed", bg: "#ede9fe" },
  public:  { color: "#6b7280", bg: "#f3f4f6" },
};

const STATUS_OPTIONS = [
  { value: "draft",    label: "Draft" },
  { value: "active",   label: "Active" },
  { value: "archived", label: "Archived" },
];

const MAX_FILE_BYTES = 25 * 1024 * 1024 * 1024; // 25 GB hard cap
const CHUNK_SIZE     = 2 * 1024 * 1024;          // 2 MB default, overridden by site settings

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(t: string) {
  return t.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function messageFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r))
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }
  return "Software could not be saved.";
}

// ── FileDropzone ──────────────────────────────────────────────────────────────

function FileDropzone({
  existing, pending, onSelect, onRemovePending, onRemoveExisting, disabled,
  maxFileSizeBytes = MAX_FILE_BYTES, chunkSizeBytes = CHUNK_SIZE,
}: {
  existing: { name: string; size: number; url: string } | null;
  pending:  File | null;
  onSelect: (f: File) => void;
  onRemovePending:  () => void;
  onRemoveExisting: () => void;
  disabled?: boolean;
  maxFileSizeBytes?: number;
  chunkSizeBytes?:  number;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function pick(file: File) {
    if (file.size > maxFileSizeBytes) {
      alert(`File too large (${formatBytes(file.size)}). Max is ${formatBytes(maxFileSizeBytes)}.`);
      return;
    }
    onSelect(file);
  }

  // ── Pending (local, not yet uploaded) ─────────────────────────────────────
  if (pending) {
    const chunks = Math.ceil(pending.size / chunkSizeBytes);
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        border: "1.5px solid #818cf8", borderRadius: 10,
        background: "#f5f3ff", padding: "12px 14px",
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 8, background: "#ede9fe",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <HardDrive size={18} style={{ color: "#4f46e5" }} aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: ".85rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pending.name}
          </strong>
          <span style={{ fontSize: ".73rem", color: "#6366f1" }}>
            {formatBytes(pending.size)}
            {chunks > 1 && <> · {chunks} × {formatBytes(chunkSizeBytes)} chunks</>}
          </span>
        </div>
        <button type="button" onClick={onRemovePending} disabled={disabled}
          style={{ border: "1.5px solid #c4b5fd", borderRadius: 7, background: "#fff", cursor: "pointer", color: "#7c3aed", padding: 5, display: "flex" }}
          aria-label="Remove">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  // ── Existing server-hosted file ────────────────────────────────────────────
  if (existing) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        border: "1.5px solid #86efac", borderRadius: 10,
        background: "#f0fdf4", padding: "12px 14px",
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 8, background: "#dcfce7",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <HardDrive size={18} style={{ color: "#16a34a" }} aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: ".85rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {existing.name}
          </strong>
          <span style={{ fontSize: ".73rem", color: "#15803d" }}>
            {formatBytes(existing.size)} · Hosted on server
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" title="Download" aria-label="Download file"
            style={{ border: "1.5px solid #86efac", borderRadius: 7, background: "#fff", cursor: "pointer", color: "#16a34a", padding: 6, display: "flex" }}
            onClick={async () => {
              const res = await fetch(existing.url, { credentials: "include" }).catch(() => null);
              if (!res?.ok) { alert("Download failed."); return; }
              const blob = await res.blob();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = existing.name;
              a.click();
              URL.revokeObjectURL(a.href);
            }}>
            <Download size={13} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => ref.current?.click()} disabled={disabled}
            title="Replace file" aria-label="Replace file"
            style={{ border: "1.5px solid #dbe2ee", borderRadius: 7, background: "#fff", cursor: "pointer", color: "#475569", padding: 6, display: "flex" }}>
            <FileUp size={13} aria-hidden="true" />
          </button>
          <button type="button" onClick={onRemoveExisting} disabled={disabled}
            title="Remove file" aria-label="Remove file"
            style={{ border: "1.5px solid #fca5a5", borderRadius: 7, background: "#fff", cursor: "pointer", color: "#dc2626", padding: 6, display: "flex" }}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
        <input ref={ref} type="file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); if (ref.current) ref.current.value = ""; }}
          style={{ display: "none" }} />
      </div>
    );
  }

  // ── Empty drop zone ────────────────────────────────────────────────────────
  return (
    <div
      role="button" tabIndex={0}
      aria-label="Upload installer file"
      onDrop={(e) => { e.preventDefault(); if (!disabled) { const f = e.dataTransfer.files[0]; if (f) pick(f); } }}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => !disabled && ref.current?.click()}
      onKeyDown={(e) => !disabled && e.key === "Enter" && ref.current?.click()}
      style={{
        border: "2px dashed var(--border)", borderRadius: 10,
        padding: "22px 16px", textAlign: "center",
        background: "var(--background)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.background = "#f5f3ff"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--background)"; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: "#e0e7ff",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 10px",
      }}>
        <FileUp size={18} style={{ color: "#4f46e5" }} aria-hidden="true" />
      </div>
      <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: ".85rem", color: "#334155" }}>
        Drop installer here or click to browse
      </p>
      <p style={{ margin: 0, fontSize: ".72rem", color: "#94a3b8" }}>
        Any file type · Max {formatBytes(maxFileSizeBytes)} · Uploaded in {formatBytes(chunkSizeBytes)} chunks
      </p>
      <input ref={ref} type="file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); if (ref.current) ref.current.value = ""; }}
        style={{ display: "none" }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── DeleteConfirm ─────────────────────────────────────────────────────────────

function DeleteConfirm({ item, onConfirm, onCancel, deleting }: {
  item: Software; onConfirm: () => void; onCancel: () => void; deleting: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,23,42,.45)", backdropFilter: "blur(4px)",
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", border: "1.5px solid var(--border)",
          borderRadius: 16, padding: "28px 28px 24px",
          maxWidth: 420, width: "100%",
          boxShadow: "0 24px 60px rgba(15,23,42,.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: "#fee2e2",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Trash2 size={20} style={{ color: "#dc2626" }} aria-hidden="true" />
          </div>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 800 }}>Delete software entry</h2>
            <p style={{ margin: 0, fontSize: ".85rem", color: "var(--muted)", lineHeight: 1.5 }}>
              <strong>{item.name}</strong> will be permanently removed from the catalogue
              {item.file_url ? " and the hosted installer file will be deleted" : ""}.
              This cannot be undone.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="secondary-button" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button
            onClick={onConfirm} disabled={deleting}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "10px 20px", border: "none", borderRadius: 10,
              background: "#dc2626", color: "#fff",
              fontWeight: 700, cursor: "pointer", fontSize: ".88rem",
            }}
          >
            {deleting
              ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Deleting…</>
              : <><Trash2 size={14} aria-hidden="true" /> Delete permanently</>
            }
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SoftwareManagement() {
  const { enqueue } = useUploadQueue();
  const [items,  setItems]  = useState<Software[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing,  setEditing]  = useState<Software | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [formError, setFormError] = useState("");
  const [notice,    setNotice]    = useState("");
  const [search,    setSearch]    = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Software | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // Form fields
  const [draftName,      setDraftName]      = useState("");
  const [draftSlug,      setDraftSlug]      = useState("");
  const [draftDesc,      setDraftDesc]      = useState("");
  const [draftVersion,   setDraftVersion]   = useState("");
  const [draftPlatforms, setDraftPlatforms] = useState<string[]>(["Windows"]);
  const [draftAudience,  setDraftAudience]  = useState("all");
  const [draftLicence,   setDraftLicence]   = useState("");
  const [draftUrl,       setDraftUrl]       = useState("");
  const [draftGuide,     setDraftGuide]     = useState<number | "">("");
  const [draftStatus,    setDraftStatus]    = useState("draft");
  const [pendingFile,    setPendingFile]    = useState<File | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);

  // Upload config from site settings
  const [uploadConfig, setUploadConfig] = useState({
    chunkSizeBytes:   CHUNK_SIZE,
    maxFileSizeBytes: MAX_FILE_BYTES,
    retries:          3,
  });

  // ── Load ──────────────────────────────────────────────────────────────────

  function load() {
    Promise.all([adminGet<Software[]>("software"), adminGet<Guide[]>("guides")])
      .then(([sw, gs]) => { setItems(sw); setGuides(gs); })
      .catch((e: Error) => setFormError(e.message));
  }

  useEffect(() => {
    load();
    fetch("/api/v1/settings/site/", { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { chunk_size_mb?: number; max_upload_size_gb?: number; upload_chunk_retries?: number } | null) => {
        if (!d) return;
        setUploadConfig({
          chunkSizeBytes:   (d.chunk_size_mb    ?? 2)  * 1024 * 1024,
          maxFileSizeBytes: (d.max_upload_size_gb ?? 25) * 1024 * 1024 * 1024,
          retries:           d.upload_chunk_retries ?? 3,
        });
      })
      .catch(() => {});
  }, []);

  // ── Editor helpers ─────────────────────────────────────────────────────────

  function resetFile() {
    setPendingFile(null);
    setRemoveExisting(false);
  }

  function openCreate() {
    setEditing(null); setCreating(true);
    setDraftName(""); setDraftSlug(""); setDraftDesc(""); setDraftVersion("");
    setDraftPlatforms(["Windows"]); setDraftAudience("all");
    setDraftLicence(""); setDraftUrl(""); setDraftGuide(""); setDraftStatus("draft");
    resetFile(); setFormError(""); setNotice("");
  }

  function openEdit(item: Software) {
    setCreating(false); setEditing(item);
    setDraftName(item.name); setDraftSlug(item.slug);
    setDraftDesc(item.description); setDraftVersion(item.version);
    setDraftPlatforms([...item.platforms]); setDraftAudience(item.audience);
    setDraftLicence(item.licence_notes); setDraftUrl(item.download_url);
    setDraftGuide(item.guide ?? ""); setDraftStatus(item.status);
    resetFile(); setFormError(""); setNotice("");
  }

  function closeEditor() { setEditing(null); setCreating(false); resetFile(); }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await csrfToken();
      const res = await fetch(`/api/v1/admin/software/${deleteTarget.id}/`, {
        method: "DELETE", credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}));
        throw new Error(messageFrom(d));
      }
      setNotice(`"${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      if (editing?.id === deleteTarget.id) closeEditor();
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not delete.");
      setDeleteTarget(null);
    } finally { setDeleting(false); }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(""); setNotice(""); setSaving(true);

    const isEdit = !!editing;
    const apiUrl = `/api/v1/admin/software/${isEdit ? `${editing!.id}/` : ""}`;
    const savedName = draftName;

    try {
      const token = await csrfToken();

      // Build body without a file — save metadata immediately so the editor
      // can close. The file (if any) uploads in the background queue.
      const body: Record<string, unknown> = {
        name: draftName, slug: draftSlug, description: draftDesc,
        version: draftVersion, platforms: draftPlatforms, audience: draftAudience,
        licence_notes: draftLicence, download_url: draftUrl,
        guide: draftGuide !== "" ? Number(draftGuide) : null,
        status: draftStatus,
      };
      if (removeExisting) body.remove_file = true;
      // If no pending file, file_path is not sent → existing file is kept.

      const res = await fetch(apiUrl, {
        method: isEdit ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(messageFrom(data));

      // The record was saved — capture its ID for the background patch
      const savedId: number = isEdit ? editing!.id : (data as { id: number }).id;

      // Close the editor immediately
      closeEditor();
      setNotice(isEdit ? `"${savedName}" updated.` : `"${savedName}" added to the catalogue.`);
      load();

      // If there's a file, enqueue it in the background
      if (pendingFile) {
        enqueue({
          file: pendingFile,
          chunkSize: uploadConfig.chunkSizeBytes,
          retries:   uploadConfig.retries,
          onComplete: async (finalPath) => {
            // Attach the uploaded file to the record
            const ct = await csrfToken();
            await fetch(`/api/v1/admin/software/${savedId}/`, {
              method: "PATCH", credentials: "include",
              headers: { "Content-Type": "application/json", "X-CSRFToken": ct },
              body: JSON.stringify({ file_path: finalPath }),
            });
            load(); // refresh list to show "Hosted" badge
          },
          onError: (msg) => {
            // The record still exists — just no file attached
            setNotice(`"${savedName}" saved but the installer file upload failed: ${msg}`);
          },
        });
      }

    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save.");
    } finally { setSaving(false); }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isEditorOpen = creating || editing !== null;
  const existingFileInfo = (editing?.file_url && !removeExisting)
    ? { name: editing.file_name ?? "Uploaded file", size: editing.file_size ?? 0, url: editing.file_url }
    : null;

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.platforms.some((p) => p.toLowerCase().includes(q)) ||
      (s.version && s.version.toLowerCase().includes(q))
    );
  }, [items, search]);

  const stats = {
    total:    items.length,
    active:   items.filter((s) => s.status === "active").length,
    hosted:   items.filter((s) => Boolean(s.file_url)).length,
    draft:    items.filter((s) => s.status === "draft").length,
  };

  function saveLabel() {
    return saving ? "Saving…" : editing ? "Save changes" : "Add software";
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteConfirm
            item={deleteTarget}
            onConfirm={confirmDelete}
            onCancel={() => setDeleteTarget(null)}
            deleting={deleting}
          />
        )}
      </AnimatePresence>

      <div
        className="admin-content"
        style={{ marginLeft: 0, marginRight: 0 }}
      >
        {/* ── Page header ── */}
        <header className="admin-heading">
          <div>
            <p className="eyebrow">Resources</p>
            <h1>Software catalogue</h1>
            <p>Manage approved tools available to students and staff.</p>
          </div>
          <button className="primary-button" onClick={openCreate}
            style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={16} aria-hidden="true" /> Add software
          </button>
        </header>

        {/* ── Feedback ── */}
        <AnimatePresence mode="wait">
          {notice && (
            <motion.p key="n" className="admin-notice" role="status"
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {notice}
            </motion.p>
          )}
          {formError && !isEditorOpen && (
            <motion.p key="e" className="admin-error" role="alert"
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {formError}
            </motion.p>
          )}
        </AnimatePresence>

        {/* ── Stats ── */}
        {items.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
            {[
              { label: "Total",   value: stats.total,  color: "#334155", bg: "#f1f5f9" },
              { label: "Active",  value: stats.active,  color: "#166534", bg: "#dcfce7" },
              { label: "Hosted",  value: stats.hosted,  color: "#1d4ed8", bg: "#dbeafe" },
              { label: "Draft",   value: stats.draft,   color: "#92400e", bg: "#fef3c7" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} style={{ background: bg, borderRadius: 12, padding: "14px 18px" }}>
                <span style={{ fontSize: ".7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color, opacity: 0.75, display: "block", marginBottom: 2 }}>
                  {label}
                </span>
                <span style={{ fontSize: "1.7rem", fontWeight: 900, lineHeight: 1, color }}>
                  {value}
                </span>
              </div>
            ))}
          </motion.div>
        )}

        {/* ── Search ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
            <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }} aria-hidden="true" />
            <input
              type="text" placeholder="Search by name, description, platform…"
              value={search} onChange={(e) => setSearch(e.target.value)}
              aria-label="Search software"
              style={{
                width: "100%", padding: "9px 12px 9px 32px",
                border: "1.5px solid var(--border)", borderRadius: 10,
                fontSize: ".84rem", background: "var(--surface)", color: "var(--foreground)",
                outline: "none",
              }}
            />
          </div>
          {search && (
            <button onClick={() => setSearch("")} className="secondary-button"
              style={{ fontSize: ".82rem", padding: "8px 14px" }}>
              Clear
            </button>
          )}
          <span style={{ marginLeft: "auto", fontSize: ".78rem", color: "var(--muted)" }}>
            {filtered.length !== items.length
              ? `${filtered.length} of ${items.length}`
              : `${items.length} item${items.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* ── List ── */}
        {filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{
            background: "var(--surface)", border: "1.5px dashed var(--border)",
            borderRadius: 16, padding: "52px 24px", textAlign: "center",
          }}>
            <Package size={32} style={{ color: "#94a3b8", marginBottom: 12 }} aria-hidden="true" />
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "#475569" }}>
              {search ? "No software matches your search" : "No software yet"}
            </p>
            <p style={{ margin: 0, fontSize: ".84rem", color: "#94a3b8" }}>
              {search ? "Try a different term." : <>Click &ldquo;Add software&rdquo; to get started.</>}
            </p>
          </motion.div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((item, idx) => {
              const audienceMeta = AUDIENCE_META[item.audience] ?? AUDIENCE_META.public;
              const isSelected = editing?.id === item.id;

              return (
                <motion.article
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.03, 0.15) }}
                  style={{
                    background: "var(--surface)",
                    border: `1.5px solid ${isSelected ? "#818cf8" : "var(--border)"}`,
                    borderRadius: 14, padding: "15px 18px",
                    display: "grid", gridTemplateColumns: "1fr auto",
                    gap: 14, alignItems: "center",
                    opacity: item.status === "archived" ? 0.55 : 1,
                    boxShadow: isSelected ? "0 0 0 3px rgba(129,140,248,.18)" : "none",
                    transition: "box-shadow 0.15s, border-color 0.15s",
                  }}
                >
                  {/* Info */}
                  <div style={{ minWidth: 0 }}>
                    {/* Row 1: name + badges */}
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 5 }}>
                      <strong style={{ fontSize: ".93rem", color: "var(--foreground)" }}>
                        {item.name}
                      </strong>
                      {item.version && (
                        <span style={{ fontSize: ".7rem", fontWeight: 700, color: "#64748b", background: "#f1f5f9", borderRadius: 5, padding: "1px 6px" }}>
                          v{item.version}
                        </span>
                      )}
                      <span className={`status-chip ${item.status}`} style={{ fontSize: ".7rem" }}>
                        {item.status}
                      </span>
                      {item.file_url && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          background: "#dbeafe", color: "#1d4ed8",
                          borderRadius: 999, padding: "2px 7px", fontSize: ".68rem", fontWeight: 800,
                        }}>
                          <HardDrive size={9} aria-hidden="true" /> Hosted
                          {(item.file_size ?? 0) > 0 && ` · ${formatBytes(item.file_size)}`}
                        </span>
                      )}
                      <span style={{
                        display: "inline-flex", alignItems: "center",
                        background: audienceMeta.bg, color: audienceMeta.color,
                        borderRadius: 999, padding: "2px 8px", fontSize: ".68rem", fontWeight: 700,
                      }}>
                        {AUDIENCE_OPTIONS.find((a) => a.value === item.audience)?.label ?? item.audience}
                      </span>
                    </div>

                    {/* Row 2: description */}
                    <p style={{ margin: "0 0 7px", fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.5 }}>
                      {item.description.length > 100
                        ? item.description.slice(0, 100) + "…"
                        : item.description}
                    </p>

                    {/* Row 3: platforms + meta */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 3 }}>
                        {item.platforms.map((p) => (
                          <span key={p} title={p} style={{
                            fontSize: ".85rem", width: 22, height: 22,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "#f1f5f9", borderRadius: 5,
                          }}>
                            {PLATFORM_ICONS[p] ?? p[0]}
                          </span>
                        ))}
                      </div>
                      {item.download_url && (
                        <a href={item.download_url} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: ".72rem", color: "var(--brand)", display: "flex", alignItems: "center", gap: 3, fontWeight: 700 }}>
                          <ExternalLink size={10} aria-hidden="true" /> External link
                        </a>
                      )}
                      {item.guide_title && (
                        <span style={{ fontSize: ".72rem", color: "#64748b", display: "flex", alignItems: "center", gap: 3 }}>
                          📖 {item.guide_title}
                        </span>
                      )}
                      {item.updated_at && (
                        <span style={{ fontSize: ".7rem", color: "#94a3b8", display: "flex", alignItems: "center", gap: 3, marginLeft: "auto" }}>
                          <Clock size={10} aria-hidden="true" />
                          {item.updated_by_name ? `${item.updated_by_name} · ` : ""}
                          {formatDate(item.updated_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      aria-label={`Edit ${item.name}`}
                      onClick={() => openEdit(item)}
                      title="Edit"
                      style={{
                        width: 36, height: 36, border: "1.5px solid var(--border)",
                        borderRadius: 9, background: "var(--surface)",
                        color: "var(--brand)", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.12s, border-color 0.12s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#eef2ff"; e.currentTarget.style.borderColor = "#818cf8"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`Delete ${item.name}`}
                      onClick={() => setDeleteTarget(item)}
                      title="Delete"
                      style={{
                        width: 36, height: 36, border: "1.5px solid #fecaca",
                        borderRadius: 9, background: "var(--surface)",
                        color: "#dc2626", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}

        {/* ── Editor panel ── */}
        <AnimatePresence>
          {isEditorOpen && (
            <motion.aside
              key={editing?.id ?? "new"}
              className="editor-panel guide-editor"
              initial={{ opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              aria-label={editing ? `Edit ${editing.name}` : "Add software"}
              style={{ display: "flex", flexDirection: "column" }}
            >
              {/* Panel header */}
              <header style={{
                padding: "16px 20px", borderBottom: "1px solid #e2e8f0",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                flexShrink: 0,
              }}>
                <div>
                  <span style={{ fontSize: ".7rem", color: "#94a3b8", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em" }}>
                    {creating ? "New software" : "Edit software"}
                  </span>
                  <h2 style={{ margin: "2px 0 0", fontSize: "1rem" }}>
                    {editing ? editing.name : "Add to catalogue"}
                  </h2>
                </div>
                <button onClick={closeEditor} disabled={saving} aria-label="Close"
                  style={{ width: 32, height: 32, border: "1px solid #e2e8f0", borderRadius: 7, background: "#f8fafc", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X size={15} aria-hidden="true" />
                </button>
              </header>

              {/* Form */}
              <form id="sw-form" onSubmit={submit}
                style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                <div className="ep-form">

                  {/* Error */}
                  {formError && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 9, padding: "10px 13px", display: "flex", gap: 9, alignItems: "flex-start" }} role="alert">
                      <AlertTriangle size={14} style={{ color: "#dc2626", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                      <span style={{ fontSize: ".83rem", color: "#991b1b" }}>{formError}</span>
                    </div>
                  )}

                  {/* ── Basic info ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                    <p style={{ margin: 0, fontSize: ".72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                      Basic information
                    </p>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 88px", gap: 10 }}>
                      <div>
                        <label htmlFor="sw-name" style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>Name <span style={{ color: "#ef4444" }}>*</span></span>
                          <span style={{ fontWeight: 400, fontSize: ".7rem", color: draftName.length > 130 ? "#dc2626" : "#94a3b8" }}>
                            {draftName.length}/140
                          </span>
                        </label>
                        <input id="sw-name" type="text" required maxLength={140}
                          value={draftName} placeholder="e.g. Microsoft Office"
                          onChange={(e) => { setDraftName(e.target.value); if (!editing) setDraftSlug(slugify(e.target.value)); }} />
                      </div>
                      <div>
                        <label htmlFor="sw-version">Version</label>
                        <input id="sw-version" type="text" maxLength={80}
                          value={draftVersion} placeholder="2024"
                          onChange={(e) => setDraftVersion(e.target.value)} />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="sw-slug" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>URL slug <span style={{ color: "#ef4444" }}>*</span></span>
                        <span style={{ fontWeight: 400, fontSize: ".7rem", color: "#94a3b8" }}>auto-generated from name</span>
                      </label>
                      <input id="sw-slug" type="text" required
                        pattern={"[a-z0-9][-a-z0-9]*"}
                        title="Lowercase letters, numbers and hyphens only"
                        value={draftSlug} placeholder="e.g. microsoft-office"
                        onChange={(e) => setDraftSlug(e.target.value)} />
                    </div>

                    <div>
                      <label htmlFor="sw-desc" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Description <span style={{ color: "#ef4444" }}>*</span></span>
                        <span style={{ fontWeight: 400, fontSize: ".7rem", color: draftDesc.length > 380 ? "#dc2626" : "#94a3b8" }}>
                          {draftDesc.length}/400
                        </span>
                      </label>
                      <textarea id="sw-desc" required maxLength={400} rows={3}
                        value={draftDesc} placeholder="What this software does and who it's for."
                        onChange={(e) => setDraftDesc(e.target.value)} />
                    </div>
                  </div>

                  <hr style={{ border: "none", borderTop: "1px solid #f1f5f9" }} />

                  {/* ── Availability ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                    <p style={{ margin: 0, fontSize: ".72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                      Availability
                    </p>

                    <div>
                      <label style={{ display: "block", marginBottom: 7 }}>
                        Platforms <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: ".75rem" }}>
                          (select all that apply)
                        </span>
                      </label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {PLATFORM_OPTIONS.map((p) => {
                          const on = draftPlatforms.includes(p);
                          return (
                            <button key={p} type="button"
                              onClick={() => setDraftPlatforms((prev) => on ? prev.filter((x) => x !== p) : [...prev, p])}
                              style={{
                                display: "flex", alignItems: "center", gap: 5,
                                padding: "6px 11px", borderRadius: 7, cursor: "pointer",
                                fontWeight: on ? 700 : 500, fontSize: ".82rem",
                                border: `1.5px solid ${on ? "#818cf8" : "#e2e8f0"}`,
                                background: on ? "#eef2ff" : "var(--surface)",
                                color: on ? "#4338ca" : "#475569",
                                transition: "all 0.1s",
                              }}
                            >
                              {PLATFORM_ICONS[p] ?? "💻"} {p}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label htmlFor="sw-audience">Audience</label>
                        <select id="sw-audience" value={draftAudience}
                          onChange={(e) => setDraftAudience(e.target.value)}>
                          {AUDIENCE_OPTIONS.map((a) => (
                            <option key={a.value} value={a.value}>{a.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="sw-status">Status</label>
                        <select id="sw-status" value={draftStatus}
                          onChange={(e) => setDraftStatus(e.target.value)}>
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <hr style={{ border: "none", borderTop: "1px solid #f1f5f9" }} />

                  {/* ── Installer file ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <p style={{ margin: 0, fontSize: ".72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                        Installer file
                      </p>
                      <span style={{ fontSize: ".7rem", color: "#94a3b8" }}>
                        optional · max {formatBytes(uploadConfig.maxFileSizeBytes)}
                      </span>
                    </div>

                    <FileDropzone
                      existing={existingFileInfo}
                      pending={pendingFile}
                      maxFileSizeBytes={uploadConfig.maxFileSizeBytes}
                      chunkSizeBytes={uploadConfig.chunkSizeBytes}
                      onSelect={setPendingFile}
                      onRemovePending={() => setPendingFile(null)}
                      onRemoveExisting={() => { setRemoveExisting(true); setPendingFile(null); }}
                    />

                    {pendingFile && (
                      <p style={{ margin: 0, fontSize: ".76rem", color: "#6366f1", display: "flex", alignItems: "center", gap: 5 }}>
                        <CheckCircle2 size={12} aria-hidden="true" />
                        File will upload in the background after saving
                      </p>
                    )}
                  </div>

                  <hr style={{ border: "none", borderTop: "1px solid #f1f5f9" }} />

                  {/* ── Links & metadata ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                    <p style={{ margin: 0, fontSize: ".72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                      Links &amp; metadata
                    </p>

                    <div>
                      <label htmlFor="sw-url">
                        External download URL
                        <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: ".73rem", marginLeft: 5 }}>
                          (fallback / official site link)
                        </span>
                      </label>
                      <div style={{ position: "relative" }}>
                        <input id="sw-url" type="url" value={draftUrl}
                          placeholder="https://example.com/download"
                          onChange={(e) => setDraftUrl(e.target.value)}
                          style={draftUrl ? { paddingRight: 36 } : {}} />
                        {draftUrl && (
                          <a href={draftUrl} target="_blank" rel="noopener noreferrer"
                            title="Preview link" aria-label="Preview external URL"
                            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--brand)", display: "flex" }}>
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="sw-licence" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Licence notes <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span></span>
                        <span style={{ fontWeight: 400, fontSize: ".7rem", color: draftLicence.length > 450 ? "#dc2626" : "#94a3b8" }}>
                          {draftLicence.length}/500
                        </span>
                      </label>
                      <textarea id="sw-licence" maxLength={500} rows={2}
                        value={draftLicence}
                        placeholder="e.g. Available to all enrolled students via Microsoft 365."
                        onChange={(e) => setDraftLicence(e.target.value)} />
                    </div>

                    <div>
                      <label htmlFor="sw-guide">
                        Linked guide <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                      </label>
                      <select id="sw-guide" value={draftGuide}
                        onChange={(e) => setDraftGuide(e.target.value === "" ? "" : Number(e.target.value))}>
                        <option value="">No linked guide</option>
                        {guides.map((g) => (
                          <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Edit-only: last updated */}
                  {editing?.updated_at && (
                    <p style={{ margin: 0, fontSize: ".72rem", color: "#94a3b8", textAlign: "right" }}>
                      Last updated {formatDate(editing.updated_at)}
                      {editing.updated_by_name ? ` by ${editing.updated_by_name}` : ""}
                    </p>
                  )}

                </div>
              </form>

              {/* Footer */}
              <div style={{
                borderTop: "1px solid #e2e8f0", padding: "13px 20px",
                background: "#f8fafc",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: 10, flexShrink: 0,
              }}>
                {/* Delete button on left when editing */}
                {editing ? (
                  <button type="button"
                    onClick={() => setDeleteTarget(editing)}
                    disabled={saving}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 14px", border: "1.5px solid #fecaca",
                      borderRadius: 8, background: "transparent",
                      color: "#dc2626", cursor: "pointer", fontSize: ".82rem", fontWeight: 700,
                    }}>
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                ) : <div />}

                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="secondary-button"
                    onClick={closeEditor} disabled={saving}>
                    Cancel
                  </button>
                  <button form="sw-form" type="submit" className="primary-button"
                    disabled={saving}
                    style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 130, justifyContent: "center" }}>
                    {saving
                      ? <><Loader2 size={14} className="spin" aria-hidden="true" />{saveLabel()}</>
                      : editing ? "Save changes" : "Add software"
                    }
                  </button>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
