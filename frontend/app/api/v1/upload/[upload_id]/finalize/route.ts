/**
 * Next.js Route Handler — proxy POST /api/v1/upload/{upload_id}/finalize/
 * Tells Django to assemble all received chunks into the final file.
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120; // assembly of a large file can take time

const DJANGO_BASE = "http://127.0.0.1:8000";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ upload_id: string }> },
) {
  const { upload_id } = await params;
  const bodyBuffer = await request.arrayBuffer();

  const forwardHeaders = new Headers();
  forwardHeaders.set("content-type", request.headers.get("content-type") ?? "application/json");

  const csrf = request.headers.get("x-csrftoken");
  if (csrf) forwardHeaders.set("x-csrftoken", csrf);

  const cookie = request.headers.get("cookie");
  if (cookie) forwardHeaders.set("cookie", cookie);

  let djangoRes: Response;
  try {
    djangoRes = await fetch(`${DJANGO_BASE}/api/v1/upload/${upload_id}/finalize/`, {
      method:  "POST",
      headers: forwardHeaders,
      body:    bodyBuffer,
    });
  } catch (err) {
    console.error("[upload-finalize-proxy] fetch failed:", err);
    return NextResponse.json({ detail: "Could not connect to upload backend." }, { status: 502 });
  }

  const responseBody = await djangoRes.arrayBuffer();
  return new NextResponse(responseBody, {
    status:  djangoRes.status,
    headers: { "content-type": djangoRes.headers.get("content-type") ?? "application/json" },
  });
}
