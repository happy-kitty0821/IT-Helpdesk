/**
 * Next.js App Router Route Handler
 * GET /api/v1/admin/summary/stream/
 *
 * Same pattern as the ticket stream Route Handler — see that file for the
 * full explanation of why a Route Handler is required for SSE.
 *
 * ACCESS CONTROL
 * ──────────────
 * Django's AdminDashboardStreamView requires the administrator role.
 * This handler is a transparent pipe; it does not bypass that check.
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DJANGO = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const fwd = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) fwd.set("cookie", cookie);
  fwd.set("accept", "text/event-stream");
  fwd.set("cache-control", "no-cache");

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(
      `${DJANGO}/api/v1/admin/summary/stream/`,
      {
        method:  "GET",
        headers: fwd,
        signal:  abort.signal,
        // @ts-expect-error — Node.js fetch extension
        duplex: "half",
      },
    );
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return new NextResponse(null, { status: 499 });
    }
    console.error("[admin-summary-stream] Django unreachable:", err);
    return NextResponse.json(
      { detail: "Stream backend unreachable." },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => "");
    return new NextResponse(body || null, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type":      "text/event-stream; charset=utf-8",
      "cache-control":     "no-cache, no-transform",
      "x-accel-buffering": "no",
      "content-encoding":  "identity",
      "transfer-encoding": "chunked",
    },
  });
}
