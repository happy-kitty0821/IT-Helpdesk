"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Save, User,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken, type AuthUser } from "@/lib/auth";
import { staggerContainer, staggerItem, fadeUp } from "@/lib/animations";

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string, username: string) {
  const v = name || username;
  return v.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();

  // ── Auth check ────────────────────────────────────────────────────────────
  const [authChecked, setAuthChecked] = useState(false);

  // ── Profile state ─────────────────────────────────────────────────────────
  const [profile,        setProfile]        = useState<ProfileData | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [profileNotice,  setProfileNotice]  = useState("");
  const [profileError,   setProfileError]   = useState("");
  const [savingProfile,  setSavingProfile]  = useState(false);

  // ── Password state ────────────────────────────────────────────────────────
  const [currentPw,     setCurrentPw]     = useState("");
  const [newPw,         setNewPw]         = useState("");
  const [confirmPw,     setConfirmPw]     = useState("");
  const [showPw,        setShowPw]        = useState(false);
  const [pwNotice,      setPwNotice]      = useState("");
  const [pwError,       setPwError]       = useState<Record<string, string>>({});
  const [savingPw,      setSavingPw]      = useState(false);

  // ── Active tab ────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"details" | "security">("details");

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthUser | null) => {
        if (!data?.id) { router.replace("/login"); return; }
        setAuthChecked(true);
      })
      .catch(() => { router.replace("/login"); });
  }, [router]);

  useEffect(() => {
    if (!authChecked) return;
    fetch("/api/v1/auth/profile/", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProfileData | null) => { if (d) setProfile(d); })
      .finally(() => setLoading(false));
  }, [authChecked]);

  // ── Save profile ──────────────────────────────────────────────────────────
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

  // ── Change password ───────────────────────────────────────────────────────
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

  // ── Loading ───────────────────────────────────────────────────────────────
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

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.username;
  const avatar   = initials(fullName, profile.username);

  // ── Render ────────────────────────────────────────────────────────────────
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
        {/* ── Hero strip ── */}
        <motion.div variants={fadeUp} style={{
          display: "flex", alignItems: "center", gap: 20,
          marginBottom: 36,
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 18,
            background: "linear-gradient(145deg,#254798,#183474)",
            color: "#fff", fontSize: "1.5rem", fontWeight: 900,
            display: "grid", placeItems: "center", flexShrink: 0,
          }}>
            {avatar || <User size={32} aria-hidden="true" />}
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "clamp(1.6rem,3vw,2.4rem)", letterSpacing: "-.03em" }}>
              {fullName}
            </h1>
            <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: ".9rem" }}>
              @{profile.username} · {profile.email}
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

        {/* ── Tab bar ── */}
        <motion.div variants={fadeUp} className="svc-tab-bar" style={{ marginBottom: 28 }}>
          <button
            className={`svc-tab${tab === "details" ? " active" : ""}`}
            onClick={() => setTab("details")}
          >
            <User size={14} aria-hidden="true" /> Profile details
          </button>
          <button
            className={`svc-tab${tab === "security" ? " active" : ""}`}
            onClick={() => setTab("security")}
          >
            <KeyRound size={14} aria-hidden="true" /> Security
          </button>
        </motion.div>

        {/* ── Details tab ── */}
        <AnimatePresence mode="wait">
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
                  <input name="programme" defaultValue={profile.programme} maxLength={200}
                    placeholder="e.g. BCA, BIT, BBA" />
                </label>
                <label>
                  Department
                  <input name="department" defaultValue={profile.department} maxLength={200}
                    placeholder="e.g. IT Department" />
                </label>
                <button className="primary-button full-field" type="submit" disabled={savingProfile}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {savingProfile
                    ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Saving…</>
                    : <><Save size={15} aria-hidden="true" /> Save changes</>}
                </button>
              </form>
            </motion.div>
          )}

          {/* ── Security tab ── */}
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
                  <input
                    type={showPw ? "text" : "password"}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                  {pwError.new_password && <span className="field-error" role="alert">{pwError.new_password}</span>}
                </label>

                <label>
                  Confirm new password
                  <input
                    type={showPw ? "text" : "password"}
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                  {pwError.confirm_password && <span className="field-error" role="alert">{pwError.confirm_password}</span>}
                </label>

                <button className="primary-button" type="submit" disabled={savingPw}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {savingPw
                    ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Saving…</>
                    : <><KeyRound size={15} aria-hidden="true" /> Change password</>}
                </button>
              </form>

              {/* Forgot password link for users who can't remember current password */}
              <p style={{ marginTop: 20, fontSize: ".85rem", color: "var(--muted)" }}>
                Forgot your current password?{" "}
                <a href="/forgot-password" style={{ color: "var(--brand)", fontWeight: 700 }}>
                  Reset it by email
                </a>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.main>
    </>
  );
}
