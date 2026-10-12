"use client";

import { useEffect, useRef } from "react";

// ── Event payload shapes ───────────────────────────────────────────────────

export interface TicketSnapshot {
  id: string;
  status: string;
  priority: string;
  current_stage: string;
  subject: string;
  assignee_name: string | null;
  team: string;
  updated_at: string | null;
  is_overdue: boolean;
}

export interface StreamMessage {
  id: number;
  sender: number;
  sender_name: string | null;
  sender_email: string | null;
  body: string;
  is_staff_reply: boolean;
  is_internal: boolean;
  created_at: string;
}

interface UseTicketStreamOptions {
  ticketId: string | null;
  /** Called when ticket fields change. */
  onTicketUpdate: (snapshot: TicketSnapshot) => void;
  /** Called for each new message pushed from the server. */
  onNewMessage: (message: StreamMessage) => void;
  /** Optional: called on connection error with a human-readable reason. */
  onError?: (reason: string) => void;
  /** Optional: called once the stream successfully connects. */
  onConnected?: () => void;
  /** Whether to open the stream at all (e.g. skip when ticket is closed). */
  enabled?: boolean;
}

/**
 * Opens a Server-Sent Events connection directly to Django, bypassing the
 * Next.js proxy which buffers responses and breaks SSE streams.
 *
 * URL: {NEXT_PUBLIC_DJANGO_URL}/api/v1/tickets/{id}/stream/
 * Falls back to a relative URL (/api/v1/...) when NEXT_PUBLIC_DJANGO_URL is
 * not set (local dev without an explicit env var).
 *
 * Reconnects automatically with exponential back-off (1 s → 2 s → 4 s … 30 s).
 * Cleans up the EventSource when ticketId changes or the component unmounts.
 */
export function useTicketStream({
  ticketId,
  onTicketUpdate,
  onNewMessage,
  onError,
  onConnected,
  enabled = true,
}: UseTicketStreamOptions): void {
  // Keep stable refs so reconnect logic always has the latest callbacks
  const onTicketUpdateRef = useRef(onTicketUpdate);
  const onNewMessageRef   = useRef(onNewMessage);
  const onErrorRef        = useRef(onError);
  const onConnectedRef    = useRef(onConnected);

  useEffect(() => { onTicketUpdateRef.current = onTicketUpdate; }, [onTicketUpdate]);
  useEffect(() => { onNewMessageRef.current   = onNewMessage;   }, [onNewMessage]);
  useEffect(() => { onErrorRef.current        = onError;        }, [onError]);
  useEffect(() => { onConnectedRef.current    = onConnected;    }, [onConnected]);

  useEffect(() => {
    if (!ticketId || !enabled) return;

    // Use a relative URL so the stream goes through the Next.js local proxy,
    // which is a plain HTTP/1.1 connection between Next.js and Django on
    // localhost — completely bypassing Cloudflare's QUIC/HTTP3 layer.
    // Direct-to-Django URLs go through Cloudflare which terminates SSE
    // connections with ERR_QUIC_PROTOCOL_ERROR on HTTP/3.
    const streamUrl = `/api/v1/tickets/${ticketId}/stream/`;

    let es: EventSource | null = null;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      es = new EventSource(streamUrl, { withCredentials: true });

      es.addEventListener("connected", (e: MessageEvent) => {
        retryDelay = 1000;
        try {
          const payload = JSON.parse(e.data) as { ticket?: TicketSnapshot };
          if (payload.ticket) onTicketUpdateRef.current(payload.ticket);
        } catch { /* ignore */ }
        onConnectedRef.current?.();
      });

      es.addEventListener("ticket_update", (e: MessageEvent) => {
        try {
          onTicketUpdateRef.current(JSON.parse(e.data) as TicketSnapshot);
        } catch { /* ignore */ }
      });

      es.addEventListener("new_message", (e: MessageEvent) => {
        try {
          onNewMessageRef.current(JSON.parse(e.data) as StreamMessage);
        } catch { /* ignore */ }
      });

      es.addEventListener("error", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as { detail?: string };
          onErrorRef.current?.(payload.detail ?? "Stream error.");
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        es?.close();
        if (!unmounted) {
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30_000);
            connect();
          }, retryDelay);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [ticketId, enabled]);
}
