"use client";

import { AnimatePresence, motion } from "motion/react";
import { BookOpen, ExternalLink, FilePlus2, FileText, Pencil, UploadCloud, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { adminGet, adminSave, type Guide } from "@/lib/admin-api";

const emptyGuide = {
  title: "",
  slug: "",
  summary: "",
  audience: "all" as const,
  tags: [] as string[],
  status: "draft" as const,
  reviewed_at: null,
  pdf_url: null,
  pdf_name: null,
  pdf_size: 0,
};

function fileSize(bytes: number) {
  if (!bytes) return "Size unavailable";
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function GuideManagement() {
  const [items, setItems] = useState<Guide[]>([]);
  const [editing, setEditing] = useState<Guide | null>(null);
  const [creating, setCreating] = useState(false);
  const [chosenFile, setChosenFile] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function load() {
    adminGet<Guide[]>("guides").then(setItems).catch((reason) => setError(reason.message));
  }

  useEffect(load, []);
  const selected = editing ?? (creating ? emptyGuide : null);

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setChosenFile("");
    setDragging(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    const data = new FormData(event.currentTarget);
    const tags = String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    data.set("tags", JSON.stringify(tags));
    const upload = data.get("pdf_file");
    if (!(upload instanceof File) || upload.size === 0) data.delete("pdf_file");
    if (!data.get("reviewed_at")) data.delete("reviewed_at");

    try {
      await adminSave<Guide>("guides", data, editing?.id);
      const message = editing ? "Guide updated successfully." : "PDF guide created successfully.";
      closeEditor();
      setNotice(message);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Guide could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-content">
      <header className="admin-heading guide-admin-heading">
        <div>
          <p className="eyebrow">Knowledge base</p>
          <h1>PDF guides</h1>
          <p>Publish reviewed support documents that students can open directly in the helpdesk.</p>
        </div>
        <button className="primary-button" onClick={() => { setCreating(true); setEditing(null); setChosenFile(""); }}>
          <FilePlus2 aria-hidden="true" /> Upload guide
        </button>
      </header>

      {notice && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-notice" role="status">{notice}</motion.p>}
      {error && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="admin-error" role="alert">{error}</motion.p>}

      <section className="guide-library" aria-label="Guide library">
        <div className="guide-library-head">
          <div><BookOpen aria-hidden="true" /><span><strong>Document library</strong><small>{items.length} {items.length === 1 ? "guide" : "guides"}</small></span></div>
          <span>PDF · maximum 15 MB</span>
        </div>
        <div className="guide-admin-list">
          {items.length ? items.map((guide, index) => (
            <motion.article key={guide.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .04, .2) }}>
              <div className="pdf-tile"><FileText aria-hidden="true" /><span>PDF</span></div>
              <div className="guide-row-copy">
                <div className="guide-row-title"><strong>{guide.title}</strong><span className={`status-chip ${guide.status}`}>{guide.status}</span></div>
                <p>{guide.summary}</p>
                <div className="guide-file-meta"><span>{guide.pdf_name ?? "No PDF attached"}</span><span>{fileSize(guide.pdf_size)}</span><span>{guide.audience}</span></div>
              </div>
              <div className="guide-row-actions">
                {guide.pdf_url && <a href={guide.pdf_url} target="_blank" rel="noreferrer" aria-label={`Open ${guide.title}`}><ExternalLink aria-hidden="true" /></a>}
                <button aria-label={`Edit ${guide.title}`} onClick={() => { setEditing(guide); setCreating(false); setChosenFile(""); }}><Pencil aria-hidden="true" /></button>
              </div>
            </motion.article>
          )) : <div className="guide-empty"><UploadCloud aria-hidden="true" /><h2>Upload your first guide</h2><p>Add a reviewed PDF and decide who can see it.</p></div>}
        </div>
      </section>

      <AnimatePresence>
        {selected && (
          <motion.aside
            key={editing?.id ?? "new"}
            className="editor-panel guide-editor"
            initial={{ opacity: 0, x: 28, scale: .985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: .985 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
          >
            <header><div><span>{editing ? "Update document" : "New document"}</span><h2>{editing ? editing.title : "Upload PDF guide"}</h2></div><button aria-label="Close editor" onClick={closeEditor}><X aria-hidden="true" /></button></header>
            <form onSubmit={submit}>
              <label>Guide title<input name="title" defaultValue={selected.title} required maxLength={160} placeholder="Microsoft 365 setup guide" /></label>
              <label>URL slug<input name="slug" defaultValue={selected.slug} pattern="[a-z0-9-]+" required placeholder="microsoft-365-setup" /></label>
              <label>Short description<textarea name="summary" defaultValue={selected.summary} required maxLength={300} rows={3} placeholder="Tell readers what this guide helps them complete." /></label>

              <label className={`pdf-dropzone ${dragging ? "dragging" : ""}`} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDrop={() => setDragging(false)}>
                <input name="pdf_file" type="file" accept="application/pdf,.pdf" required={!editing} onChange={(event) => setChosenFile(event.target.files?.[0]?.name ?? "")} />
                <UploadCloud aria-hidden="true" />
                <strong>{chosenFile || (editing?.pdf_name ? "Replace current PDF" : "Choose a PDF file")}</strong>
                <span>{editing?.pdf_name && !chosenFile ? `Current: ${editing.pdf_name}` : "Drag and drop or browse · up to 15 MB"}</span>
              </label>

              <label>Tags<input name="tags" defaultValue={selected.tags.join(", ")} placeholder="wifi, accounts, windows" /></label>
              <div className="form-pair">
                <label>Audience<select name="audience" defaultValue={selected.audience}><option value="all">Students & staff</option><option value="student">Students</option><option value="staff">Faculty & staff</option><option value="public">Public</option></select></label>
                <label>Status<select name="status" defaultValue={selected.status}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
              </div>
              <label>Reviewed date<input name="reviewed_at" type="date" defaultValue={selected.reviewed_at ?? ""} /></label>
              <div className="editor-actions"><button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create guide"}</button></div>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
