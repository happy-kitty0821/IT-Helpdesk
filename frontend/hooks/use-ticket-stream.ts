"use client";

import { useEffect, useRef, useCallback } from "react";

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
 * Opens a Server-Sent Events connection to /api/v1/tickets/{id}/stream/
 * and dispatches ticket_update and new_message events to the caller.
 *
 * Reconnects automatically with exponential back-off (1s → 2s → 4s … cap 30s).
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

    let es: EventSource | null = null;
    let retryDelay = 1000;    // ms — doubles on each failure, capped at 30 s
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      es = new EventSource(`/api/v1/tickets/${ticketId}/stream/`, {
        // EventSource uses the same-origin session cookie automatically
        withCredentials: true,
      });

      es.addEventListener("connected", (e: MessageEvent) => {
        retryDelay = 1000; // reset back-off on successful connect
        try {
          const payload = JSON.parse(e.data) as { ticket?: TicketSnapshot };
          if (payload.ticket) {
            onTicketUpdateRef.current(payload.ticket);
          }
        } catch { /* ignore parse errors */ }
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
        // EventSource fires onerror both for transient network blips and
        // permanent failures.  Close and reconnect with back-off.
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
