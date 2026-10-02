"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight, CheckCircle2, Clock, Eye, EyeOff, KeyRound,
  Loader2, Mail, Save, ShieldAlert, Ticket, User, XCircle,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken, type AuthUser } from "@/lib/auth";
import { staggerContainer, fadeUp } from "@/lib/animations";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProfileData {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  programme: string;
  department: string;
  email_verified: boolean;
  avatar_url: string;
}

interface TicketSummary {
  total: number;
  open: number;
  resolved: number;
  closed: number;
  cancelled: number;
  latest: { id: string; reference: string; subject: string; status: string; created_at: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string, username: string) {
  const v = name || username;
  return v.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

const STATUS_OPEN = new Set(["submitted", "triaged", "in_progress"]);

function buildSummary(tickets: { id: string; reference: string; subject: string; status: string; created_at: string }[]): TicketSummary {
  let open = 0, resolved = 0, closed = 0, cancelled = 0;
  for (const t of tickets) {
    if (STATUS_OPEN.has(t.status)) open++;
    else if (t.status === "resolved") resolved++;
    else if (t.status === "closed") closed++;
    else if (t.status === "cancelled") cancelled++;
  }
  const latest = tickets.length > 0
    ? tickets.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b)
    : null;
  return { total: tickets.length, open, resolved, closed, cancelled, latest };
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted", triaged: "Triaged", in_progress: "In progress",
  resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};
const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  submitted:   { bg: "#eff6ff", color: "#1d4ed8" },
  triaged:     { bg: "#f0f9ff", color: "#0369a1" },
  in_progress: { bg: "#fef9c3", color: "#854d0e" },
  resolved:    { bg: "#f0fdf4", color: "#15803d" },
  closed:      { bg: "#f8fafc", color: "#475569" },
  cancelled:   { bg: "#fef2f2", color: "#b91c1c" },
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ value, label, icon, bg, color }: {
  value: number; label: string; icon: React.ReactNode; bg: string; color: string;
}) {
  return (
    <div className="profile-stat-card" style={{ background: bg, borderColor: `color-mix(in srgb, ${color} 22%, transparent)` }}>
      <div className="profile-stat-icon" style={{ background: color }}>{icon}</div>
      <div>
        <div className="profile-stat-value" style={{ color }}>{value}</div>
        <div className="profile-stat-label">{label}</div>
      </div>
    </div>
  );
}

// ── Email verification banner ─────────────────────────────────────────────────

function EmailVerificationBanner({ email, onVerified }: { email: string; onVerified: () => void }) {
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [sendError, setSendError] = useState("");

  async function resend() {
    setSending(true); setSendError("");
    try {
      const token = await csrfToken();
      const res = await fetch("/api/v1/auth/resend-verification/", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const d = await res.json().catch(() => ({})) as { detail?: string };
        setSendError(d.detail ?? "Could not send verification email.");
      }
    } catch {
      setSendError("A network error occurred.");
    } finally {
      setSending(false);
    }
  }

  return (
    <motion.div
      className="profile-verify-banner"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="profile-verify-banner-icon">
        <ShieldAlert size={22} aria-hidden="true" />
      </div>
      <div className="profile-verify-banner-body">
        <p className="profile-verify-banner-title">Email address not verified</p>
        <p className="profile-verify-banner-desc">
          Your account is active but your email <strong>{email}</strong> has not been verified.
          Some features may be restricted until you verify your address.
        </p>
        {sent ? (
          <p className="profile-verify-sent">
            <CheckCircle2 size={14} aria-hidden="true" />
            Verification email sent — check your inbox and spam folder.
          </p>
        ) : (
          <div className="profile-verify-actions">
            <button
              type="button"
              className="profile-verify-btn"
              onClick={resend}
              disabled={sending}
            >
              {sending
                ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Sending…</>
                : <><Mail size={13} aria-hidden="true" /> Resend verification email</>}
            </button>
            {sendError && (
              <span className="profile-verify-error">{sendError}</span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();

  const [authChecked,    setAuthChecked]    = useState(false);
  const [profile,        setProfile]        = useState<ProfileData | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [profileNotice,  setProfileNotice]  = useState("");
  const [profileError,   setProfileError]   = useState("");
  const [savingProfile,  setSavingProfile]  = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [pwNotice,  setPwNotice]  = useState("");
  const [pwError,   setPwError]   = useState<Record<string, string>>({});
  const [savingPw,  setSavingPw]  = useState(false);

  const [tab,            setTab]            = useState<"details" | "security" | "tickets">("details");
  const [imgError,       setImgError]       = useState(false);
  const [ticketSummary,  setTicketSummary]  = useState<TicketSummary | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AuthUser | null) => {
        if (!d?.id) { router.replace("/login"); return; }
        setAuthChecked(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  // ── Load profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked) return;
    fetch("/api/v1/auth/profile/", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProfileData | null) => { if (d) setProfile(d); })
      .finally(() => setLoading(false));
  }, [authChecked]);

  // ── Load tickets on tab open ──────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "tickets" || ticketSummary !== null) return;
    setTicketsLoading(true);
    fetch("/api/v1/tickets/?page_size=200", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { results?: unknown[] } | null) => {
        const list = (d?.results ?? []) as { id: string; reference: string; subject: string; status: string; created_at: string }[];
        setTicketSummary(buildSummary(list));
      })
      .catch(() => setTicketSummary(buildSummary([])))
      .finally(() => setTicketsLoading(false));
  }, [tab, ticketSummary]);

  // ── Save profile ──────────────────────────────────────────────────────────
  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true); setProfileError(""); setProfileNotice("");
    const form = new FormData(e.currentTarget);
    try {
      const token = await csrfToken();
      const res = await fetch("/api/v1/auth/profile/", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({
          first_name: form.get("first_name"), last_name: form.get("last_name"),
          programme: form.get("programme"),   department: form.get("department"),
        }),
      });
      const data = await res.json().catch(() => ({})) as ProfileData & { detail?: string };
      if (!res.ok) { setProfileError(data.detail ?? "Could not save profile."); }
      else { setProfile(data); setProfileNotice("Profile updated."); }
    } catch { setProfileError("A network error occurred."); }
    finally { setSavingProfile(false); }
  }

  // ── Change password ───────────────────────────────────────────────────────
  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwError({}); setPwNotice("");
    if (newPw !== confirmPw) { setPwError({ confirm_password: "Passwords do not match." }); return; }
    setSavingPw(true);
    try {
      const token = await csrfToken();
      const res = await fetch("/api/v1/auth/change-password/", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw, confirm_password: confirmPw }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) errs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        setPwError(Object.keys(errs).length ? errs : { _: "Password change failed." });
      } else {
        setPwNotice("Password changed successfully.");
        setCurrentPw(""); setNewPw(""); setConfirmPw("");
      }
    } catch { setPwError({ _: "A network error occurred." }); }
    finally { setSavingPw(false); }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading || !profile) {
    return (
      <>
        <SiteHeader />
        <main className="shell" style={{ paddingBlock: "80px", display: "flex", justifyContent: "center" }}>
          <Loader2 className="spin" size={32} style={{ color: "var(--brand)" }} aria-label="Loading profile" />
        </main>
      </>
    );
  }

  const fullName    = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.username;
  const avatarText  = initials(fullName, profile.username);
  const showPicture = !!profile.avatar_url && !imgError;

  return (
    <>
      <SiteHeader />
      <div className="profile-page">

        {/* ── Hero banner ── */}
        <div className="profile-hero">
          <div className="shell profile-hero-inner">

            {/* Avatar */}
            <div className="profile-avatar-wrap">
              {showPicture ? (
                <img src={profile.avatar_url} alt={fullName} onError={() => setImgError(true)}
                  className="profile-avatar-img" />
              ) : (
                <div className="profile-avatar-initials" aria-hidden="true">
                  {avatarText || <User size={36} />}
                </div>
              )}
              {/* Verified ring */}
              {profile.email_verified && (
                <span className="profile-avatar-verified" title="Email verified" aria-label="Email verified">
                  <CheckCircle2 size={14} />
                </span>
              )}
            </div>

            {/* Identity */}
            <div className="profile-hero-identity">
              <h1 className="profile-hero-name">{fullName}</h1>
              <p className="profile-hero-meta">
                <span>@{profile.username}</span>
                <span className="profile-hero-dot" aria-hidden="true">·</span>
                <span>{profile.email}</span>
                {(profile.programme || profile.department) && (
                  <>
                    <span className="profile-hero-dot" aria-hidden="true">·</span>
                    <span>{profile.programme || profile.department}</span>
                  </>
                )}
              </p>

              {/* Email status badge */}
              {profile.email_verified ? (
                <span className="profile-badge profile-badge--verified">
                  <CheckCircle2 size={12} aria-hidden="true" /> Email verified
                </span>
              ) : (
                <span className="profile-badge profile-badge--unverified">
                  <ShieldAlert size={12} aria-hidden="true" /> Email not verified
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="shell profile-body">

          {/* ── Email verification banner ── */}
          {!profile.email_verified && (
            <div style={{ marginBottom: 28 }}>
              <EmailVerificationBanner email={profile.email} onVerified={() => setProfile((p) => p ? { ...p, email_verified: true } : p)} />
            </div>
          )}

          {/* ── Tab bar ── */}
          <motion.div variants={fadeUp} initial="hidden" animate="show"
            className="svc-tab-bar profile-tab-bar">
            {(
              [
                { key: "details"  as const, label: "Profile details", icon: <User     size={14} aria-hidden="true" /> },
                { key: "security" as const, label: "Security",        icon: <KeyRound size={14} aria-hidden="true" /> },
                { key: "tickets"  as const, label: "My tickets",      icon: <Ticket   size={14} aria-hidden="true" /> },
              ]
            ).map((t) => (
              <button key={t.key} className={`svc-tab${tab === t.key ? " active" : ""}`}
                onClick={() => setTab(t.key)}>
                {t.icon} {t.label}
              </button>
            ))}
          </motion.div>

          {/* ── Tab content ── */}
          <AnimatePresence mode="wait">

            {/* ── Details ── */}
            {tab === "details" && (
              <motion.div key="details"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}
                className="profile-tab-content">

                <AnimatePresence mode="wait">
                  {profileNotice && (
                    <motion.p key="n" className="admin-notice" role="status"
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 7 }}>
                      <CheckCircle2 size={15} aria-hidden="true" /> {profileNotice}
                    </motion.p>
                  )}
                  {profileError && (
                    <motion.p key="e" className="admin-error" role="alert"
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      style={{ marginBottom: 20 }}>
                      {profileError}
                    </motion.p>
                  )}
                </AnimatePresence>

                <div className="profile-form-card">
                  <div className="profile-form-card-header">
                    <User size={16} aria-hidden="true" />
                    <h2>Personal information</h2>
                  </div>
                  <form onSubmit={saveProfile} className="profile-form">
                    <div className="profile-form-row">
                      <div className="profile-form-field">
                        <label htmlFor="pf-first">First name</label>
                        <input id="pf-first" name="first_name" defaultValue={profile.first_name} maxLength={150} placeholder="First name" />
                      </div>
                      <div className="profile-form-field">
                        <label htmlFor="pf-last">Last name</label>
                        <input id="pf-last" name="last_name" defaultValue={profile.last_name} maxLength={150} placeholder="Last name" />
                      </div>
                    </div>

                    <div className="profile-form-field profile-form-field--readonly">
                      <label>Username <span className="profile-readonly-note">(cannot be changed)</span></label>
                      <input value={profile.username} disabled readOnly />
                    </div>

                    <div className="profile-form-field profile-form-field--readonly">
                      <label>College email <span className="profile-readonly-note">(cannot be changed)</span></label>
                      <div className="profile-email-row">
                        <input value={profile.email} disabled readOnly style={{ flex: 1 }} />
                        {profile.email_verified
                          ? <span className="profile-email-status profile-email-status--ok"><CheckCircle2 size={13} /> Verified</span>
                          : <span className="profile-email-status profile-email-status--warn"><ShieldAlert size={13} /> Not verified</span>
                        }
                      </div>
                    </div>

                    <div className="profile-form-row">
                      <div className="profile-form-field">
                        <label htmlFor="pf-prog">Programme</label>
                        <input id="pf-prog" name="programme" defaultValue={profile.programme} maxLength={200} placeholder="e.g. BCA, BIT, BBA" />
                      </div>
                      <div className="profile-form-field">
                        <label htmlFor="pf-dept">Department</label>
                        <input id="pf-dept" name="department" defaultValue={profile.department} maxLength={200} placeholder="e.g. IT Department" />
                      </div>
                    </div>

                    <div className="profile-form-footer">
                      <button className="primary-button" type="submit" disabled={savingProfile}
                        style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {savingProfile
                          ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Saving…</>
                          : <><Save size={15} aria-hidden="true" /> Save changes</>}
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}

            {/* ── Security ── */}
            {tab === "security" && (
              <motion.div key="security"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}
                className="profile-tab-content">

                <div className="profile-form-card">
                  <div className="profile-form-card-header">
                    <KeyRound size={16} aria-hidden="true" />
                    <h2>Change password</h2>
                  </div>
                  <div className="profile-form" style={{ paddingTop: 0 }}>
                    <p style={{ margin: "0 0 20px", color: "var(--muted)", fontSize: ".9rem" }}>
                      Enter your current password to set a new one.
                    </p>

                    <AnimatePresence mode="wait">
                      {pwNotice && (
                        <motion.p key="n" className="admin-notice" role="status"
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                          style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 7 }}>
                          <CheckCircle2 size={15} aria-hidden="true" /> {pwNotice}
                        </motion.p>
                      )}
                      {pwError._ && (
                        <motion.p key="e" className="auth-error" role="alert"
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                          style={{ marginBottom: 20 }}>
                          {pwError._}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      <div className="profile-form-field">
                        <label htmlFor="pw-current">Current password</label>
                        <div className="profile-pw-wrap">
                          <input id="pw-current" type={showPw ? "text" : "password"} value={currentPw}
                            onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" required />
                          <button type="button" className="profile-pw-eye" onClick={() => setShowPw((v) => !v)}
                            aria-label={showPw ? "Hide passwords" : "Show passwords"}>
                            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        {pwError.detail && <span className="field-error" role="alert">{pwError.detail}</span>}
                      </div>

                      <div className="profile-form-row">
                        <div className="profile-form-field">
                          <label htmlFor="pw-new">New password</label>
                          <div className="profile-pw-wrap">
                            <input id="pw-new" type={showPw ? "text" : "password"} value={newPw}
                              onChange={(e) => setNewPw(e.target.value)} minLength={8} autoComplete="new-password" required />
                          </div>
                          {pwError.new_password && <span className="field-error" role="alert">{pwError.new_password}</span>}
                        </div>
                        <div className="profile-form-field">
                          <label htmlFor="pw-confirm">Confirm new password</label>
                          <div className="profile-pw-wrap">
                            <input id="pw-confirm" type={showPw ? "text" : "password"} value={confirmPw}
                              onChange={(e) => setConfirmPw(e.target.value)} minLength={8} autoComplete="new-password" required />
                          </div>
                          {pwError.confirm_password && <span className="field-error" role="alert">{pwError.confirm_password}</span>}
                        </div>
                      </div>

                      <div className="profile-form-footer">
                        <button className="primary-button" type="submit" disabled={savingPw}
                          style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {savingPw
                            ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Saving…</>
                            : <><KeyRound size={15} aria-hidden="true" /> Change password</>}
                        </button>
                        <a href="/forgot-password" style={{ fontSize: ".85rem", color: "var(--brand)", fontWeight: 700 }}>
                          Forgot password?
                        </a>
                      </div>
                    </form>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Tickets ── */}
            {tab === "tickets" && (
              <motion.div key="tickets"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}
                className="profile-tab-content">

                {ticketsLoading || !ticketSummary ? (
                  <div style={{ display: "flex", justifyContent: "center", paddingBlock: 56 }}>
                    <Loader2 size={28} className="spin" style={{ color: "var(--brand)" }} aria-label="Loading tickets" />
                  </div>
                ) : (
                  <motion.div variants={staggerContainer} initial="hidden" animate="show" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                    {/* Stat grid */}
                    <motion.div variants={fadeUp} className="profile-stat-grid">
                      <StatCard value={ticketSummary.total}     label="Total"     icon={<Ticket       size={16} />} bg="#f8fafc" color="#334155" />
                      <StatCard value={ticketSummary.open}      label="Open"      icon={<Clock        size={16} />} bg="#eff6ff" color="#1d4ed8" />
                      <StatCard value={ticketSummary.resolved}  label="Resolved"  icon={<CheckCircle2 size={16} />} bg="#f0fdf4" color="#15803d" />
                      <StatCard value={ticketSummary.closed}    label="Closed"    icon={<CheckCircle2 size={16} />} bg="#f8fafc" color="#475569" />
                      <StatCard value={ticketSummary.cancelled} label="Cancelled" icon={<XCircle      size={16} />} bg="#fef2f2" color="#b91c1c" />
                    </motion.div>

                    {/* Latest ticket */}
                    {ticketSummary.latest && (
                      <motion.div variants={fadeUp}>
                        <p className="profile-section-eyebrow">Most recent ticket</p>
                        <a href={`/tickets/${ticketSummary.latest.id}`} className="profile-latest-ticket">
                          <div className="profile-latest-ticket-icon">
                            <Ticket size={17} aria-hidden="true" />
                          </div>
                          <div className="profile-latest-ticket-body">
                            <span className="profile-latest-ticket-subject">{ticketSummary.latest.subject}</span>
                            <span className="profile-latest-ticket-meta">
                              {ticketSummary.latest.reference} ·{" "}
                              {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" })
                                .format(new Date(ticketSummary.latest.created_at))}
                            </span>
                          </div>
                          <span className="profile-latest-ticket-status" style={{
                            background: STATUS_COLOR[ticketSummary.latest.status]?.bg ?? "#f1f5f9",
                            color:      STATUS_COLOR[ticketSummary.latest.status]?.color ?? "#475569",
                          }}>
                            {STATUS_LABEL[ticketSummary.latest.status] ?? ticketSummary.latest.status}
                          </span>
                          <ArrowRight size={15} style={{ color: "var(--muted)", flexShrink: 0 }} aria-hidden="true" />
                        </a>
                      </motion.div>
                    )}

                    {/* Empty state */}
                    {ticketSummary.total === 0 && (
                      <motion.div variants={fadeUp} className="profile-tickets-empty">
                        <Ticket size={34} aria-hidden="true" />
                        <p>No support tickets yet</p>
                        <span>Submit a request and it will appear here.</span>
                        <a href="/" className="primary-button" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: ".88rem" }}>
                          Browse services
                        </a>
                      </motion.div>
                    )}

                    {/* View all */}
                    {ticketSummary.total > 0 && (
                      <motion.div variants={fadeUp} style={{ textAlign: "right" }}>
                        <a href="/tickets" style={{ color: "var(--brand)", fontWeight: 750, fontSize: ".88rem" }}>
                          View all {ticketSummary.total} ticket{ticketSummary.total !== 1 ? "s" : ""} →
                        </a>
                      </motion.div>
                    )}

                  </motion.div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
