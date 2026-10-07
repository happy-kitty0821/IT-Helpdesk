/**
 * Next.js App Router Route Handler
 * POST /api/v1/upload/{upload_id}/finalize/
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime    = "nodejs";
export const maxDuration = 120;

const DJANGO = "http://127.0.0.1:8000";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ upload_id: string }> },
) {
  const { upload_id } = await params;
  const bodyBuffer = await request.arrayBuffer();

  const fwd = new Headers();
  fwd.set("content-type", request.headers.get("content-type") ?? "application/json");

  const csrf = request.headers.get("x-csrftoken");
  if (csrf) fwd.set("x-csrftoken", csrf);

  const cookie = request.headers.get("cookie");
  if (cookie) fwd.set("cookie", cookie);

  let res: Response;
  try {
    res = await fetch(`${DJANGO}/api/v1/upload/${upload_id}/finalize/`, {
      method: "POST", headers: fwd, body: bodyBuffer,
    });
  } catch (err) {
    console.error("[upload-finalize-proxy] Django unreachable:", err);
    return NextResponse.json({ detail: "Upload backend unreachable." }, { status: 502 });
  }

  const body = await res.arrayBuffer();
  return new NextResponse(body, {
    status:  res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}
