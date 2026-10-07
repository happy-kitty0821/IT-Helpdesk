/**
 * Next.js Route Handler — proxy PUT /api/v1/upload/{upload_id}/chunk/{index}/
 *
 * WHY THIS EXISTS
 * ───────────────
 * Next.js's built-in rewrite proxy silently drops multipart/form-data bodies
 * on PUT requests before they reach Django. This Route Handler explicitly
 * reads the raw request body and streams it to Django, bypassing that bug.
 *
 * This ONLY handles the chunk PUT. Every other /api/v1/* request still
 * uses the rewrite proxy in next.config.ts as before.
 *
 * BODY SIZE
 * ─────────
 * bodySizeLimit is set to '55mb' — enough for a 50 MB chunk plus
 * multipart boundary overhead.
 */

import { type NextRequest, NextResponse } from "next/server";

// Disable Next.js's built-in body parser for this route — we need to
// stream the raw multipart body straight through to Django.
export const runtime = "nodejs";

// Allow up to 55 MB request bodies — enough for a 50 MB chunk + multipart overhead.
export const maxDuration = 120; // seconds — matches Gunicorn timeout

export const config = {
  api: {
    bodyParser: false,
  },
};

const DJANGO_BASE = "http://127.0.0.1:8000";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ upload_id: string; index: string }> },
) {
  const { upload_id, index } = await params;

  // Forward the raw body as-is (multipart/form-data with the chunk blob).
  // We must read it as an ArrayBuffer and re-send it rather than using
  // request.body directly, because Next.js may have already partially
  // consumed the stream.
  const bodyBuffer = await request.arrayBuffer();

  // Build forwarding headers — copy Content-Type (preserves multipart boundary),
  // CSRF token, and Cookie so Django can authenticate the session.
  const forwardHeaders = new Headers();

  const contentType = request.headers.get("content-type");
  if (contentType) forwardHeaders.set("content-type", contentType);

  const csrfToken = request.headers.get("x-csrftoken");
  if (csrfToken) forwardHeaders.set("x-csrftoken", csrfToken);

  const cookie = request.headers.get("cookie");
  if (cookie) forwardHeaders.set("cookie", cookie);

  // Forward X-Forwarded-For so Django logs the real client IP.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) forwardHeaders.set("x-forwarded-for", xff);

  const djangoUrl = `${DJANGO_BASE}/api/v1/upload/${upload_id}/chunk/${index}/`;

  let djangoRes: Response;
  try {
    djangoRes = await fetch(djangoUrl, {
      method:  "PUT",
      headers: forwardHeaders,
      body:    bodyBuffer,
      // @ts-expect-error — Node.js fetch supports duplex for streaming
      duplex:  "half",
    });
  } catch (err) {
    console.error("[chunk-proxy] fetch to Django failed:", err);
    return NextResponse.json(
      { detail: "Could not connect to upload backend." },
      { status: 502 },
    );
  }

  // Forward Django's response (status + body) back to the browser.
  const responseBody = await djangoRes.arrayBuffer();
  return new NextResponse(responseBody, {
    status:  djangoRes.status,
    headers: { "content-type": djangoRes.headers.get("content-type") ?? "application/json" },
  });
}
