/**
 * Next.js App Router Route Handler
 * PUT /api/v1/upload/{upload_id}/chunk/{index}/
 *
 * WHY THIS EXISTS
 * ───────────────
 * Next.js's built-in rewrite proxy drops multipart/form-data bodies on PUT
 * requests before they reach Django. This Route Handler explicitly reads the
 * raw request body and forwards it to Django, bypassing that bug.
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime    = "nodejs";
export const maxDuration = 120; // seconds — matches Gunicorn timeout

const DJANGO = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ upload_id: string; index: string }> },
) {
  const { upload_id, index } = await params;

  // Read the entire multipart body into memory.
  // App Router route handlers don't have a built-in body size limit for
  // nodejs runtime — the limit comes from Gunicorn/Django on the other side.
  const bodyBuffer = await request.arrayBuffer();

  const fwd = new Headers();

  const ct = request.headers.get("content-type");
  if (ct)  fwd.set("content-type", ct);           // must keep multipart boundary

  const csrf = request.headers.get("x-csrftoken");
  if (csrf) fwd.set("x-csrftoken", csrf);

  const cookie = request.headers.get("cookie");
  if (cookie) fwd.set("cookie", cookie);           // session auth

  const xff = request.headers.get("x-forwarded-for");
  if (xff) fwd.set("x-forwarded-for", xff);

  let res: Response;
  try {
    res = await fetch(`${DJANGO}/api/v1/upload/${upload_id}/chunk/${index}/`, {
      method:  "PUT",
      headers: fwd,
      body:    bodyBuffer,
    });
  } catch (err) {
    console.error("[chunk-proxy] Django unreachable:", err);
    return NextResponse.json({ detail: "Upload backend unreachable." }, { status: 502 });
  }

  const body = await res.arrayBuffer();
  return new NextResponse(body, {
    status:  res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}
