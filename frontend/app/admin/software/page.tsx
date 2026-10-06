"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Download, FileUp, HardDrive, Loader2, Package,
  Pencil, Plus, Trash2, X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { adminGet, type Guide, type Software } from "@/lib/admin-api";
import { csrfToken } from "@/lib/auth";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_OPTIONS = ["Windows", "macOS", "Linux", "Web", "Android", "iOS"];

const AUDIENCE_OPTIONS = [
  { value: "all",     label: "Students & staff" },
  { value: "student", label: "Students only" },
  { value: "staff",   label: "Faculty & staff" },
  { value: "public",  label: "Public" },
];

const STATUS_OPTIONS = [
  { value: "draft",    label: "Draft" },
  { value: "active",   label: "Active" },
  { value: "archived", label: "Archived" },
];

const MAX_FILE_BYTES = 25 * 1024 * 1024 * 1024; // 25 GB

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(text: string) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function messageFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r)) {
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  return "Software could not be saved.";
}

// ── Upload progress ───────────────────────────────────────────────────────────

function UploadProgress({ progress, fileName }: { progress: number; fileName: string }) {
  return (
    <div style={{
      background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: ".8rem", fontWeight: 600 }}>
        <span style={{ color: "#0369a1", display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={13} className="spin" aria-hidden="true" />
          Uploading {fileName}…
        </span>
        <span style={{ color: "#0369a1" }}>{progress}%</span>
      </div>
      <div style={{ height: 6, background: "#e0f2fe", borderRadius: 999, overflow: "hidden" }}>
        <div
          style={{
            height: "100%", background: "#0ea5e9", borderRadius: 999,
            width: `${progress}%`, transition: "width 0.2s ease",
          }}
        />
      </div>
    </div>
  );
}

// ── File dropzone ─────────────────────────────────────────────────────────────

function FileDropzone({
  existing,         // already-saved file info from the server
  pending,          // newly selected file (not yet uploaded)
  onSelect,
  onRemovePending,
  onRemoveExisting,
}: {
  existing: { name: string; size: number; url: string } | null;
  pending: File | null;
  onSelect: (f: File) => void;
  onRemovePending: () => void;
  onRemoveExisting: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) validate(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) validate(file);
    // Reset so the same file can be re-selected after removal
    if (inputRef.current) inputRef.current.value = "";
  }

  function validate(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      alert(`File is too large (${formatBytes(file.size)}). Maximum allowed is 25 GB.`);
      return;
    }
    onSelect(file);
  }

  // ── States ────────────────────────────────────────────────────────────────

  // 1. Pending new file selected (not yet saved)
  if (pending) {
    return (
      <div style={{
        border: "2px solid #818cf8", borderRadius: 10, padding: "12px 14px",
        background: "#eef2ff", display: "flex", alignItems: "center", gap: 12,
      }}>
        <HardDrive size={22} style={{ color: "#4f46e5", flexShrink: 0 }} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: ".88rem", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {pending.name}
          </strong>
          <span style={{ fontSize: ".75rem", color: "#6366f1" }}>
            {formatBytes(pending.size)} · Will be uploaded on save
          </span>
        </div>
        <button
          type="button"
          onClick={onRemovePending}
          title="Remove selected file"
          style={{ border: "none", background: "none", cursor: "pointer", color: "#818cf8", padding: 4, borderRadius: 6 }}
          aria-label="Remove selected file"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  // 2. Existing server file (no pending replacement)
  if (existing) {
    return (
      <div style={{
        border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px",
        background: "#f0fdf4", display: "flex", alignItems: "center", gap: 12,
      }}>
        <HardDrive size={22} style={{ color: "#22c55e", flexShrink: 0 }} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: ".88rem", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {existing.name}
          </strong>
          <span style={{ fontSize: ".75rem", color: "#16a34a" }}>
            {formatBytes(existing.size)} · Hosted on server
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <a
            href={existing.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Download existing file"
            style={{ border: "1px solid #bbf7d0", background: "#fff", borderRadius: 8, padding: 6, cursor: "pointer", color: "#16a34a", display: "flex" }}
            aria-label="Download existing file"
          >
            <Download size={14} aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Replace file"
            style={{ border: "1px solid #dbe2ee", background: "#fff", borderRadius: 8, padding: 6, cursor: "pointer", color: "#475569", display: "flex" }}
            aria-label="Replace file"
          >
            <FileUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRemoveExisting}
            title="Remove file"
            style={{ border: "1px solid #fecaca", background: "#fff", borderRadius: 8, padding: 6, cursor: "pointer", color: "#dc2626", display: "flex" }}
            aria-label="Remove hosted file"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
        <input ref={inputRef} type="file" onChange={handleChange} style={{ display: "none" }} />
      </div>
    );
  }

  // 3. Empty — drop zone
  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Upload software installer file"
      style={{
        border: "2px dashed #cbd5e1", borderRadius: 10, padding: "20px 16px",
        background: "#f8fafc", cursor: "pointer", textAlign: "center",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#818cf8")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#cbd5e1")}
    >
      <FileUp size={24} style={{ color: "#94a3b8", marginBottom: 8 }} aria-hidden="true" />
      <p style={{ margin: 0, fontWeight: 700, fontSize: ".88rem", color: "#475569" }}>
        Drop installer here or click to browse
      </p>
      <p style={{ margin: "4px 0 0", fontSize: ".75rem", color: "#94a3b8" }}>
        Any file type · Max 25 GB
      </p>
      <input ref={inputRef} type="file" onChange={handleChange} style={{ display: "none" }} />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SoftwareManagement() {
  const [items, setItems]   = useState<Software[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing, setEditing]   = useState<Software | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [notice, setNotice]   = useState("");

  // Text fields
  const [draftName, setDraftName]               = useState("");
  const [draftSlug, setDraftSlug]               = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftVersion, setDraftVersion]         = useState("");
  const [draftPlatforms, setDraftPlatforms]     = useState<string[]>(["Windows"]);
  const [draftAudience, setDraftAudience]       = useState("all");
  const [draftLicence, setDraftLicence]         = useState("");
  const [draftUrl, setDraftUrl]                 = useState("");
  const [draftGuide, setDraftGuide]             = useState<number | "">("");
  const [draftStatus, setDraftStatus]           = useState("draft");

  // File state
  const [pendingFile, setPendingFile]         = useState<File | null>(null);
  const [removeExisting, setRemoveExisting]   = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  function load() {
    Promise.all([adminGet<Software[]>("software"), adminGet<Guide[]>("guides")])
      .then(([sw, gs]) => { setItems(sw); setGuides(gs); })
      .catch((e: Error) => setFormError(e.message));
  }
  useEffect(load, []);

  // ── Editor open/close ─────────────────────────────────────────────────────

  function resetFileState() {
    setPendingFile(null);
    setRemoveExisting(false);
    setUploadProgress(null);
  }

  function openCreate() {
    setEditing(null); setCreating(true);
    setDraftName(""); setDraftSlug(""); setDraftDescription(""); setDraftVersion("");
    setDraftPlatforms(["Windows"]); setDraftAudience("all");
    setDraftLicence(""); setDraftUrl(""); setDraftGuide(""); setDraftStatus("draft");
    resetFileState();
    setFormError(""); setNotice("");
  }

  function openEdit(item: Software) {
    setCreating(false); setEditing(item);
    setDraftName(item.name); setDraftSlug(item.slug);
    setDraftDescription(item.description); setDraftVersion(item.version);
    setDraftPlatforms([...item.platforms]); setDraftAudience(item.audience);
    setDraftLicence(item.licence_notes); setDraftUrl(item.download_url);
    setDraftGuide(item.guide ?? ""); setDraftStatus(item.status);
    resetFileState();
    setFormError(""); setNotice("");
  }

  function closeEditor() {
    setEditing(null); setCreating(false);
    resetFileState();
  }

  function togglePlatform(p: string, checked: boolean) {
    setDraftPlatforms((prev) => checked ? [...prev, p] : prev.filter((x) => x !== p));
  }

  // ── Submit — uses XMLHttpRequest for progress tracking ────────────────────

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(""); setNotice(""); setSaving(true); setUploadProgress(null);

    const needsFormData = pendingFile !== null || removeExisting;

    try {
      const token = await csrfToken();
      const isEdit = !!editing;
      const url = `/api/v1/admin/software/${isEdit ? `${editing!.id}/` : ""}`;

      if (needsFormData) {
        // ── Multipart — use XHR for upload progress ──────────────────────
        const fd = new FormData();
        fd.append("name",          draftName);
        fd.append("slug",          draftSlug);
        fd.append("description",   draftDescription);
        fd.append("version",       draftVersion);
        fd.append("platforms",     JSON.stringify(draftPlatforms));
        fd.append("audience",      draftAudience);
        fd.append("licence_notes", draftLicence);
        fd.append("download_url",  draftUrl);
        fd.append("guide",         draftGuide !== "" ? String(draftGuide) : "");
        fd.append("status",        draftStatus);

        if (pendingFile) {
          fd.append("file", pendingFile, pendingFile.name);
        } else if (removeExisting) {
          fd.append("remove_file", "true");
        }

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(isEdit ? "PATCH" : "POST", url);
          xhr.setRequestHeader("X-CSRFToken", token);
          xhr.withCredentials = true;

          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              let msg = "Software could not be saved.";
              try { msg = messageFrom(JSON.parse(xhr.responseText)); } catch { /* keep default */ }
              reject(new Error(msg));
            }
          };

          xhr.onerror = () => reject(new Error("Network error during upload."));
          xhr.send(fd);
        });

      } else {
        // ── JSON — no file, use fetch ────────────────────────────────────
        const body = {
          name: draftName, slug: draftSlug, description: draftDescription,
          version: draftVersion, platforms: draftPlatforms, audience: draftAudience,
          licence_notes: draftLicence, download_url: draftUrl,
          guide: draftGuide !== "" ? Number(draftGuide) : null,
          status: draftStatus,
        };
        const res = await fetch(url, {
          method: isEdit ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": token },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(messageFrom(data));
      }

      closeEditor();
      setNotice(editing ? "Software updated." : "Software added.");
      load();

    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Software could not be saved.");
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  }

  const isEditorOpen = creating || editing !== null;

  // Compute what to show in the file dropzone for the current editor state
  const existingFileInfo = (editing && editing.file_url && !removeExisting)
    ? { name: editing.file_name ?? "Uploaded file", size: editing.file_size ?? 0, url: editing.file_url }
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="admin-content"
      style={{
        maxWidth:   isEditorOpen ? "calc(100% - 480px - 24px)" : undefined,
        marginLeft: 0, marginRight: 0,
      }}
    >
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Resources</p>
          <h1>Software catalogue</h1>
          <p>Control which approved tools and download links appear publicly.</p>
        </div>
        <button className="primary-button" onClick={openCreate}
          style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Plus aria-hidden="true" /> Add software
        </button>
      </header>

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

      {/* ── Table ── */}
      <section className="content-table sw-table" aria-label="Software catalogue">
        <div className="table-head" aria-hidden="true">
          <span>Software</span><span>Version</span><span>Audience</span>
          <span>Platforms</span><span>Status</span><span></span>
        </div>
        {items.length === 0 ? (
          <div className="empty-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Package aria-hidden="true" style={{ width: 22, color: "#234395" }} />
            <span>No software yet. Add the first approved resource.</span>
          </div>
        ) : items.map((item, idx) => (
          <motion.article key={item.id}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(idx * 0.04, 0.2) }}>
            <div>
              <strong style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {item.name}
                {/* Indicator dot when a hosted file is attached */}
                {item.file_url && (
                  <span
                    title="Installer hosted on server"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: "#dcfce7", color: "#166534",
                      borderRadius: 999, padding: "1px 7px", fontSize: ".68rem", fontWeight: 800,
                    }}
                  >
                    <HardDrive size={10} aria-hidden="true" /> Hosted
                  </span>
                )}
              </strong>
              <small style={{ color: "#64748b", fontSize: ".82rem" }}>
                {item.description.length > 72 ? item.description.slice(0, 72) + "…" : item.description}
              </small>
            </div>
            <span style={{ color: "#64748b", fontSize: ".85rem" }}>
              {item.version || <em style={{ color: "#cbd5e1" }}>—</em>}
            </span>
            <span style={{ fontSize: ".85rem", color: "#475569" }}>
              {AUDIENCE_OPTIONS.find((a) => a.value === item.audience)?.label ?? item.audience}
            </span>
            <span style={{ fontSize: ".82rem", color: "#64748b" }}>
              {item.platforms.join(", ") || <em style={{ color: "#cbd5e1" }}>—</em>}
            </span>
            <span><span className={`status-chip ${item.status}`}>{item.status}</span></span>
            <button aria-label={`Edit ${item.name}`} onClick={() => openEdit(item)}>
              <Pencil aria-hidden="true" />
            </button>
          </motion.article>
        ))}
      </section>

      {/* ── Editor panel ── */}
      <AnimatePresence>
        {isEditorOpen && (
          <motion.aside
            key={editing?.id ?? "new"}
            className="editor-panel"
            initial={{ opacity: 0, x: 20, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label={editing ? `Edit ${editing.name}` : "Add software"}
            style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 48px)", width: 460 }}
          >
            {/* Header */}
            <header>
              <div>
                <span style={{ fontSize: ".75rem", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  {creating ? "New entry" : "Edit entry"}
                </span>
                <h2 style={{ marginTop: 3 }}>{editing ? editing.name : "Add software"}</h2>
              </div>
              <button aria-label="Close editor" onClick={closeEditor}><X aria-hidden="true" /></button>
            </header>

            {/* Scrollable form body */}
            <form
              id="sw-form"
              onSubmit={submit}
              style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
            >
              <div className="ep-form">

                {/* Form-level error */}
                {formError && (
                  <p style={{ margin: 0, background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: ".85rem" }} role="alert">
                    {formError}
                  </p>
                )}

                {/* Name + Version */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="sw-name">
                      Name
                      <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".75rem", marginLeft: 5 }}>
                        ({draftName.length}/140)
                      </span>
                    </label>
                    <input
                      id="sw-name" type="text" required maxLength={140}
                      value={draftName}
                      placeholder="e.g. Microsoft Office"
                      onChange={(e) => {
                        setDraftName(e.target.value);
                        if (!editing) setDraftSlug(slugify(e.target.value));
                      }}
                    />
                  </div>
                  <div>
                    <label htmlFor="sw-version">
                      Version
                      <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".75rem", marginLeft: 5 }}>
                        ({draftVersion.length}/80)
                      </span>
                    </label>
                    <input
                      id="sw-version" type="text" maxLength={80}
                      value={draftVersion}
                      placeholder="e.g. 2024"
                      onChange={(e) => setDraftVersion(e.target.value)}
                    />
                  </div>
                </div>

                {/* Slug */}
                <div>
                  <label htmlFor="sw-slug">
                    URL slug
                    <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".75rem", marginLeft: 5 }}>
                      (auto-generated from name on create)
                    </span>
                  </label>
                  <input
                    id="sw-slug" type="text" required pattern="[a-z0-9-]+"
                    value={draftSlug}
                    placeholder="e.g. microsoft-office"
                    onChange={(e) => setDraftSlug(e.target.value)}
                  />
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="sw-desc" style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span>Description</span>
                    <span style={{ color: draftDescription.length > 380 ? "#b91c1c" : "#94a3b8", fontWeight: 400, fontSize: ".75rem" }}>
                      {draftDescription.length}/400
                    </span>
                  </label>
                  <textarea
                    id="sw-desc" required maxLength={400} rows={3}
                    value={draftDescription}
                    placeholder="What this software does and who it's for."
                    onChange={(e) => setDraftDescription(e.target.value)}
                  />
                </div>

                {/* Platforms */}
                <fieldset>
                  <legend>Platforms</legend>
                  <div className="checkbox-grid" style={{ marginTop: 8 }}>
                    {PLATFORM_OPTIONS.map((p) => (
                      <label key={p} htmlFor={`sw-plat-${p}`}
                        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 500, fontSize: ".88rem", marginBottom: 0 }}>
                        <input
                          id={`sw-plat-${p}`}
                          type="checkbox"
                          checked={draftPlatforms.includes(p)}
                          onChange={(e) => togglePlatform(p, e.target.checked)}
                        />
                        {p}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* ── File upload ─────────────────────────────────────────── */}
                <div>
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span>
                      Installer file
                      <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".75rem", marginLeft: 5 }}>
                        (optional · max 25 GB)
                      </span>
                    </span>
                    {editing?.file_url && !removeExisting && !pendingFile && (
                      <span style={{ fontSize: ".72rem", color: "#16a34a", fontWeight: 700 }}>
                        Hosted · {formatBytes(editing.file_size ?? 0)}
                      </span>
                    )}
                  </label>
                  <FileDropzone
                    existing={existingFileInfo}
                    pending={pendingFile}
                    onSelect={setPendingFile}
                    onRemovePending={() => setPendingFile(null)}
                    onRemoveExisting={() => { setRemoveExisting(true); setPendingFile(null); }}
                  />
                  <small style={{ color: "#64748b", fontSize: ".75rem", display: "block", marginTop: 5 }}>
                    Upload an installer so students can download it directly from the helpdesk.
                    Hosting a file here takes priority over the external download URL on the public page.
                  </small>
                </div>

                {/* Upload progress bar */}
                {uploadProgress !== null && pendingFile && (
                  <UploadProgress progress={uploadProgress} fileName={pendingFile.name} />
                )}

                {/* ── External download URL ───────────────────────────────── */}
                <div>
                  <label htmlFor="sw-url">
                    External download URL
                    <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".75rem", marginLeft: 5 }}>
                      (optional — used as fallback when no file is hosted)
                    </span>
                  </label>
                  <input
                    id="sw-url" type="url"
                    value={draftUrl}
                    placeholder="https://example.com/download"
                    onChange={(e) => setDraftUrl(e.target.value)}
                  />
                  {draftUrl && (
                    <a href={draftUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: ".78rem", color: "#234395", fontWeight: 700, marginTop: 4 }}>
                      <Download size={12} aria-hidden="true" /> Preview link
                    </a>
                  )}
                </div>

                {/* Licence notes */}
                <div>
                  <label htmlFor="sw-licence" style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span>Licence notes <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span></span>
                    <span style={{ color: draftLicence.length > 450 ? "#b91c1c" : "#94a3b8", fontWeight: 400, fontSize: ".75rem" }}>
                      {draftLicence.length}/500
                    </span>
                  </label>
                  <textarea
                    id="sw-licence" maxLength={500} rows={2}
                    value={draftLicence}
                    placeholder="e.g. Available to all enrolled students via Microsoft 365."
                    onChange={(e) => setDraftLicence(e.target.value)}
                  />
                </div>

                {/* Linked guide */}
                <div>
                  <label htmlFor="sw-guide">
                    Linked guide <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
                  </label>
                  <select
                    id="sw-guide"
                    value={draftGuide}
                    onChange={(e) => setDraftGuide(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">No linked guide</option>
                    {guides.map((g) => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                  </select>
                </div>

                {/* Audience + Status */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="sw-audience">Audience</label>
                    <select id="sw-audience" value={draftAudience} onChange={(e) => setDraftAudience(e.target.value)}>
                      {AUDIENCE_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sw-status">Status</label>
                    <select id="sw-status" value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

              </div>
            </form>

            {/* Fixed footer */}
            <div style={{
              borderTop: "1px solid #e2e8f0", padding: "14px 20px",
              background: "#f8fafc", display: "flex", justifyContent: "flex-end",
              gap: 10, flexShrink: 0,
            }}>
              <button type="button" className="secondary-button" onClick={closeEditor}
                disabled={saving}>
                Cancel
              </button>
              <button form="sw-form" type="submit" className="primary-button" disabled={saving}
                style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 110 }}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="spin" aria-hidden="true" />
                    {uploadProgress !== null ? `${uploadProgress}%` : "Saving…"}
                  </>
                ) : (
                  editing ? "Save changes" : "Add software"
                )}
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
