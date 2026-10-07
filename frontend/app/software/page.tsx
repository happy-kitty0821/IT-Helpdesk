"use client";

import { Download, ExternalLink, Loader2, Lock, MonitorSmartphone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Software } from "@/lib/admin-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ── Download button ───────────────────────────────────────────────────────────

function DownloadButton({ url, fileName, fileSize, audience }: {
  url: string; fileName: string; fileSize: number; audience: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleDownload() {
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch(url, { credentials: "include", headers: { Accept: "*/*" } });

      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (res.status === 403) {
        setErrorMsg("You don't have permission to download this file. Please sign in.");
        setState("error");
        return;
      }
      if (!res.ok) {
        setErrorMsg("Download failed. Please try again.");
        setState("error");
        return;
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
      setState("idle");
    } catch {
      setErrorMsg("A network error occurred. Please try again.");
      setState("error");
    }
  }

  const sizeLabel = fileSize > 0 ? `(${formatBytes(fileSize)})` : "";
  const isRestricted = audience !== "public" && audience !== "all";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        onClick={handleDownload}
        disabled={state === "loading"}
        className="primary-button"
        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
        aria-label={`Download ${fileName}`}
      >
        {state === "loading" ? (
          <><Loader2 size={15} className="spin" aria-hidden="true" /> Preparing…</>
        ) : (
          <>
            <Download size={15} aria-hidden="true" />
            Download
            {sizeLabel && <span style={{ opacity: 0.7, fontSize: ".78em" }}>{sizeLabel}</span>}
            {isRestricted && <Lock size={11} style={{ opacity: 0.45, marginLeft: 1 }} aria-hidden="true" />}
          </>
        )}
      </button>
      {state === "error" && (
        <p style={{ margin: 0, fontSize: ".78rem", color: "#991b1b", display: "flex", alignItems: "center", gap: 5 }} role="alert">
          {errorMsg}
          <button onClick={() => setState("idle")}
            style={{ border: "none", background: "none", cursor: "pointer", color: "#991b1b", padding: 0, fontWeight: 700, fontSize: ".78rem" }}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SoftwarePage() {
  const [software, setSoftware] = useState<Software[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    // Fetch with credentials so the backend can apply audience filtering
    // based on the logged-in user's role (students see student software,
    // staff see staff software, visitors only see public items).
    fetch("/api/v1/software/", { credentials: "include", cache: "no-store" })
      .then((r) => r.ok ? r.json() : [])
      .then((data: Software[]) => setSoftware(Array.isArray(data) ? data : []))
      .catch(() => setSoftware([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <SiteHeader />
      <main className="catalog-page shell page-enter">
        <header>
          <p className="eyebrow">Approved resources</p>
          <h1>Software catalogue</h1>
          <p>Installation resources approved for IIC students and staff.</p>
        </header>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "60px 0", color: "var(--muted)" }}>
            <Loader2 size={22} className="spin" aria-hidden="true" />
            Loading software catalogue…
          </div>
        ) : software.length === 0 ? (
          <div className="catalog-empty">
            <MonitorSmartphone aria-hidden="true" />
            <h2>No software published yet</h2>
            <p>Active, approved resources will appear here.</p>
          </div>
        ) : (
          <div className="software-list">
            {software.map((item) => {
              const hasHostedFile  = Boolean(item.file_url);
              const hasExternalUrl = Boolean(item.download_url);
              const hasDownload    = hasHostedFile || hasExternalUrl;

              return (
                <article key={item.id}>
                  <span className="software-icon">
                    <MonitorSmartphone aria-hidden="true" />
                  </span>

                  <div style={{ flex: 1 }}>
                    <h2>
                      {item.name}
                      {item.version && <small>{item.version}</small>}
                    </h2>
                    <p>{item.description}</p>
                    <div className="catalog-meta">
                      <span>{item.platforms.join(" · ")}</span>
                      <span>{item.audience}</span>
                      {hasHostedFile && (item.file_size ?? 0) > 0 && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "#dcfce7", color: "#166534",
                          borderRadius: 999, padding: "1px 8px",
                          fontSize: ".72rem", fontWeight: 800,
                        }}>
                          {formatBytes(item.file_size ?? 0)} · Hosted
                        </span>
                      )}
                    </div>
                    {item.licence_notes && (
                      <p className="licence-note">{item.licence_notes}</p>
                    )}
                  </div>

                  {/* Download / link buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>

                    {/* Hosted file — gated, streams through fetch */}
                    {hasHostedFile && item.file_url && (
                      <DownloadButton
                        url={item.file_url}
                        fileName={item.file_name ?? item.name}
                        fileSize={item.file_size ?? 0}
                        audience={item.audience}
                      />
                    )}

                    {/* External URL */}
                    {hasExternalUrl && (
                      <a
                        className={hasHostedFile ? "secondary-button" : "primary-button"}
                        href={item.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                        {hasHostedFile ? "Official site" : "Open download"}
                      </a>
                    )}

                    {!hasDownload && (
                      <span className="status-chip draft">Link pending</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
