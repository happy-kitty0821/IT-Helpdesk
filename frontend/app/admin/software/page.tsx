"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink,
  FileUp, HardDrive, Loader2, Package, Pencil,
  Plus, Search, Trash2, X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { adminGet, type Guide, type Software } from "@/lib/admin-api";
import { csrfToken } from "@/lib/auth";

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

// Below this size = don't chunk, just warn user it'll be one request
const MAX_FILE_BYTES = 25 * 1024 * 1024 * 1024;
const CHUNK_SIZE     = 2 * 1024 * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(t: string) {
  return t.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
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

// ── Upload state ──────────────────────────────────────────────────────────────

interface UploadState {
  phase: "idle" | "initializing" | "uploading" | "finalizing" | "attaching" | "done" | "error";
  chunksDone: number;
  chunksTotal: number;
  currentChunkPct: number;
  error: string;
}
const IDLE_UPLOAD: UploadState = { phase: "idle", chunksDone: 0, chunksTotal: 0, currentChunkPct: 0, error: "" };

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadProgress({ state, fileName }: { state: UploadState; fileName: string }) {
  if (state.phase === "idle" || state.phase === "done") return null;

  const overall = state.chunksTotal > 0
    ? Math.round(((state.chunksDone + state.currentChunkPct / 100) / state.chunksTotal) * 100)
    : 0;

  const isError = state.phase === "error";
  const phaseLabels: Record<UploadState["phase"], string> = {
    idle: "", initializing: "Preparing…", uploading: `Chunk ${state.chunksDone + 1} / ${state.chunksTotal}`,
    finalizing: "Assembling on server…", attaching: "Saving record…", done: "Done", error: "Upload failed",
  };

  return (
    <div style={{
      background: isError ? "#fef2f2" : "#f0f9ff",
      border: `1.5px solid ${isError ? "#fca5a5" : "#bae6fd"}`,
      borderRadius: 12, padding: "12px 16px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
        <span style={{
          color: isError ? "#991b1b" : "#0369a1", fontSize: ".8rem", fontWeight: 700,
          display: "flex", alignItems: "center", gap: 6, minWidth: 0,
        }}>
          {isError
            ? <AlertTriangle size={13} aria-hidden="true" />
            : <Loader2 size={13} className="spin" aria-hidden="true" />
          }
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isError ? state.error : `${phaseLabels[state.phase]} — ${fileName}`}
          </span>
        </span>
        {!isError && state.chunksTotal > 0 && (
          <span style={{ color: "#0369a1", fontSize: ".8rem", fontWeight: 700, flexShrink: 0 }}>{overall}%</span>
        )}
      </div>
      {!isError && (
        <>
          <div style={{ height: 5, background: "#e0f2fe", borderRadius: 999, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 999,
              background: ["finalizing", "attaching"].includes(state.phase) ? "#6366f1" : "#0ea5e9",
              width: `${["finalizing", "attaching"].includes(state.phase) ? 100 : overall}%`,
              transition: "width 0.2s ease",
            }} />
          </div>
          {state.chunksTotal > 1 && state.phase === "uploading" && (
            <div style={{ display: "flex", gap: 3, marginTop: 8, flexWrap: "wrap" }}>
              {Array.from({ length: state.chunksTotal }, (_, i) => (
                <span key={i} style={{
                  width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                  background: i < state.chunksDone ? "#22c55e" : i === state.chunksDone ? "#0ea5e9" : "#e0f2fe",
                }} title={`Chunk ${i + 1}`} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FileDropzone({
  existing, pending, onSelect, onRemovePending, onRemoveExisting, disabled,
  maxFileSizeBytes = MAX_FILE_BYTES, chunkSizeBytes = CHUNK_SIZE,
}: {
  existing: { name: string; size: number; url: string } | null;
  pending: File | null;
  onSelect: (f: File) => void;
  onRemovePending: () => void;
  onRemoveExisting: () => void;
  disabled?: boolean;
  maxFileSizeBytes?: number;
  chunkSizeBytes?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function pick(file: File) {
    if (file.size > maxFileSizeBytes) {
      alert(`File is too large (${formatBytes(file.size)}). Max is ${formatBytes(maxFileSizeBytes)}.`);
      return;
    }
    onSelect(file);
  }

  // ── State: pending ─────────────────────────────────────────────────────────
  if (pending) {
    const chunks = Math.ceil(pending.size / chunkSizeBytes);
    return (
      <div style={{
        border: "2px solid #818cf8", borderRadius: 12, padding: "14px 16px",
        background: "#f5f3ff", display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10, background: "#ede9fe",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <HardDrive size={20} style={{ color: "#4f46e5" }} aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: ".88rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pending.name}
          </strong>
          <span style={{ fontSize: ".75rem", color: "#6366f1" }}>
            {formatBytes(pending.size)}
            {chunks > 1 && <> · {chunks} chunks × {formatBytes(chunkSizeBytes)}</>}
          </span>
        </div>
        <button type="button" onClick={onRemovePending} disabled={disabled}
          style={{ border: "1.5px solid #c4b5fd", borderRadius: 8, background: "#fff", cursor: "pointer", color: "#6d28d9", padding: 6, display: "flex" }}
          aria-label="Remove file">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    );
  }

  // ── State: existing hosted file ────────────────────────────────────────────
  if (existing) {
    return (
      <div style={{
        border: "1.5px solid #86efac", borderRadius: 12, padding: "14px 16px",
        background: "#f0fdf4", display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10, background: "#dcfce7",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <HardDrive size={20} style={{ color: "#16a34a" }} aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: ".88rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {existing.name}
          </strong>
          <span style={{ fontSize: ".75rem", color: "#15803d" }}>
            {formatBytes(existing.size)} · Hosted on server
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" title="Download" aria-label="Download"
            style={{ border: "1.5px solid #86efac", borderRadius: 8, background: "#fff", cursor: "pointer", color: "#16a34a", padding: 7, display: "flex" }}
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
            <Download size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => ref.current?.click()} disabled={disabled}
            title="Replace file" aria-label="Replace"
            style={{ border: "1.5px solid #dbe2ee", borderRadius: 8, background: "#fff", cursor: "pointer", color: "#475569", padding: 7, display: "flex" }}>
            <FileUp size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={onRemoveExisting} disabled={disabled}
            title="Remove file" aria-label="Remove"
            style={{ border: "1.5px solid #fca5a5", borderRadius: 8, background: "#fff", cursor: "pointer", color: "#dc2626", padding: 7, display: "flex" }}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
        <input ref={ref} type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); if (ref.current) ref.current.value = ""; }} style={{ display: "none" }} />
      </div>
    );
  }

  // ── State: empty dropzone ──────────────────────────────────────────────────
  return (
    <div
      role="button" tabIndex={0}
      aria-label="Upload software installer"
      onDrop={(e) => { e.preventDefault(); if (!disabled) { const f = e.dataTransfer.files[0]; if (f) pick(f); } }}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => !disabled && ref.current?.click()}
      onKeyDown={(e) => !disabled && e.key === "Enter" && ref.current?.click()}
      style={{
        border: "2px dashed var(--border)", borderRadius: 12,
        padding: "24px 16px", background: "var(--background)",
        textAlign: "center", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.background = "#f5f3ff"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--background)"; }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12, background: "#e0e7ff",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 10px",
      }}>
        <FileUp size={20} style={{ color: "#4f46e5" }} aria-hidden="true" />
      </div>
      <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: ".88rem", color: "#334155" }}>
        Drop installer here or click to browse
      </p>
      <p style={{ margin: 0, fontSize: ".74rem", color: "#94a3b8" }}>
        Any file type · Max {formatBytes(maxFileSizeBytes)} · Sent as {formatBytes(chunkSizeBytes)} chunks
      </p>
      <input ref={ref} type="file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); if (ref.current) ref.current.value = ""; }}
        style={{ display: "none" }} />
    </div>
  );
}

// ── Chunked upload ────────────────────────────────────────────────────────────

async function uploadFileInChunks(
  file: File, token: string,
  onProgress: (s: UploadState) => void,
  chunkSize: number, maxRetries: number,
): Promise<string> {
  const totalChunks = Math.ceil(file.size / chunkSize);
  onProgress({ phase: "initializing", chunksDone: 0, chunksTotal: totalChunks, currentChunkPct: 0, error: "" });

  // ── Step 1: Init ─────────────────────────────────────────────────────────
  const initRes = await fetch("/api/v1/upload/init/", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": token },
    body: JSON.stringify({ filename: file.name, total_size: file.size, total_chunks: totalChunks, chunk_size: chunkSize }),
  });
  const initData = await initRes.json().catch(() => ({})) as Record<string, unknown>;
  if (!initRes.ok) throw new Error(messageFrom(initData));
  const uploadId = String(initData.upload_id);

  // ── Step 2: Upload chunks ─────────────────────────────────────────────────
  for (let i = 0; i < totalChunks; i++) {
    const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
    onProgress({ phase: "uploading", chunksDone: i, chunksTotal: totalChunks, currentChunkPct: 0, error: "" });

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential back-off: 2s, 4s, 8s
        await new Promise<void>((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        onProgress({ phase: "uploading", chunksDone: i, chunksTotal: totalChunks, currentChunkPct: 0, error: "" });
      }

      try {
        // Re-fetch CSRF token on every attempt — the token may have rotated
        // after the init POST or a previous chunk response.
        const chunkToken = await csrfToken();

        await new Promise<void>((resolve, reject) => {
          const fd = new FormData();
          fd.append("chunk", blob, `chunk-${i}`);

          const xhr = new XMLHttpRequest();
          xhr.open("PUT", `/api/v1/upload/${uploadId}/chunk/${i}/`);
          xhr.setRequestHeader("X-CSRFToken", chunkToken);
          xhr.withCredentials = true;

          // Hard timeout — if Django never responds (e.g. all workers busy),
          // abort and retry rather than hanging forever.
          // 2 MB at 0.5 Mbps = 32 s upload + 10 s Django write slack = 42 s
          xhr.timeout = 60_000; // 60 seconds per chunk

          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable)
              onProgress({
                phase: "uploading", chunksDone: i, chunksTotal: totalChunks,
                currentChunkPct: Math.round((ev.loaded / ev.total) * 100),
                error: "",
              });
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              let m = `Chunk ${i} failed (HTTP ${xhr.status}).`;
              try { m = messageFrom(JSON.parse(xhr.responseText)); } catch { /**/ }
              reject(new Error(m));
            }
          };

          xhr.ontimeout = () => reject(new Error(`Chunk ${i} timed out after 60s — will retry.`));
          xhr.onerror   = () => reject(new Error(`Network error on chunk ${i}.`));
          xhr.send(fd);
        });

        lastErr = null;
        break; // success
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        // Don't retry on definitive server errors (4xx except 429/408)
        const msg = lastErr.message;
        if (msg.includes("HTTP 4") && !msg.includes("HTTP 408") && !msg.includes("HTTP 429") && !msg.includes("HTTP 409")) {
          break; // e.g. 403 CSRF — no point retrying
        }
      }
    }
    if (lastErr) throw lastErr;
  }

  // ── Step 3: Finalize ──────────────────────────────────────────────────────
  onProgress({ phase: "finalizing", chunksDone: totalChunks, chunksTotal: totalChunks, currentChunkPct: 100, error: "" });
  const finalToken = await csrfToken();
  const finalRes = await fetch(`/api/v1/upload/${uploadId}/finalize/`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": finalToken },
    body: JSON.stringify({}),
  });
  const finalData = await finalRes.json().catch(() => ({})) as Record<string, unknown>;
  if (!finalRes.ok) throw new Error(messageFrom(finalData));
  return String(finalData.final_path);
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SoftwareManagement() {
  const [items,  setItems]  = useState<Software[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing,  setEditing]  = useState<Software | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>(IDLE_UPLOAD);
  const [formError, setFormError] = useState("");
  const [notice,    setNotice]    = useState("");
  const [search,    setSearch]    = useState("");

  // Form draft fields
  const [draftName,        setDraftName]        = useState("");
  const [draftSlug,        setDraftSlug]        = useState("");
  const [draftDesc,        setDraftDesc]        = useState("");
  const [draftVersion,     setDraftVersion]     = useState("");
  const [draftPlatforms,   setDraftPlatforms]   = useState<string[]>(["Windows"]);
  const [draftAudience,    setDraftAudience]    = useState("all");
  const [draftLicence,     setDraftLicence]     = useState("");
  const [draftUrl,         setDraftUrl]         = useState("");
  const [draftGuide,       setDraftGuide]       = useState<number | "">("");
  const [draftStatus,      setDraftStatus]      = useState("draft");
  const [pendingFile,      setPendingFile]      = useState<File | null>(null);
  const [removeExisting,   setRemoveExisting]   = useState(false);

  // Upload config (from site settings)
  const [uploadConfig, setUploadConfig] = useState({
    chunkSizeBytes: CHUNK_SIZE, maxFileSizeBytes: MAX_FILE_BYTES, retries: 3,
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

  function resetFile() { setPendingFile(null); setRemoveExisting(false); setUploadState(IDLE_UPLOAD); }

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

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(""); setNotice(""); setSaving(true); setUploadState(IDLE_UPLOAD);
    const isEdit = !!editing;
    const url    = `/api/v1/admin/software/${isEdit ? `${editing!.id}/` : ""}`;

    try {
      const token = await csrfToken();
      let filePath: string | null = null;

      if (pendingFile) {
        try {
          filePath = await uploadFileInChunks(pendingFile, token, setUploadState, uploadConfig.chunkSizeBytes, uploadConfig.retries);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed.";
          setUploadState({ phase: "error", chunksDone: 0, chunksTotal: 0, currentChunkPct: 0, error: msg });
          setFormError(msg); setSaving(false); return;
        }
      }

      setUploadState((p) => ({ ...p, phase: pendingFile ? "attaching" : "idle" }));

      const body: Record<string, unknown> = {
        name: draftName, slug: draftSlug, description: draftDesc,
        version: draftVersion, platforms: draftPlatforms, audience: draftAudience,
        licence_notes: draftLicence, download_url: draftUrl,
        guide: draftGuide !== "" ? Number(draftGuide) : null, status: draftStatus,
      };
      if (filePath)       body.file_path   = filePath;
      else if (removeExisting) body.remove_file = true;

      const res  = await fetch(url, { method: isEdit ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-CSRFToken": token }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(messageFrom(data));

      setUploadState({ ...IDLE_UPLOAD, phase: "done" });
      closeEditor();
      setNotice(isEdit ? "Software updated." : "Software added.");
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save.";
      setFormError(msg);
      setUploadState((p) => p.phase !== "idle" ? { ...p, phase: "error", error: msg } : IDLE_UPLOAD);
    } finally { setSaving(false); }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isEditorOpen  = creating || editing !== null;
  const isUploading   = saving && !["idle", "done"].includes(uploadState.phase);
  const existingFileInfo = (editing?.file_url && !removeExisting)
    ? { name: editing.file_name ?? "Uploaded file", size: editing.file_size ?? 0, url: editing.file_url }
    : null;

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.platforms.some((p) => p.toLowerCase().includes(q))
    );
  }, [items, search]);

  function saveLabel() {
    if (!saving) return editing ? "Save changes" : "Add software";
    const m: Record<UploadState["phase"], string> = {
      idle: "Saving…", initializing: "Initializing…",
      uploading: `Chunk ${uploadState.chunksDone + 1}/${uploadState.chunksTotal}`,
      finalizing: "Assembling…", attaching: "Saving record…", done: "Done", error: "Failed",
    };
    return m[uploadState.phase] ?? "Saving…";
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const stats = {
    total:    items.length,
    active:   items.filter((s) => s.status === "active").length,
    hosted:   items.filter((s) => s.file_url).length,
    draft:    items.filter((s) => s.status === "draft").length,
  };

  return (
    <div
      className="admin-content"
      style={{ maxWidth: isEditorOpen ? "calc(100% - 480px - 24px)" : undefined, marginLeft: 0, marginRight: 0 }}
    >
      {/* ── Header ── */}
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

      {/* ── Stats row ── */}
      {items.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total",   value: stats.total,  color: "#334155", bg: "#f1f5f9" },
            { label: "Active",  value: stats.active,  color: "#166534", bg: "#dcfce7" },
            { label: "Hosted",  value: stats.hosted,  color: "#1d4ed8", bg: "#dbeafe" },
            { label: "Draft",   value: stats.draft,   color: "#92400e", bg: "#fef3c7" },
          ].map(({ label, value, color, bg }) => (
            <div key={label} style={{
              background: bg, borderRadius: 12, padding: "14px 18px",
              display: "flex", flexDirection: "column", gap: 2,
            }}>
              <span style={{ fontSize: ".72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color, opacity: 0.8 }}>{label}</span>
              <span style={{ fontSize: "1.6rem", fontWeight: 900, lineHeight: 1, color }}>{value}</span>
            </div>
          ))}
        </motion.div>
      )}

      {/* ── Search + toolbar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }} aria-hidden="true" />
          <input
            type="text" placeholder="Search software…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            aria-label="Search software"
            style={{
              width: "100%", padding: "9px 12px 9px 34px",
              border: "1.5px solid var(--border)", borderRadius: 10,
              fontSize: ".85rem", background: "var(--surface)", color: "var(--foreground)",
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
        <span style={{ marginLeft: "auto", fontSize: ".8rem", color: "var(--muted)" }}>
          {filtered.length !== items.length ? `${filtered.length} of ${items.length}` : `${items.length} item${items.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* ── Software grid ── */}
      {filtered.length === 0 ? (
        <div style={{
          background: "var(--surface)", border: "1.5px dashed var(--border)",
          borderRadius: 16, padding: "48px 24px", textAlign: "center",
        }}>
          <Package size={32} style={{ color: "#94a3b8", marginBottom: 12 }} aria-hidden="true" />
          <p style={{ margin: "0 0 4px", fontWeight: 700, color: "#475569" }}>
            {search ? "No software matches your search" : "No software yet"}
          </p>
          <p style={{ margin: 0, fontSize: ".85rem", color: "#94a3b8" }}>
            {search ? "Try a different search term" : "Add the first approved resource."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((item, idx) => {
            const audienceMeta = AUDIENCE_META[item.audience] ?? AUDIENCE_META.public;
            const isActive = item.status === "active";
            const isArchived = item.status === "archived";

            return (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.03, 0.15) }}
                style={{
                  background: "var(--surface)",
                  border: `1.5px solid ${editing?.id === item.id ? "#818cf8" : "var(--border)"}`,
                  borderRadius: 14,
                  padding: "16px 20px",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 16,
                  alignItems: "center",
                  opacity: isArchived ? 0.6 : 1,
                  boxShadow: editing?.id === item.id ? "0 0 0 3px rgba(129,140,248,.2)" : "none",
                  transition: "box-shadow 0.15s, border-color 0.15s",
                }}
              >
                {/* Left: info */}
                <div style={{ minWidth: 0 }}>
                  {/* Row 1: name + badges */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <strong style={{ fontSize: ".95rem", color: "var(--foreground)" }}>{item.name}</strong>
                    {item.version && (
                      <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#64748b", background: "#f1f5f9", borderRadius: 6, padding: "1px 7px" }}>
                        v{item.version}
                      </span>
                    )}
                    {/* Status chip */}
                    <span className={`status-chip ${item.status}`} style={{ fontSize: ".72rem" }}>
                      {item.status}
                    </span>
                    {/* Hosted badge */}
                    {item.file_url && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        background: "#dbeafe", color: "#1d4ed8",
                        borderRadius: 999, padding: "2px 8px", fontSize: ".7rem", fontWeight: 800,
                      }}>
                        <HardDrive size={10} aria-hidden="true" /> Hosted
                      </span>
                    )}
                    {/* Audience badge */}
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      background: audienceMeta.bg, color: audienceMeta.color,
                      borderRadius: 999, padding: "2px 9px", fontSize: ".7rem", fontWeight: 700,
                    }}>
                      {AUDIENCE_OPTIONS.find((a) => a.value === item.audience)?.label ?? item.audience}
                    </span>
                  </div>

                  {/* Row 2: description */}
                  <p style={{ margin: "0 0 8px", fontSize: ".83rem", color: "var(--muted)", lineHeight: 1.5 }}>
                    {item.description.length > 90 ? item.description.slice(0, 90) + "…" : item.description}
                  </p>

                  {/* Row 3: platforms + links */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {/* Platform icons */}
                    <div style={{ display: "flex", gap: 4 }}>
                      {item.platforms.map((p) => (
                        <span key={p} title={p} style={{
                          fontSize: ".9rem", width: 24, height: 24, display: "flex",
                          alignItems: "center", justifyContent: "center",
                          background: "#f1f5f9", borderRadius: 6,
                        }}>
                          {PLATFORM_ICONS[p] ?? p[0]}
                        </span>
                      ))}
                    </div>
                    {/* File size */}
                    {item.file_url && item.file_size > 0 && (
                      <span style={{ fontSize: ".74rem", color: "#64748b" }}>
                        {formatBytes(item.file_size)}
                      </span>
                    )}
                    {/* External link */}
                    {item.download_url && (
                      <a href={item.download_url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: ".74rem", color: "var(--brand)", display: "flex", alignItems: "center", gap: 3, fontWeight: 700 }}
                        onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={11} aria-hidden="true" /> External
                      </a>
                    )}
                    {/* Linked guide */}
                    {item.guide_title && (
                      <span style={{ fontSize: ".74rem", color: "#64748b", display: "flex", alignItems: "center", gap: 3 }}>
                        📖 {item.guide_title}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: edit button */}
                <button
                  aria-label={`Edit ${item.name}`}
                  onClick={() => openEdit(item)}
                  style={{
                    width: 38, height: 38, border: "1.5px solid var(--border)",
                    borderRadius: 10, background: "var(--surface)",
                    color: "var(--brand)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#eef2ff"; e.currentTarget.style.borderColor = "#818cf8"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
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
            className="editor-panel"
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            aria-label={editing ? `Edit ${editing.name}` : "Add software"}
            style={{ width: 460, display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 48px)" }}
          >
            {/* Panel header */}
            <header style={{ padding: "18px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <span style={{ fontSize: ".72rem", color: "#94a3b8", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em" }}>
                  {creating ? "New software" : "Edit software"}
                </span>
                <h2 style={{ margin: "2px 0 0", fontSize: "1.05rem" }}>
                  {editing ? editing.name : "Add software"}
                </h2>
              </div>
              <button onClick={closeEditor} disabled={saving} aria-label="Close"
                style={{ width: 34, height: 34, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            {/* Scrollable form */}
            <form id="sw-form" onSubmit={submit} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              <div className="ep-form">

                {/* Form error */}
                {formError && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 14px", display: "flex", gap: 10, alignItems: "flex-start" }} role="alert">
                    <AlertTriangle size={15} style={{ color: "#dc2626", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                    <span style={{ fontSize: ".85rem", color: "#991b1b" }}>{formError}</span>
                  </div>
                )}

                {/* ── SECTION: Basic info ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: ".75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                    Basic information
                  </p>

                  {/* Name + Version */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10 }}>
                    <div>
                      <label htmlFor="sw-name" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Name <span style={{ color: "#ef4444" }}>*</span></span>
                        <span style={{ fontWeight: 400, fontSize: ".73rem", color: draftName.length > 130 ? "#dc2626" : "#94a3b8" }}>{draftName.length}/140</span>
                      </label>
                      <input id="sw-name" type="text" required maxLength={140} value={draftName}
                        placeholder="e.g. Microsoft Office"
                        onChange={(e) => { setDraftName(e.target.value); if (!editing) setDraftSlug(slugify(e.target.value)); }} />
                    </div>
                    <div>
                      <label htmlFor="sw-version">Version</label>
                      <input id="sw-version" type="text" maxLength={80} value={draftVersion}
                        placeholder="e.g. 2024" onChange={(e) => setDraftVersion(e.target.value)} />
                    </div>
                  </div>

                  {/* Slug */}
                  <div>
                    <label htmlFor="sw-slug" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>URL slug <span style={{ color: "#ef4444" }}>*</span></span>
                      <span style={{ fontWeight: 400, fontSize: ".73rem", color: "#94a3b8" }}>auto-generated</span>
                    </label>
                    <input id="sw-slug" type="text" required pattern={"[a-z0-9][-a-z0-9]*"} value={draftSlug}
                      placeholder="e.g. microsoft-office"
                      onChange={(e) => setDraftSlug(e.target.value)} />
                  </div>

                  {/* Description */}
                  <div>
                    <label htmlFor="sw-desc" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Description <span style={{ color: "#ef4444" }}>*</span></span>
                      <span style={{ fontWeight: 400, fontSize: ".73rem", color: draftDesc.length > 380 ? "#dc2626" : "#94a3b8" }}>{draftDesc.length}/400</span>
                    </label>
                    <textarea id="sw-desc" required maxLength={400} rows={3} value={draftDesc}
                      placeholder="What this software does and who it's for."
                      onChange={(e) => setDraftDesc(e.target.value)} />
                  </div>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid #f1f5f9", margin: "0" }} />

                {/* ── SECTION: Platforms + audience ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: ".75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                    Availability
                  </p>

                  {/* Platforms as icon toggle buttons */}
                  <div>
                    <label style={{ display: "block", marginBottom: 8 }}>Platforms</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {PLATFORM_OPTIONS.map((p) => {
                        const selected = draftPlatforms.includes(p);
                        return (
                          <button
                            key={p} type="button"
                            onClick={() => {
                              setDraftPlatforms((prev) =>
                                selected ? prev.filter((x) => x !== p) : [...prev, p]
                              );
                            }}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              padding: "7px 12px", borderRadius: 8, cursor: "pointer",
                              fontWeight: selected ? 700 : 500, fontSize: ".83rem",
                              border: `1.5px solid ${selected ? "#818cf8" : "#e2e8f0"}`,
                              background: selected ? "#eef2ff" : "var(--surface)",
                              color: selected ? "#4338ca" : "#475569",
                              transition: "all 0.12s",
                            }}
                          >
                            <span>{PLATFORM_ICONS[p] ?? "💻"}</span> {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Audience + Status row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label htmlFor="sw-audience">Audience</label>
                      <select id="sw-audience" value={draftAudience} onChange={(e) => setDraftAudience(e.target.value)}>
                        {AUDIENCE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="sw-status">Status</label>
                      <select id="sw-status" value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid #f1f5f9", margin: "0" }} />

                {/* ── SECTION: Installer file ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ margin: 0, fontSize: ".75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                      Installer file
                    </p>
                    <span style={{ fontSize: ".72rem", color: "#94a3b8" }}>optional · max {formatBytes(uploadConfig.maxFileSizeBytes)}</span>
                  </div>

                  <FileDropzone
                    existing={existingFileInfo}
                    pending={pendingFile}
                    disabled={isUploading}
                    maxFileSizeBytes={uploadConfig.maxFileSizeBytes}
                    chunkSizeBytes={uploadConfig.chunkSizeBytes}
                    onSelect={setPendingFile}
                    onRemovePending={() => setPendingFile(null)}
                    onRemoveExisting={() => { setRemoveExisting(true); setPendingFile(null); }}
                  />

                  {/* Upload progress */}
                  {(saving || uploadState.phase === "error") && pendingFile && (
                    <UploadProgress state={uploadState} fileName={pendingFile.name} />
                  )}

                  {uploadState.phase === "done" && !pendingFile && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".82rem", color: "#166534", fontWeight: 700, background: "#f0fdf4", borderRadius: 8, padding: "8px 12px" }}>
                      <CheckCircle2 size={14} aria-hidden="true" /> File uploaded and attached successfully
                    </div>
                  )}
                </div>

                <hr style={{ border: "none", borderTop: "1px solid #f1f5f9", margin: "0" }} />

                {/* ── SECTION: Links + metadata ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: ".75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#94a3b8" }}>
                    Links &amp; metadata
                  </p>

                  {/* External URL */}
                  <div>
                    <label htmlFor="sw-url">
                      External download URL
                      <span style={{ fontWeight: 400, fontSize: ".73rem", color: "#94a3b8", marginLeft: 5 }}>
                        (shown as "Official site" when file is hosted)
                      </span>
                    </label>
                    <div style={{ position: "relative" }}>
                      <input id="sw-url" type="url" value={draftUrl}
                        placeholder="https://example.com/download"
                        onChange={(e) => setDraftUrl(e.target.value)}
                        style={{ paddingRight: draftUrl ? 36 : undefined }} />
                      {draftUrl && (
                        <a href={draftUrl} target="_blank" rel="noopener noreferrer"
                          title="Preview link" aria-label="Preview download link"
                          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#234395", display: "flex" }}>
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Licence notes */}
                  <div>
                    <label htmlFor="sw-licence" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Licence notes <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span></span>
                      <span style={{ fontWeight: 400, fontSize: ".73rem", color: draftLicence.length > 450 ? "#dc2626" : "#94a3b8" }}>{draftLicence.length}/500</span>
                    </label>
                    <textarea id="sw-licence" maxLength={500} rows={2} value={draftLicence}
                      placeholder="e.g. Available to all enrolled students via Microsoft 365."
                      onChange={(e) => setDraftLicence(e.target.value)} />
                  </div>

                  {/* Linked guide */}
                  <div>
                    <label htmlFor="sw-guide">
                      Linked guide <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                    </label>
                    <select id="sw-guide" value={draftGuide}
                      onChange={(e) => setDraftGuide(e.target.value === "" ? "" : Number(e.target.value))}>
                      <option value="">No linked guide</option>
                      {guides.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                    </select>
                  </div>
                </div>

              </div>
            </form>

            {/* Panel footer */}
            <div style={{
              borderTop: "1px solid #e2e8f0", padding: "14px 20px",
              background: "#f8fafc", display: "flex", justifyContent: "flex-end",
              gap: 10, flexShrink: 0,
            }}>
              <button type="button" className="secondary-button" onClick={closeEditor} disabled={saving}>
                Cancel
              </button>
              <button form="sw-form" type="submit" className="primary-button" disabled={saving}
                style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140, justifyContent: "center" }}>
                {saving
                  ? <><Loader2 size={14} className="spin" aria-hidden="true" />{saveLabel()}</>
                  : editing ? "Save changes" : "Add software"
                }
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
