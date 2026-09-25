"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle2, Clock, Eye, EyeOff, KeyRound, Loader2,
  Save, Ticket, User, XCircle,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken, type AuthUser } from "@/lib/auth";
import { staggerContainer, staggerItem, fadeUp } from "@/lib/animations";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  open: number;       // submitted | triaged | in_progress
  resolved: number;
  closed: number;
  cancelled: number;
  latest: { id: string; reference: string; subject: string; status: string; created_at: string } | null;
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function initials(name: string, username: string) {
  const v = name || username;
  return v.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

const STATUS_OPEN = new Set(["submitted", "triaged", "in_progress"]);

function buildSummary(tickets: { id: string; reference: string; subject: string; status: string; created_at: string }[]): TicketSummary {
  let open = 0, resolved = 0, closed = 0, cancelled = 0;
  for (const t of tickets) {
    if (STATUS_OPEN.has(t.status))    open++;
    else if (t.status === "resolved") resolved++;
    else if (t.status === "closed")   closed++;
    else if (t.status === "cancelled") cancelled++;
  }
  const latest = tickets.length > 0
    ? tickets.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b)
    : null;
  return { total: tickets.length, open, resolved, closed, cancelled, latest };
}

const STATUS_LABEL: Record<string, string> = {
  submitted:   "Submitted",
  triaged:     "Triaged",
  in_progress: "In progress",
  resolved:    "Resolved",
  closed:      "Closed",
  cancelled:   "Cancelled",
};

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  submitted:   { bg: "#eff6ff", color: "#1d4ed8" },
  triaged:     { bg: "#f0f9ff", color: "#0369a1" },
  in_progress: { bg: "#fef9c3", color: "#854d0e" },
  resolved:    { bg: "#f0fdf4", color: "#15803d" },
  closed:      { bg: "#f8fafc", color: "#475569" },
  cancelled:   { bg: "#fef2f2", color: "#b91c1c" },
};

// â”€â”€ Ticket stat card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StatCard({
  value, label, icon, bg, color,
}: { value: number; label: string; icon: React.ReactNode; bg: string; color: string }) {
  return (
    <motion.div
      variants={fadeUp}
      style={{
        background: bg, borderRadius: 14, padding: "16px 18px",
        display: "flex", alignItems: "center", gap: 14,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 11, background: color,
        display: "grid", placeItems: "center", flexShrink: 0, opacity: 0.9,
      }}>
        <span style={{ color: "#fff" }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontSize: "1.6rem", fontWeight: 900, lineHeight: 1, color }}>{value}</div>
        <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--muted)", marginTop: 2 }}>{label}</div>
      </div>
    </motion.div>
  );
}

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ProfilePage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [profile,        setProfile]        = useState<ProfileData | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [profileNotice,  setProfileNotice]  = useState("");
  const [profileError,   setProfileError]   = useState("");
  const [savingProfile,  setSavingProfile]  = useState(false);

  const [currentPw,  setCurrentPw]  = useState("");
  const [newPw,      setNewPw]      = useState("");
  const [confirmPw,  setConfirmPw]  = useState("");
  const [showPw,     setShowPw]     = useState(false);
  const [pwNotice,   setPwNotice]   = useState("");
  const [pwError,    setPwError]    = useState<Record<string, string>>({});
  const [savingPw,   setSavingPw]   = useState(false);

  const [tab, setTab] = useState<"details" | "security" | "tickets">("details");

  const [imgError,       setImgError]       = useState(false);
  const [ticketSummary,  setTicketSummary]  = useState<TicketSummary | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  // â”€â”€ Auth check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthUser | null) => {
        if (!data?.id) { router.replace("/login"); return; }
        setAuthChecked(true);
      })
      .catch(() => { router.replace("/login"); });
  }, [router]);

  // â”€â”€ Load profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!authChecked) return;
    fetch("/api/v1/auth/profile/", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProfileData | null) => { if (d) setProfile(d); })
      .finally(() => setLoading(false));
  }, [authChecked]);

  // â”€â”€ Load tickets when tab opens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Save profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    setProfileError(""); setProfileNotice("");
    const form = new FormData(e.currentTarget);
    try {
      const token = await csrfToken();
      const res   = await fetch("/api/v1/auth/profile/", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({
          first_name:  form.get("first_name"),
          last_name:   form.get("last_name"),
          programme:   form.get("programme"),
          department:  form.get("department"),
        }),
      });
      const data = await res.json().catch(() => ({})) as ProfileData & { detail?: string };
      if (!res.ok) {
        setProfileError(data.detail ?? "Could not save profile.");
      } else {
        setProfile(data);
        setProfileNotice("Profile updated.");
      }
    } catch {
      setProfileError("A network error occurred.");
    } finally {
      setSavingProfile(false);
    }
  }

  // â”€â”€ Change password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwError({}); setPwNotice("");
    if (newPw !== confirmPw) {
      setPwError({ confirm_password: "Passwords do not match." }); return;
    }
    setSavingPw(true);
    try {
      const token = await csrfToken();
      const res   = await fetch("/api/v1/auth/change-password/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({
          current_password:  currentPw,
          new_password:      newPw,
          confirm_password:  confirmPw,
        }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          errs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        }
        setPwError(Object.keys(errs).length ? errs : { _: "Password change failed." });
      } else {
        setPwNotice("Password changed successfully.");
        setCurrentPw(""); setNewPw(""); setConfirmPw("");
      }
    } catch {
      setPwError({ _: "A network error occurred." });
    } finally {
      setSavingPw(false);
    }
  }

  // â”€â”€ Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (loading || !profile) {
    return (
      <>
        <SiteHeader />
        <main className="shell" style={{ paddingBlock: "60px 80px", display: "flex", justifyContent: "center" }}>
          <Loader2 className="spin" size={32} style={{ color: "var(--brand)" }} aria-label="Loading profile" />
        </main>
      </>
    );
  }

  const fullName    = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.username;
  const avatar      = initials(fullName, profile.username);
  const showPicture = !!profile.avatar_url && !imgError;

  return (
    <>
      <SiteHeader />
      <motion.main
        className="shell"
        style={{ paddingBlock: "48px 80px" }}
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {/* â”€â”€ Hero strip â”€â”€ */}
        <motion.div variants={fadeUp} style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 36 }}>
          {showPicture ? (
            <img
              src={profile.avatar_url}
              alt={fullName}
              onError={() => setImgError(true)}
              style={{
                width: 72, height: 72, borderRadius: 18,
                objectFit: "cover", flexShrink: 0,
                border: "2px solid var(--border)",
              }}
            />
          ) : (
            <div style={{
              width: 72, height: 72, borderRadius: 18,
              background: "linear-gradient(145deg,#254798,#183474)",
              color: "#fff", fontSize: "1.5rem", fontWeight: 900,
              display: "grid", placeItems: "center", flexShrink: 0,
            }}>
              {avatar || <User size={32} aria-hidden="true" />}
            </div>
          )}
          <div>
            <h1 style={{ margin: 0, fontSize: "clamp(1.6rem,3vw,2.4rem)", letterSpacing: "-.03em" }}>
              {fullName}
            </h1>
            <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: ".9rem" }}>
              @{profile.username} Â· {profile.email}
              {!profile.email_verified && (
                <span style={{
                  marginLeft: 10, fontSize: ".75rem", fontWeight: 700,
                  background: "#fef3c7", color: "#92400e",
                  borderRadius: 999, padding: "2px 8px",
                }}>
                  Email not verified
                </span>
              )}
            </p>
          </div>
        </motion.div>

        {/* â”€â”€ Tab bar â”€â”€ */}
        <motion.div variants={fadeUp} className="svc-tab-bar" style={{ marginBottom: 28 }}>
          <button className={`svc-tab${tab === "details"  ? " active" : ""}`} onClick={() => setTab("details")}>
            <User size={14} aria-hidden="true" /> Profile details
          </button>
          <button className={`svc-tab${tab === "security" ? " active" : ""}`} onClick={() => setTab("security")}>
            <KeyRound size={14} aria-hidden="true" /> Security
          </button>
          <button className={`svc-tab${tab === "tickets"  ? " active" : ""}`} onClick={() => setTab("tickets")}>
            <Ticket size={14} aria-hidden="true" /> My tickets
          </button>
        </motion.div>

        {/* â”€â”€ Tab content â”€â”€ */}
        <AnimatePresence mode="wait">

          {/* â”€â”€ Details â”€â”€ */}
          {tab === "details" && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}
              style={{ maxWidth: 640 }}
            >
              <AnimatePresence mode="wait">
                {profileNotice && (
                  <motion.p key="n" className="admin-notice" role="status"
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{ marginBottom: 20 }}>
                    <CheckCircle2 size={15} aria-hidden="true" style={{ marginRight: 6 }} />
                    {profileNotice}
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

              <form onSubmit={saveProfile} className="auth-form two-column">
                <label>
                  First name
                  <input name="first_name" defaultValue={profile.first_name} maxLength={150} />
                </label>
                <label>
                  Last name
                  <input name="last_name" defaultValue={profile.last_name} maxLength={150} />
                </label>
                <label className="full-field" style={{ opacity: 0.65 }}>
                  Username <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".82rem" }}>(cannot be changed)</span>
                  <input value={profile.username} disabled readOnly />
                </label>
                <label className="full-field" style={{ opacity: 0.65 }}>
                  College email <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".82rem" }}>(cannot be changed)</span>
                  <input value={profile.email} disabled readOnly />
                </label>
                <label>
                  Programme
                  <input name="programme" defaultValue={profile.programme} maxLength={200} placeholder="e.g. BCA, BIT, BBA" />
                </label>
                <label>
                  Department
                  <input name="department" defaultValue={profile.department} maxLength={200} placeholder="e.g. IT Department" />
                </label>
                <button className="primary-button full-field" type="submit" disabled={savingProfile}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {savingProfile
                    ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Savingâ€¦</>
                    : <><Save size={15} aria-hidden="true" /> Save changes</>}
                </button>
              </form>
            </motion.div>
          )}

          {/* â”€â”€ Security â”€â”€ */}
          {tab === "security" && (
            <motion.div
              key="security"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}
              style={{ maxWidth: 480 }}
            >
              <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>Change password</h2>
              <p style={{ color: "var(--muted)", fontSize: ".9rem", marginBottom: 22 }}>
                You must enter your current password to set a new one.
              </p>

              <AnimatePresence mode="wait">
                {pwNotice && (
                  <motion.p key="n" className="admin-notice" role="status"
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{ marginBottom: 20 }}>
                    <CheckCircle2 size={15} aria-hidden="true" style={{ marginRight: 6 }} />
                    {pwNotice}
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

              <form onSubmit={changePassword} className="auth-form">
                <label>
                  Current password
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPw ? "text" : "password"}
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      autoComplete="current-password"
                      required
                      style={{ paddingRight: 40 }}
                    />
                    <button type="button" onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? "Hide passwords" : "Show passwords"}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)", display: "flex", padding: 4 }}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {pwError.detail && <span className="field-error" role="alert">{pwError.detail}</span>}
                </label>
                <label>
                  New password
                  <input type={showPw ? "text" : "password"} value={newPw}
                    onChange={(e) => setNewPw(e.target.value)} minLength={8} autoComplete="new-password" required />
                  {pwError.new_password && <span className="field-error" role="alert">{pwError.new_password}</span>}
                </label>
                <label>
                  Confirm new password
                  <input type={showPw ? "text" : "password"} value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)} minLength={8} autoComplete="new-password" required />
                  {pwError.confirm_password && <span className="field-error" role="alert">{pwError.confirm_password}</span>}
                </label>
                <button className="primary-button" type="submit" disabled={savingPw}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {savingPw
                    ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Savingâ€¦</>
                    : <><KeyRound size={15} aria-hidden="true" /> Change password</>}
                </button>
              </form>

              <p style={{ marginTop: 20, fontSize: ".85rem", color: "var(--muted)" }}>
                Forgot your current password?{" "}
                <a href="/forgot-password" style={{ color: "var(--brand)", fontWeight: 700 }}>
                  Reset it by email
                </a>
              </p>
            </motion.div>
          )}

          {/* â”€â”€ Tickets â”€â”€ */}
          {tab === "tickets" && (
            <motion.div
              key="tickets"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}
              style={{ maxWidth: 720 }}
            >
              {ticketsLoading || !ticketSummary ? (
                <div style={{ display: "flex", justifyContent: "center", paddingBlock: 48 }}>
                  <Loader2 size={28} className="spin" style={{ color: "var(--brand)" }} aria-label="Loading tickets" />
                </div>
              ) : (
                <motion.div variants={staggerContainer} initial="hidden" animate="show">

                  {/* â”€â”€ Stat grid â”€â”€ */}
                  <motion.div variants={fadeUp} style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                    gap: 12, marginBottom: 28,
                  }}>
                    <StatCard value={ticketSummary.total}     label="Total tickets"  icon={<Ticket     size={18} />} bg="#f8fafc" color="#334155" />
                    <StatCard value={ticketSummary.open}      label="Open"           icon={<Clock      size={18} />} bg="#eff6ff" color="#1d4ed8" />
                    <StatCard value={ticketSummary.resolved}  label="Resolved"       icon={<CheckCircle2 size={18} />} bg="#f0fdf4" color="#15803d" />
                    <StatCard value={ticketSummary.closed}    label="Closed"         icon={<CheckCircle2 size={18} />} bg="#f8fafc" color="#475569" />
                    <StatCard value={ticketSummary.cancelled} label="Cancelled"      icon={<XCircle    size={18} />} bg="#fef2f2" color="#b91c1c" />
                  </motion.div>

                  {/* â”€â”€ Latest ticket â”€â”€ */}
                  {ticketSummary.latest && (
                    <motion.div variants={fadeUp}>
                      <h3 style={{ fontSize: ".78rem", fontWeight: 800, textTransform: "uppercase",
                        letterSpacing: ".1em", color: "var(--muted)", marginBottom: 10 }}>
                        Most recent ticket
                      </h3>
                      <a
                        href={`/tickets/${ticketSummary.latest.id}`}
                        style={{
                          display: "flex", alignItems: "center", gap: 14,
                          background: "var(--surface)", border: "1px solid var(--border)",
                          borderRadius: 14, padding: "14px 18px",
                          textDecoration: "none", color: "inherit",
                          transition: "box-shadow 150ms, transform 150ms",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(15,23,42,.08)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                      >
                        <div style={{
                          width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                          background: "var(--brand-soft)", display: "grid", placeItems: "center",
                        }}>
                          <Ticket size={18} style={{ color: "var(--brand)" }} aria-hidden="true" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 750, fontSize: ".9rem",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {ticketSummary.latest.subject}
                          </div>
                          <div style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: 2 }}>
                            {ticketSummary.latest.reference} Â·{" "}
                            {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" })
                              .format(new Date(ticketSummary.latest.created_at))}
                          </div>
                        </div>
                        <span style={{
                          flexShrink: 0, fontSize: ".72rem", fontWeight: 800, borderRadius: 999,
                          padding: "3px 10px",
                          background: STATUS_COLOR[ticketSummary.latest.status]?.bg ?? "#f1f5f9",
                          color:      STATUS_COLOR[ticketSummary.latest.status]?.color ?? "#475569",
                        }}>
                          {STATUS_LABEL[ticketSummary.latest.status] ?? ticketSummary.latest.status}
                        </span>
                      </a>
                    </motion.div>
                  )}

                  {/* â”€â”€ Empty state â”€â”€ */}
                  {ticketSummary.total === 0 && (
                    <motion.div variants={fadeUp} style={{
                      textAlign: "center", padding: "40px 24px",
                      background: "var(--surface)", border: "1px dashed var(--border)",
                      borderRadius: 16,
                    }}>
                      <Ticket size={36} style={{ color: "var(--muted)", marginBottom: 12 }} aria-hidden="true" />
                      <p style={{ fontWeight: 700, marginBottom: 6 }}>No tickets yet</p>
                      <p style={{ color: "var(--muted)", fontSize: ".9rem", marginBottom: 20 }}>
                        Submit a support request and it will appear here.
                      </p>
                      <a href="/" className="primary-button" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: ".88rem" }}>
                        <Ticket size={14} aria-hidden="true" /> Browse services
                      </a>
                    </motion.div>
                  )}

                  {/* â”€â”€ View all link â”€â”€ */}
                  {ticketSummary.total > 0 && (
                    <motion.div variants={fadeUp} style={{ marginTop: 18, textAlign: "right" }}>
                      <a href="/my-tickets" style={{ color: "var(--brand)", fontWeight: 750, fontSize: ".88rem" }}>
                        View all {ticketSummary.total} ticket{ticketSummary.total !== 1 ? "s" : ""} â†’
                      </a>
                    </motion.div>
                  )}

                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.main>
    </>
  );
}
