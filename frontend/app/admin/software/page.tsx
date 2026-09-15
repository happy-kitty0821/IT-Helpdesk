"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Download, Package, Pencil, Plus, X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { adminGet, adminSave, type Guide, type Software } from "@/lib/admin-api";

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

const blankSoftware: Omit<Software, "id" | "guide_title" | "updated_by_name" | "updated_at"> = {
  name: "", slug: "", description: "", version: "",
  platforms: ["Windows"], audience: "all",
  licence_notes: "", download_url: "", guide: null, status: "draft",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(text: string) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SoftwareManagement() {
  const [items, setItems]   = useState<Software[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing, setEditing]   = useState<Software | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]   = useState("");
  const [notice, setNotice] = useState("");

  // Editor drafts (controlled so we can show char counters)
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

  // ── Data load ─────────────────────────────────────────────────────────────

  function load() {
    Promise.all([
      adminGet<Software[]>("software"),
      adminGet<Guide[]>("guides"),
    ])
      .then(([sw, gs]) => { setItems(sw); setGuides(gs); })
      .catch((e: Error) => setError(e.message));
  }

  useEffect(load, []);

  // ── Open editor ───────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setDraftName(blankSoftware.name);
    setDraftSlug(blankSoftware.slug);
    setDraftDescription(blankSoftware.description);
    setDraftVersion(blankSoftware.version);
    setDraftPlatforms([...blankSoftware.platforms]);
    setDraftAudience(blankSoftware.audience);
    setDraftLicence(blankSoftware.licence_notes);
    setDraftUrl(blankSoftware.download_url);
    setDraftGuide("");
    setDraftStatus(blankSoftware.status);
    setError("");
    setNotice("");
  }

  function openEdit(item: Software) {
    setCreating(false);
    setEditing(item);
    setDraftName(item.name);
    setDraftSlug(item.slug);
    setDraftDescription(item.description);
    setDraftVersion(item.version);
    setDraftPlatforms([...item.platforms]);
    setDraftAudience(item.audience);
    setDraftLicence(item.licence_notes);
    setDraftUrl(item.download_url);
    setDraftGuide(item.guide ?? "");
    setDraftStatus(item.status);
    setError("");
    setNotice("");
  }

  function closeEditor() {
    setEditing(null);
    setCreating(false);
  }

  // ── Platform toggle ───────────────────────────────────────────────────────

  function togglePlatform(platform: string, checked: boolean) {
    setDraftPlatforms((prev) =>
      checked ? [...prev, platform] : prev.filter((p) => p !== platform)
    );
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      await adminSave<Software>("software", {
        name: draftName,
        slug: draftSlug,
        description: draftDescription,
        version: draftVersion,
        platforms: draftPlatforms,
        audience: draftAudience,
        licence_notes: draftLicence,
        download_url: draftUrl,
        guide: draftGuide !== "" ? Number(draftGuide) : null,
        status: draftStatus,
      }, editing?.id);
      closeEditor();
      setNotice(editing ? "Software updated." : "Software added.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Software could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const isEditorOpen = creating || editing !== null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="admin-content">
      {/* Header */}
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Resources</p>
          <h1>Software catalogue</h1>
          <p>Control which approved tools and download links appear publicly.</p>
        </div>
        <button className="primary-button" onClick={openCreate}>
          <Plus aria-hidden="true" /> Add software
        </button>
      </header>

      {/* Notices */}
      <AnimatePresence mode="wait">
        {notice && (
          <motion.p
            key="notice"
            className="admin-notice"
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {notice}
          </motion.p>
        )}
        {error && (
          <motion.p
            key="error"
            className="admin-error"
            role="alert"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Table + editor layout */}
      <div className="manager-layout">

        {/* ── Table ── */}
        <section className="content-table sw-table" aria-label="Software catalogue">
          <div className="table-head" aria-hidden="true">
            <span>Software</span>
            <span>Version</span>
            <span>Audience</span>
            <span>Platforms</span>
            <span>Status</span>
            <span></span>
          </div>

          {items.length === 0 ? (
            <div className="empty-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Package aria-hidden="true" style={{ width: 22, color: "#234395" }} />
              <span>No software yet. Add the first approved resource.</span>
            </div>
          ) : (
            items.map((item, idx) => (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.04, 0.2) }}
              >
                <div>
                  <strong>{item.name}</strong>
                  <small style={{ color: "#64748b", fontSize: ".82rem" }}>
                    {item.description.length > 72
                      ? item.description.slice(0, 72) + "…"
                      : item.description}
                  </small>
                </div>
                <span style={{ color: "#64748b", fontSize: ".85rem" }}>
                  {item.version || <em style={{ color: "#cbd5e1" }}>—</em>}
                </span>
                <span style={{ textTransform: "capitalize", fontSize: ".85rem", color: "#475569" }}>
                  {AUDIENCE_OPTIONS.find((a) => a.value === item.audience)?.label ?? item.audience}
                </span>
                <span style={{ fontSize: ".82rem", color: "#64748b" }}>
                  {item.platforms.join(", ") || <em style={{ color: "#cbd5e1" }}>—</em>}
                </span>
                <span>
                  <span className={`status-chip ${item.status}`}>{item.status}</span>
                </span>
                <button aria-label={`Edit ${item.name}`} onClick={() => openEdit(item)}>
                  <Pencil aria-hidden="true" />
                </button>
              </motion.article>
            ))
          )}
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
            >
              <header>
                <div>
                  <span style={{ fontSize: ".78rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>
                    {creating ? "New entry" : "Edit entry"}
                  </span>
                  <h2 style={{ marginTop: 2 }}>{editing ? editing.name : "Add software"}</h2>
                </div>
                <button aria-label="Close editor" onClick={closeEditor}><X aria-hidden="true" /></button>
              </header>

              <form onSubmit={submit}>
                {/* Name + Version */}
                <div className="form-pair">
                  <div>
                    <label htmlFor="sw-name">
                      Name <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".8rem" }}>({draftName.length}/140)</span>
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
                      Version <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".8rem" }}>({draftVersion.length}/80)</span>
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
                    <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".8rem", marginLeft: 6 }}>
                      (lowercase letters, numbers, hyphens only)
                    </span>
                  </label>
                  <input
                    id="sw-slug" type="text" required
                    pattern="[a-z0-9-]+"
                    value={draftSlug}
                    placeholder="e.g. microsoft-office"
                    onChange={(e) => setDraftSlug(e.target.value)}
                  />
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="sw-desc" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Description</span>
                    <span style={{ color: draftDescription.length > 380 ? "#b91c1c" : "#94a3b8", fontWeight: 400, fontSize: ".8rem" }}>
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
                  <div className="checkbox-grid">
                    {PLATFORM_OPTIONS.map((p) => (
                      <label key={p} style={{ flexDirection: "row", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 500 }}>
                        <input
                          type="checkbox"
                          checked={draftPlatforms.includes(p)}
                          style={{ width: 16, height: 16 }}
                          onChange={(e) => togglePlatform(p, e.target.checked)}
                        />
                        {p}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* Download URL */}
                <div>
                  <label htmlFor="sw-url">Download URL</label>
                  <input
                    id="sw-url" type="url"
                    value={draftUrl}
                    placeholder="https://example.com/download"
                    onChange={(e) => setDraftUrl(e.target.value)}
                  />
                </div>

                {/* Licence notes */}
                <div>
                  <label htmlFor="sw-licence" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Licence notes <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".8rem" }}>(optional)</span></span>
                    <span style={{ color: draftLicence.length > 450 ? "#b91c1c" : "#94a3b8", fontWeight: 400, fontSize: ".8rem" }}>
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
                  <label htmlFor="sw-guide">Linked guide <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: ".8rem" }}>(optional)</span></label>
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
                <div className="form-pair">
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

                {/* Download URL quick preview */}
                {draftUrl && (
                  <a
                    href={draftUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".8rem", color: "#234395", fontWeight: 700 }}
                  >
                    <Download size={13} aria-hidden="true" /> Preview download link
                  </a>
                )}

                <div className="editor-actions">
                  <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? "Saving…" : editing ? "Save changes" : "Add software"}
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
