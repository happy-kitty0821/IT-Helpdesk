"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { DynamicField } from "@/components/dynamic-field";
import { type FieldDefinition, type Service, fallbackServices } from "@/lib/services";
import { csrfToken } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

type ExtraValues = Record<string, string | boolean>;

interface PendingTicket {
  categoryId: number | undefined;
  subject: string;
  description: string;
  priority: string;
  extraValues: ExtraValues;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function NewTicketPage() {
  // Core form state
  const [categories, setCategories] = useState<Service[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Service | null>(null);
  const [extraValues, setExtraValues] = useState<ExtraValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Common fields
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("p3");

  // UI state
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);

  // ── Mount: fetch categories then restore sessionStorage ────────────────

  useEffect(() => {
    let mounted = true;

    async function init() {
      // 1. Fetch live categories
      let liveCategories: Service[] = fallbackServices;
      try {
        const res = await fetch("/api/v1/services/", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) liveCategories = data as Service[];
        }
      } catch {
        // keep fallback
      }

      if (!mounted) return;
      setCategories(liveCategories);

      // 2. Restore pending_ticket from sessionStorage
      try {
        const raw = sessionStorage.getItem("pending_ticket");
        if (raw) {
          const pending: PendingTicket = JSON.parse(raw);
          if (pending.subject)     setSubject(pending.subject);
          if (pending.description) setDescription(pending.description);
          if (pending.priority)    setPriority(pending.priority);
          if (pending.extraValues) setExtraValues(pending.extraValues);

          if (pending.categoryId !== undefined) {
            const match = liveCategories.find((c) => c.id === pending.categoryId) ?? null;
            setSelectedCategory(match);
          }

          // 3. Auto-submit if flag is set
          const autoSubmit = sessionStorage.getItem("pending_ticket_autosubmit") === "true";
          if (autoSubmit) {
            sessionStorage.removeItem("pending_ticket_autosubmit");
            try {
              const meRes = await fetch("/api/v1/auth/me/", { credentials: "include" });
              const meData = await meRes.json().catch(() => ({}));
              if (mounted && meData && typeof meData === "object" && "id" in meData) {
                // Reconstruct the full payload from restored state and call submit
                await doSubmit({
                  cats: liveCategories,
                  pendingCategoryId: pending.categoryId,
                  pendingSubject: pending.subject,
                  pendingDescription: pending.description,
                  pendingPriority: pending.priority,
                  pendingExtraValues: pending.extraValues,
                  setSubmitting: mounted ? setSubmitting : () => {},
                  setFieldErrors: mounted ? setFieldErrors : () => {},
                  setGeneralError: mounted ? setGeneralError : () => {},
                  setSubmitted: mounted ? setSubmitted : () => {},
                });
              }
            } catch {
              // silently ignore auto-submit failure
            }
          }
        }
      } catch {
        // silently abandon corrupt sessionStorage
      }
    }

    init();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Category change ────────────────────────────────────────────────────

  function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = Number(e.target.value);
    const cat = categories.find((c) => c.id === id) ?? null;
    setSelectedCategory(cat);
    setExtraValues({});
    setFieldErrors({});
  }

  // ── Dynamic fields sorted by order ────────────────────────────────────

  const sortedFields: FieldDefinition[] = selectedCategory
    ? [...selectedCategory.form_schema].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  // ── Client-side required field validation ─────────────────────────────

  function validateFields(
    schema: FieldDefinition[],
    values: ExtraValues,
  ): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of schema) {
      if (!field.required) continue;
      const val = values[field.key];
      if (field.type === "checkbox") {
        if (val === undefined) errors[field.key] = "This field is required.";
      } else {
        if (!val || (typeof val === "string" && val.trim() === "")) {
          errors[field.key] = "This field is required.";
        }
      }
    }
    return errors;
  }

  // ── Core submit logic (extracted so auto-submit can call it too) ───────

  async function submitTicket() {
    await doSubmit({
      cats: categories,
      pendingCategoryId: selectedCategory?.id,
      pendingSubject: subject,
      pendingDescription: description,
      pendingPriority: priority,
      pendingExtraValues: extraValues,
      setSubmitting,
      setFieldErrors,
      setGeneralError,
      setSubmitted,
    });
  }

  // ── Form submit handler ────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Client-side dynamic-field validation
    const errors = validateFields(sortedFields, extraValues);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await submitTicket();
    } finally {
      setSubmitting(false);
    }
  }

  // ── Confirmation screen ────────────────────────────────────────────────

  if (submitted) {
    return (
      <>
        <SiteHeader />
        <main className="form-page shell">
          <div className="ticket-confirmation">
            <CheckCircle2 aria-hidden="true" />
            <h1>Request submitted</h1>
            <p>
              Your reference number is{" "}
              <strong>{submitted.reference}</strong>
            </p>
            <p>The IT team will review your request and respond as soon as possible.</p>
            <Link href="/" className="primary-button">
              Back to home
            </Link>
          </div>
        </main>
      </>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────

  return (
    <>
      <SiteHeader />
      <main className="form-page shell">
        <Link href="/" className="back-link">
          <ArrowLeft aria-hidden="true" /> Back to services
        </Link>
        <div className="form-layout">
          <section>
            <p className="eyebrow">New support request</p>
            <h1>Tell us what happened</h1>
            <p className="form-intro">
              Share enough detail for the IT team to understand the issue. Never include your
              password or verification code.
            </p>

            {generalError && (
              <p className="form-message" role="alert">
                {generalError}
              </p>
            )}

            <form className="ticket-form" onSubmit={handleSubmit} noValidate>
              {/* ── Service category ── */}
              <label>
                Service category
                <select
                  name="category"
                  required
                  value={selectedCategory?.id ?? ""}
                  onChange={handleCategoryChange}
                >
                  <option value="" disabled>
                    Select a service
                  </option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* ── Subject ── */}
              <label>
                Subject
                <input
                  name="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  minLength={5}
                  maxLength={150}
                  required
                  placeholder="A short summary of the issue"
                />
              </label>

              {/* ── Dynamic fields (between subject and description) ── */}
              {sortedFields.map((field) => (
                <DynamicField
                  key={field.key}
                  field={field}
                  value={extraValues[field.key] ?? (field.type === "checkbox" ? false : "")}
                  onChange={(key, val) =>
                    setExtraValues((prev) => ({ ...prev, [key]: val }))
                  }
                  error={fieldErrors[field.key]}
                />
              ))}

              {/* ── Description ── */}
              <label>
                Description
                <textarea
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  minLength={20}
                  maxLength={5000}
                  required
                  rows={7}
                  placeholder="What were you trying to do, and what happened instead?"
                />
              </label>

              {/* ── Priority / Impact ── */}
              <label>
                Impact
                <select
                  name="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  required
                >
                  <option value="p3">Only I am affected</option>
                  <option value="p2">Several people are affected</option>
                  <option value="p1">Teaching or a campus service is stopped</option>
                  <option value="p4">Advice or a planned request</option>
                </select>
              </label>

              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit request"}
              </button>
            </form>
          </section>

          <aside className="privacy-note">
            <Info aria-hidden="true" />
            <div>
              <h2>Before you submit</h2>
              <p>
                Do not add passwords, one-time codes, licence keys, or CCTV footage. Sensitive
                requests are restricted to authorized staff.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

// ── Standalone submit helper ───────────────────────────────────────────────
//
// Extracted into a plain async function so both the form handler and the
// auto-submit-on-mount path can call identical logic without needing to close
// over the same React state setters.

interface DoSubmitArgs {
  cats: Service[];
  pendingCategoryId: number | undefined;
  pendingSubject: string;
  pendingDescription: string;
  pendingPriority: string;
  pendingExtraValues: ExtraValues;
  setSubmitting: (v: boolean) => void;
  setFieldErrors: (v: Record<string, string>) => void;
  setGeneralError: (v: string | null) => void;
  setSubmitted: (v: { reference: string }) => void;
}

async function doSubmit({
  cats,
  pendingCategoryId,
  pendingSubject,
  pendingDescription,
  pendingPriority,
  pendingExtraValues,
  setSubmitting,
  setFieldErrors,
  setGeneralError,
  setSubmitted,
}: DoSubmitArgs) {
  const category = cats.find((c) => c.id === pendingCategoryId) ?? null;

  setSubmitting(true);
  setGeneralError(null);

  try {
    // 1. Auth check
    let authenticated = false;
    try {
      const meRes = await fetch("/api/v1/auth/me/", { credentials: "include" });
      const meData = await meRes.json().catch(() => ({}));
      authenticated = meData && typeof meData === "object" && "id" in meData;
    } catch {
      authenticated = false;
    }

    if (!authenticated) {
      // Persist form data and redirect to login
      const payload: PendingTicket = {
        categoryId: pendingCategoryId,
        subject: pendingSubject,
        description: pendingDescription,
        priority: pendingPriority,
        extraValues: pendingExtraValues,
      };
      sessionStorage.setItem("pending_ticket", JSON.stringify(payload));
      sessionStorage.setItem("pending_ticket_autosubmit", "true");
      window.location.assign("/login");
      return;
    }

    // 2. Obtain CSRF token and POST
    const token = await csrfToken();
    const body = {
      category: pendingCategoryId,
      subject: pendingSubject,
      description: pendingDescription,
      priority: pendingPriority,
      extra_fields: pendingExtraValues,
    };

    const res = await fetch("/api/v1/tickets/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": token,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (res.ok) {
      // 3. Success — clear pending state and show confirmation
      sessionStorage.removeItem("pending_ticket");
      sessionStorage.removeItem("pending_ticket_autosubmit");
      setSubmitted({ reference: data.reference as string });
      return;
    }

    if (res.status === 400 && data.extra_fields && typeof data.extra_fields === "object") {
      // 4. Field-level errors from the server
      const serverErrors: Record<string, string> = {};
      for (const [key, msg] of Object.entries(data.extra_fields as Record<string, unknown>)) {
        serverErrors[key] = Array.isArray(msg) ? (msg[0] as string) : String(msg);
      }
      setFieldErrors(serverErrors);
      return;
    }

    // 5. Generic error
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : "Your request could not be submitted. Please try again.";
    setGeneralError(detail);
  } catch {
    setGeneralError("A network error occurred. Please check your connection and try again.");
  } finally {
    setSubmitting(false);
  }
}
