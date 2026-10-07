/**
 * Next.js Route Handler — proxy POST /api/v1/upload/init/
 * Forwards JSON body to Django, returns the upload_id.
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const DJANGO_BASE = "http://127.0.0.1:8000";

export async function POST(request: NextRequest) {
  const bodyBuffer = await request.arrayBuffer();

  const forwardHeaders = new Headers();
  forwardHeaders.set("content-type", request.headers.get("content-type") ?? "application/json");

  const csrf = request.headers.get("x-csrftoken");
  if (csrf) forwardHeaders.set("x-csrftoken", csrf);

  const cookie = request.headers.get("cookie");
  if (cookie) forwardHeaders.set("cookie", cookie);

  let djangoRes: Response;
  try {
    djangoRes = await fetch(`${DJANGO_BASE}/api/v1/upload/init/`, {
      method:  "POST",
      headers: forwardHeaders,
      body:    bodyBuffer,
    });
  } catch (err) {
    console.error("[upload-init-proxy] fetch failed:", err);
    return NextResponse.json({ detail: "Could not connect to upload backend." }, { status: 502 });
  }

  const responseBody = await djangoRes.arrayBuffer();
  return new NextResponse(responseBody, {
    status:  djangoRes.status,
    headers: { "content-type": djangoRes.headers.get("content-type") ?? "application/json" },
  });
}
