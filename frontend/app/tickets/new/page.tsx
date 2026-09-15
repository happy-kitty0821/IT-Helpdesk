"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { DynamicField } from "@/components/dynamic-field";
import { type FieldDefinition, type Service, fallbackServices } from "@/lib/services";
import { csrfToken } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

// Files can't be stored in sessionStorage, so PendingTicket only holds serialisable values
type SerialiseableValues = Record<string, string | boolean>;
type ExtraValues = Record<string, string | boolean | File | null>;

interface PendingTicket {
  categoryId: number | undefined;
  subject: string;
  description: string;
  priority: string;
  extraValues: SerialiseableValues;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Component ──────────────────────────────────────────────────────────────

function NewTicketForm() {
  const [categories, setCategories] = useState<Service[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Service | null>(null);
  const [extraValues, setExtraValues] = useState<ExtraValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("p3");

  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);

  // ── Mount: fetch categories, restore sessionStorage ────────────────────

  useEffect(() => {
    let mounted = true;

    async function init() {
      let liveCategories: Service[] = fallbackServices;
      try {
        const res = await fetch("/api/v1/services/", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) liveCategories = data as Service[];
        }
      } catch { /* keep fallback */ }

      if (!mounted) return;
      setCategories(liveCategories);

      // Pre-select from ?service=slug
      const serviceSlug = new URLSearchParams(window.location.search).get("service");
      if (serviceSlug) {
        const match = liveCategories.find((c) => c.slug === serviceSlug) ?? null;
        if (match) setSelectedCategory(match);
      }

      // Restore pending_ticket from sessionStorage (no files — they can't be stored)
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

          const autoSubmit = sessionStorage.getItem("pending_ticket_autosubmit") === "true";
          if (autoSubmit) {
            sessionStorage.removeItem("pending_ticket_autosubmit");
            try {
              const meRes = await fetch("/api/v1/auth/me/", { credentials: "include" });
              const meData = await meRes.json().catch(() => ({}));
              if (mounted && meData && typeof meData === "object" && "id" in meData) {
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
            } catch { /* ignore auto-submit failure */ }
          }
        }
      } catch { /* ignore corrupt sessionStorage */ }
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

  const sortedFields: FieldDefinition[] = selectedCategory
    ? [...selectedCategory.form_schema].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  // ── Client-side validation ─────────────────────────────────────────────

  function validateFields(schema: FieldDefinition[], values: ExtraValues): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of schema) {
      if (!field.required) continue;
      const val = values[field.key];

      if (field.type === "file") {
        if (!val || !(val instanceof File)) {
          errors[field.key] = "Please upload a file for this field.";
        } else if (val.size > MAX_FILE_BYTES) {
          errors[field.key] = "File exceeds the 10 MB limit. Please choose a smaller file.";
        }
      } else if (field.type === "checkbox") {
        if (val === undefined || val === null) {
          errors[field.key] = "This field is required.";
        }
      } else {
        if (!val || (typeof val === "string" && val.trim() === "")) {
          errors[field.key] = "This field is required.";
        }
      }
    }
    return errors;
  }

  // ── Submit ─────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const errors = validateFields(sortedFields, extraValues);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
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
            <p>Your reference number is <strong>{submitted.reference}</strong></p>
            <p>The IT team will review your request and respond as soon as possible.</p>
            <Link href="/" className="primary-button">Back to home</Link>
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
              <p className="form-message" role="alert">{generalError}</p>
            )}

            <form className="ticket-form" onSubmit={handleSubmit} noValidate>
              {/* Service category */}
              <label>
                Service category
                <select name="category" required value={selectedCategory?.id ?? ""} onChange={handleCategoryChange}>
                  <option value="" disabled>Select a service</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </label>

              {/* Subject */}
              <label>
                Subject
                <input
                  name="subject" value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  minLength={5} maxLength={150} required
                  placeholder="A short summary of the issue"
                />
              </label>

              {/* Dynamic fields */}
              {sortedFields.map((field) => (
                <DynamicField
                  key={field.key}
                  field={field}
                  value={extraValues[field.key] ?? (field.type === "checkbox" ? false : field.type === "file" ? null : "")}
                  onChange={(key, val) => setExtraValues((prev) => ({ ...prev, [key]: val }))}
                  error={fieldErrors[field.key]}
                />
              ))}

              {/* Description */}
              <label>
                Description
                <textarea
                  name="description" value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  minLength={20} maxLength={5000} required rows={7}
                  placeholder="What were you trying to do, and what happened instead?"
                />
              </label>

              {/* Priority */}
              <label>
                Impact
                <select name="priority" value={priority} onChange={(e) => setPriority(e.target.value)} required>
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

// ── Default export with Suspense boundary ─────────────────────────────────────

export default function NewTicketPage() {
  return (
    <Suspense fallback={null}>
      <NewTicketForm />
    </Suspense>
  );
}

// ── Standalone submit helper ───────────────────────────────────────────────

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
  setSubmitting(true);
  setGeneralError(null);

  try {
    // 1. Auth check
    let authenticated = false;
    try {
      const meRes = await fetch("/api/v1/auth/me/", { credentials: "include" });
      const meData = await meRes.json().catch(() => ({}));
      authenticated = meData && typeof meData === "object" && "id" in meData;
    } catch { authenticated = false; }

    if (!authenticated) {
      // Persist serialisable fields only (no File objects) and redirect to login
      const serialisable: SerialiseableValues = {};
      for (const [k, v] of Object.entries(pendingExtraValues)) {
        if (typeof v === "string" || typeof v === "boolean") serialisable[k] = v;
      }
      const payload: PendingTicket = {
        categoryId: pendingCategoryId,
        subject: pendingSubject,
        description: pendingDescription,
        priority: pendingPriority,
        extraValues: serialisable,
      };
      sessionStorage.setItem("pending_ticket", JSON.stringify(payload));
      sessionStorage.setItem("pending_ticket_autosubmit", "true");
      window.location.assign("/login");
      return;
    }

    // 2. Check whether any file fields have File values
    const fileEntries = Object.entries(pendingExtraValues).filter(
      ([, v]) => v instanceof File
    ) as [string, File][];

    const token = await csrfToken();

    let res: Response;

    if (fileEntries.length > 0) {
      // 3a. Multipart submission when files are present
      //     extra_fields JSON is sent as a string; files as individual parts
      const nonFileExtra: SerialiseableValues = {};
      for (const [k, v] of Object.entries(pendingExtraValues)) {
        if (!(v instanceof File) && v !== null) {
          nonFileExtra[k] = v as string | boolean;
        }
      }

      const form = new FormData();
      form.append("category", String(pendingCategoryId));
      form.append("subject", pendingSubject);
      form.append("description", pendingDescription);
      form.append("priority", pendingPriority);
      form.append("extra_fields", JSON.stringify(nonFileExtra));
      for (const [key, file] of fileEntries) {
        form.append(key, file, file.name);
      }

      res = await fetch("/api/v1/tickets/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": token },
        // No Content-Type header — browser sets it with boundary for multipart
        body: form,
      });
    } else {
      // 3b. JSON submission when no files
      const nonNullExtra: SerialiseableValues = {};
      for (const [k, v] of Object.entries(pendingExtraValues)) {
        if (v !== null) nonNullExtra[k] = v as string | boolean;
      }

      res = await fetch("/api/v1/tickets/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({
          category: pendingCategoryId,
          subject: pendingSubject,
          description: pendingDescription,
          priority: pendingPriority,
          extra_fields: nonNullExtra,
        }),
      });
    }

    const data = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (res.ok) {
      sessionStorage.removeItem("pending_ticket");
      sessionStorage.removeItem("pending_ticket_autosubmit");
      setSubmitted({ reference: data.reference as string });
      return;
    }

    if (res.status === 400 && data.extra_fields && typeof data.extra_fields === "object") {
      const serverErrors: Record<string, string> = {};
      for (const [key, msg] of Object.entries(data.extra_fields as Record<string, unknown>)) {
        serverErrors[key] = Array.isArray(msg) ? (msg[0] as string) : String(msg);
      }
      setFieldErrors(serverErrors);
      return;
    }

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
