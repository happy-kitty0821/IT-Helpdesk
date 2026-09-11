"use client";

import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";
import { FormEvent } from "react";
import { SiteHeader } from "@/components/site-header";

export default function NewTicketPage() {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.assign("/login");
  }

  return (
    <>
      <SiteHeader />
      <main className="form-page shell">
        <Link href="/" className="back-link"><ArrowLeft aria-hidden="true" /> Back to services</Link>
        <div className="form-layout">
          <section>
            <p className="eyebrow">New support request</p>
            <h1>Tell us what happened</h1>
            <p className="form-intro">Share enough detail for the IT team to understand the issue. Never include your password or verification code.</p>
            <form className="ticket-form" onSubmit={submit}>
              <label>Service category<select name="category" required defaultValue=""><option value="" disabled>Select a service</option><option>College account recovery</option><option>Laptop & device support</option><option>ID card replacement</option><option>Wi-Fi issue</option><option>CCTV review request</option><option>General IT support</option></select></label>
              <label>Subject<input name="subject" minLength={5} maxLength={150} required placeholder="A short summary of the issue" /></label>
              <label>Description<textarea name="description" minLength={20} maxLength={5000} required rows={7} placeholder="What were you trying to do, and what happened instead?" /></label>
              <label>Impact<select name="priority" required defaultValue="p3"><option value="p3">Only I am affected</option><option value="p2">Several people are affected</option><option value="p1">Teaching or a campus service is stopped</option><option value="p4">Advice or a planned request</option></select></label>
              <button className="primary-button" type="submit">Continue to sign in</button>
            </form>
          </section>
          <aside className="privacy-note"><Info aria-hidden="true" /><div><h2>Before you submit</h2><p>Do not add passwords, one-time codes, licence keys, or CCTV footage. Sensitive requests are restricted to authorized staff.</p></div></aside>
        </div>
      </main>
    </>
  );
}
