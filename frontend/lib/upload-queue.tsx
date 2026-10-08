"use client";

/**
 * Global background upload queue.
 *
 * Usage
 * ─────
 * // Start a background upload:
 * const { enqueue } = useUploadQueue();
 * enqueue({ file, chunkSize, retries, onComplete });
 *
 * // The floating UploadQueueWidget (rendered in AdminShell) shows progress
 * // for every active upload regardless of which page you're on.
 */

import {
  createContext, useCallback, useContext, useRef, useState,
  type ReactNode,
} from "react";
import { csrfToken } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

export type UploadPhase =
  | "queued"
  | "initializing"
  | "uploading"
  | "finalizing"
  | "done"
  | "error";

export interface UploadJob {
  id: string;          // random UUID assigned on enqueue
  fileName: string;
  fileSize: number;
  phase: UploadPhase;
  chunksDone: number;
  chunksTotal: number;
  error: string;
  /** Called with the final_path when the upload completes. */
  onComplete: (finalPath: string) => void;
  /** Called when the upload fails after all retries. */
  onError: (msg: string) => void;
}

export interface EnqueueParams {
  file: File;
  chunkSize: number;
  retries: number;
  onComplete: (finalPath: string) => void;
  onError?: (msg: string) => void;
}

interface UploadQueueContextValue {
  jobs: UploadJob[];
  enqueue: (params: EnqueueParams) => string; // returns the job id
  dismiss: (id: string) => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const Ctx = createContext<UploadQueueContextValue | null>(null);

export function useUploadQueue() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploadQueue must be used inside UploadQueueProvider");
  return ctx;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function msgFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    if (typeof r.detail === "string") return r.detail;
    for (const v of Object.values(r))
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }
  return "Upload failed.";
}

// ── Provider ───────────────────────────────────────────────────────────────

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  // We keep a ref map to avoid stale-closure issues in the async upload loop.
  const jobsRef = useRef<Map<string, UploadJob>>(new Map());

  function patch(id: string, update: Partial<UploadJob>) {
    jobsRef.current.set(id, { ...jobsRef.current.get(id)!, ...update });
    // Spread to trigger re-render
    setJobs([...jobsRef.current.values()]);
  }

  const enqueue = useCallback((params: EnqueueParams): string => {
    const id = uid();
    const job: UploadJob = {
      id,
      fileName: params.file.name,
      fileSize: params.file.size,
      phase: "queued",
      chunksDone: 0,
      chunksTotal: 0,
      error: "",
      onComplete: params.onComplete,
      onError: params.onError ?? (() => {}),
    };
    jobsRef.current.set(id, job);
    setJobs([...jobsRef.current.values()]);

    // Start the upload asynchronously — does not block the caller
    runUpload(id, params.file, params.chunkSize, params.retries)
      .catch(() => {/* errors patched inside runUpload */});

    return id;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback((id: string) => {
    jobsRef.current.delete(id);
    setJobs([...jobsRef.current.values()]);
  }, []);

  // ── Core upload logic ────────────────────────────────────────────────────

  async function runUpload(id: string, file: File, chunkSize: number, maxRetries: number) {
    const totalChunks = Math.ceil(file.size / chunkSize);

    patch(id, { phase: "initializing", chunksTotal: totalChunks });

    // 1. Init
    let token = await csrfToken();
    const initRes = await fetch("/api/v1/upload/init/", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRFToken": token },
      body: JSON.stringify({
        filename:     file.name,
        total_size:   file.size,
        total_chunks: totalChunks,
        chunk_size:   chunkSize,
      }),
    });
    const initData = await initRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!initRes.ok) {
      const msg = msgFrom(initData);
      patch(id, { phase: "error", error: msg });
      jobsRef.current.get(id)?.onError(msg);
      return;
    }
    const uploadId = String(initData.upload_id);

    // 2. Chunks
    for (let i = 0; i < totalChunks; i++) {
      patch(id, { phase: "uploading", chunksDone: i });

      const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
      let lastErr: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0)
          await new Promise<void>((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));

        try {
          token = await csrfToken();
          const fd = new FormData();
          fd.append("chunk", blob, `chunk-${i}`);

          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 90_000);
          let res: Response;
          try {
            res = await fetch(`/api/v1/upload/${uploadId}/chunk/${i}/`, {
              method: "PUT", credentials: "include",
              headers: { "X-CSRFToken": token },
              body: fd, signal: ctrl.signal,
            });
          } finally { clearTimeout(timer); }

          if (res.ok) { lastErr = null; break; }
          let m = `Chunk ${i + 1} failed (HTTP ${res.status}).`;
          try { m = msgFrom(await res.json()); } catch { /**/ }
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
            throw new Error(m);
          throw new Error(m);
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
          if (e instanceof Error && e.name === "AbortError")
            lastErr = new Error(`Chunk ${i + 1} timed out — retrying…`);
          if (lastErr.message.includes("HTTP 4") &&
              !lastErr.message.includes("HTTP 408") &&
              !lastErr.message.includes("HTTP 429"))
            break;
        }
      }

      if (lastErr) {
        const msg = lastErr.message;
        patch(id, { phase: "error", error: msg });
        jobsRef.current.get(id)?.onError(msg);
        return;
      }

      patch(id, { chunksDone: i + 1 });
    }

    // 3. Finalize
    patch(id, { phase: "finalizing" });
    token = await csrfToken();
    const finalRes = await fetch(`/api/v1/upload/${uploadId}/finalize/`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRFToken": token },
      body: JSON.stringify({}),
    });
    const finalData = await finalRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!finalRes.ok) {
      const msg = msgFrom(finalData);
      patch(id, { phase: "error", error: msg });
      jobsRef.current.get(id)?.onError(msg);
      return;
    }

    const finalPath = String(finalData.final_path);
    patch(id, { phase: "done" });
    jobsRef.current.get(id)?.onComplete(finalPath);
    // Auto-dismiss done jobs after 5 s
    setTimeout(() => dismiss(id), 5_000);
  }

  return (
    <Ctx.Provider value={{ jobs, enqueue, dismiss }}>
      {children}
    </Ctx.Provider>
  );
}
