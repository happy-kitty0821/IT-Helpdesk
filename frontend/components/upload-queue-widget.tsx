"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, HardDrive, Loader2, X } from "lucide-react";
import { useUploadQueue, type UploadJob } from "@/lib/upload-queue";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

// ── Single job card ────────────────────────────────────────────────────────

function JobCard({ job }: { job: UploadJob }) {
  const { dismiss } = useUploadQueue();

  const isDone  = job.phase === "done";
  const isError = job.phase === "error";
  const isActive = !isDone && !isError;

  const pct = job.chunksTotal > 0
    ? Math.round((job.chunksDone / job.chunksTotal) * 100)
    : 0;

  const phaseLabel: Partial<Record<UploadJob["phase"], string>> = {
    queued:       "Waiting…",
    initializing: "Preparing…",
    uploading:    job.chunksTotal > 0
                    ? `${job.chunksDone} / ${job.chunksTotal} chunks`
                    : "Uploading…",
    finalizing:   "Assembling…",
    done:         "Complete",
    error:        job.error || "Failed",
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      style={{
        background: "#fff",
        border: `1.5px solid ${isError ? "#fca5a5" : isDone ? "#86efac" : "#e2e8f0"}`,
        borderRadius: 12, padding: "12px 14px",
        display: "grid", gridTemplateColumns: "32px 1fr auto",
        gap: 10, alignItems: "center",
        boxShadow: "0 4px 14px rgba(15,23,42,.08)",
        minWidth: 0,
      }}
    >
      {/* Icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: isError ? "#fee2e2" : isDone ? "#dcfce7" : "#eef2ff",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {isError
          ? <AlertTriangle size={16} style={{ color: "#dc2626" }} aria-hidden="true" />
          : isDone
          ? <CheckCircle2 size={16} style={{ color: "#16a34a" }} aria-hidden="true" />
          : <HardDrive size={16} style={{ color: "#4f46e5" }} aria-hidden="true" />
        }
      </div>

      {/* Info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong style={{
            fontSize: ".8rem", display: "block",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: isError ? "#991b1b" : "#1e293b",
          }}>
            {job.fileName}
          </strong>
          {isActive && job.chunksTotal > 0 && (
            <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#6366f1", flexShrink: 0 }}>
              {pct}%
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
          {isActive && (
            <Loader2 size={11} className="spin" style={{ color: "#6366f1", flexShrink: 0 }} aria-hidden="true" />
          )}
          <span style={{
            fontSize: ".72rem",
            color: isError ? "#dc2626" : isDone ? "#16a34a" : "#64748b",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {phaseLabel[job.phase]} · {formatBytes(job.fileSize)}
          </span>
        </div>
        {/* Progress bar */}
        {isActive && job.chunksTotal > 0 && (
          <div style={{ height: 3, background: "#e0e7ff", borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
            <div style={{
              height: "100%", borderRadius: 999,
              background: job.phase === "finalizing" ? "#6366f1" : "#818cf8",
              width: job.phase === "finalizing" ? "100%" : `${pct}%`,
              transition: "width 0.3s ease",
            }} />
          </div>
        )}
      </div>

      {/* Dismiss (only on done/error) */}
      {(isDone || isError) && (
        <button
          onClick={() => dismiss(job.id)}
          aria-label="Dismiss"
          style={{
            border: "none", background: "none", cursor: "pointer",
            color: "#94a3b8", padding: 2, borderRadius: 5,
            display: "flex", flexShrink: 0,
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </motion.div>
  );
}

// ── Widget ─────────────────────────────────────────────────────────────────

export function UploadQueueWidget() {
  const { jobs } = useUploadQueue();
  if (jobs.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="File upload progress"
      style={{
        position: "fixed", bottom: 24, right: 24,
        zIndex: 50, width: 320,
        display: "flex", flexDirection: "column", gap: 8,
        pointerEvents: "none", // let clicks pass through the container
      }}
    >
      <AnimatePresence>
        {jobs.map((job) => (
          // Re-enable pointer events on individual cards
          <div key={job.id} style={{ pointerEvents: "auto" }}>
            <JobCard job={job} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
