"use client";

import { Download, Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  url: string;          // gated API endpoint e.g. /api/v1/software/office/download/
  fileName: string;
  fileSize: number;
  /** The audience value from the SoftwareResource — used to decide
   *  whether we can short-circuit to a simple anchor for public files. */
  audience: string;
}

export function SoftwareDownloadButton({ url, fileName, fileSize, audience }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // ── Public resources: use a simple anchor — no auth needed ────────────────
  // The download view also allows unauthenticated access for audience='public'
  // or 'all', but we still go through fetch to stay consistent and show errors.

  async function handleDownload() {
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch(url, {
        credentials: "include",   // send session cookie
        headers: { Accept: "*/*" },
      });

      if (res.status === 401) {
        // Not signed in — redirect to login
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      if (res.status === 403) {
        setErrorMsg("You don't have permission to download this file.");
        setState("error");
        return;
      }

      if (!res.ok) {
        setErrorMsg("Download failed. Please try again.");
        setState("error");
        return;
      }

      // For large files we use a streaming approach — create an object URL
      // from the blob so the browser triggers a real Save-As dialog.
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Small delay before revoking so the browser has time to initiate the save
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);

      setState("idle");
    } catch {
      setErrorMsg("A network error occurred. Please try again.");
      setState("error");
    }
  }

  const sizeLabel = fileSize > 0 ? `(${formatBytes(fileSize)})` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        onClick={handleDownload}
        disabled={state === "loading"}
        className="primary-button"
        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
        aria-label={`Download ${fileName}`}
      >
        {state === "loading" ? (
          <>
            <Loader2 size={15} className="spin" aria-hidden="true" />
            Preparing download…
          </>
        ) : (
          <>
            <Download size={15} aria-hidden="true" />
            Download
            {sizeLabel && (
              <span style={{ opacity: 0.75, fontSize: ".78em" }}>{sizeLabel}</span>
            )}
            {/* Small lock icon for restricted audience */}
            {audience !== "public" && audience !== "all" && (
              <Lock size={11} style={{ opacity: 0.5, marginLeft: 2 }} aria-hidden="true" />
            )}
          </>
        )}
      </button>

      {state === "error" && (
        <p style={{
          margin: 0, fontSize: ".78rem", color: "#991b1b",
          display: "flex", alignItems: "center", gap: 5,
        }} role="alert">
          {errorMsg}
          <button
            onClick={() => setState("idle")}
            style={{ border: "none", background: "none", cursor: "pointer", color: "#991b1b", padding: 0, fontWeight: 700, fontSize: ".78rem" }}
          >
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
