import type { Metadata } from "next";
import { ExternalLink, MonitorSmartphone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { getSoftware } from "@/lib/content";
import { SoftwareDownloadButton } from "./download-button";

export const metadata: Metadata = {
  title: "Software Catalogue",
  description: "Download links and installation guides for software approved for IIC students and staff — Microsoft Office, antivirus, VPN, and more.",
  openGraph: {
    title:       "Software Catalogue · IIC IT & NOC Helpdesk",
    description: "Approved software downloads and installation resources for Itahari International College.",
    url:         "/software",
  },
  alternates: { canonical: "/software" },
};

// ── Byte formatter ─────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ── Page (server component) ────────────────────────────────────────────────────

export default async function SoftwarePage() {
  const software = await getSoftware();
  return (
    <>
      <SiteHeader />
      <main className="catalog-page shell page-enter">
        <header>
          <p className="eyebrow">Approved resources</p>
          <h1>Software catalogue</h1>
          <p>Installation resources approved for IIC students and staff.</p>
        </header>
        {software.length ? (
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
                      {hasHostedFile && item.file_size > 0 && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "#dcfce7", color: "#166534",
                          borderRadius: 999, padding: "1px 8px",
                          fontSize: ".72rem", fontWeight: 800,
                        }}>
                          {formatBytes(item.file_size)} · Hosted
                        </span>
                      )}
                    </div>
                    {item.licence_notes && (
                      <p className="licence-note">{item.licence_notes}</p>
                    )}
                  </div>

                  {/* Download / link buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>

                    {/* Hosted file — gated download (session cookie required for non-public) */}
                    {hasHostedFile && (
                      <SoftwareDownloadButton
                        url={item.file_url!}
                        fileName={item.file_name ?? item.name}
                        fileSize={item.file_size}
                        audience={item.audience}
                      />
                    )}

                    {/* External URL — fallback or secondary */}
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
        ) : (
          <div className="catalog-empty">
            <MonitorSmartphone aria-hidden="true" />
            <h2>No software published yet</h2>
            <p>Active, approved resources will appear here.</p>
          </div>
        )}
      </main>
    </>
  );
}
