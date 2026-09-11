"use client";

import { BookOpen, Boxes, CircleDot, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { adminGet, type AdminSummary } from "@/lib/admin-api";

export default function AdminOverview() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { adminGet<AdminSummary>("summary").then(setSummary).catch((reason) => setError(reason.message)); }, []);

  return (
    <div className="admin-content">
      <header className="admin-heading"><div><p className="eyebrow">Administration</p><h1>Helpdesk overview</h1><p>Manage published support content and monitor the current workspace.</p></div></header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {!summary ? <div className="admin-loading">Loading overview…</div> : <section className="metric-grid" aria-label="Helpdesk totals">
        <article><Users aria-hidden="true" /><span>Active users</span><strong>{summary.users}</strong></article>
        <article><CircleDot aria-hidden="true" /><span>Open tickets</span><strong>{summary.open_tickets}</strong><small>{summary.tickets} total</small></article>
        <article><BookOpen aria-hidden="true" /><span>Published guides</span><strong>{summary.published_guides}</strong><small>{summary.guides} total</small></article>
        <article><Boxes aria-hidden="true" /><span>Active software</span><strong>{summary.active_software}</strong><small>{summary.software} total</small></article>
      </section>}
      <section className="admin-actions"><h2>Content management</h2><div><Link href="/admin/guides"><BookOpen aria-hidden="true" /><span><strong>Guides</strong><small>Create, review, publish, or archive help articles.</small></span></Link><Link href="/admin/software"><Boxes aria-hidden="true" /><span><strong>Software catalogue</strong><small>Manage approved downloads, platforms, versions, and linked guides.</small></span></Link></div></section>
      <section className="admin-actions"><h2>Access management</h2><div><Link href="/admin/users"><Users aria-hidden="true" /><span><strong>Users and permissions</strong><small>Review accounts and manage staff, superuser, or active status.</small></span></Link></div></section>
    </div>
  );
}
