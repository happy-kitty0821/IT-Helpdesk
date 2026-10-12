/**
 * Next.js App Router Route Handler
 * GET /api/v1/tickets/[id]/stream/
 *
 * WHY THIS EXISTS
 * ───────────────
 * Next.js's built-in rewrite proxy (next.config.ts rewrites()) buffers the
 * complete upstream response body before forwarding it to the browser.
 * For a normal JSON response this is invisible, but for an SSE stream that
 * never ends the browser receives headers immediately and then zero bytes
 * of body — the chunks are held in Node.js's internal buffer until the
 * connection closes, which never happens for a healthy stream.
 *
 * A Route Handler can return res.body (a ReadableStream) directly.  The
 * Next.js HTTP server writes each chunk to the socket as it arrives from
 * Django, with no intermediate buffering.
 *
 * SESSION AUTHENTICATION
 * ──────────────────────
 * Django uses session cookies for auth.  The browser sends its session
 * cookie automatically when it opens the EventSource connection (because
 * withCredentials: true is set in the hook).  This handler forwards the
 * cookie header verbatim to Django so Django's SessionMiddleware can
 * authenticate the request.  No CSRF token is needed for GET requests.
 *
 * ACCESS CONTROL
 * ──────────────
 * All access control (ticket ownership, staff roles, intern scope) is
 * enforced inside TicketStreamView on the Django side.  This handler is
 * a transparent pipe — it does not bypass any authorization check.
 *
 * DISCONNECTION
 * ─────────────
 * When the browser closes the EventSource connection (e.g. user closes the
 * panel), the fetch() to Django is aborted via AbortController, which
 * causes Django's StreamingHttpResponse generator to receive a
 * GeneratorExit or BrokenPipeError and stop iterating — no wasted work.
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
// No maxDuration — SSE connections are indefinite by design.
// Gunicorn's worker-level timeout governs the upstream side.

const DJANGO = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Forward only the headers Django needs for this request.
  // Cookie carries the session; Accept tells Django we want SSE.
  const fwd = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) fwd.set("cookie", cookie);
  fwd.set("accept", "text/event-stream");
  fwd.set("cache-control", "no-cache");

  // Abort the upstream fetch when the client disconnects so Django's
  // generator stops and the gthread slot is freed promptly.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(
      `${DJANGO}/api/v1/tickets/${id}/stream/`,
      {
        method:  "GET",
        headers: fwd,
        signal:  abort.signal,
      },
    );
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      // Client disconnected before Django responded — that's fine.
      return new NextResponse(null, { status: 499 });
    }
    console.error("[ticket-stream] Django unreachable:", err);
    return NextResponse.json(
      { detail: "Stream backend unreachable." },
      { status: 502 },
    );
  }

  // Propagate non-200 responses from Django (e.g. 401, 403, 404) as-is.
  // The client's onerror handler will fire and can inspect the status.
  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => "");
    return new NextResponse(body || null, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
    });
  }

  // Return the upstream ReadableStream directly.
  // Each chunk Django yields is written to the socket immediately —
  // no intermediate buffering in Node.js or Next.js.
  // Do NOT set transfer-encoding manually — Node.js sets it automatically
  // and setting it explicitly can conflict with HTTP/2 framing.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type":      "text/event-stream; charset=utf-8",
      "cache-control":     "no-cache, no-transform",
      "x-accel-buffering": "no",
      // Prevent gzip/br compression which would buffer chunks until flush.
      "content-encoding":  "identity",
    },
  });
}
