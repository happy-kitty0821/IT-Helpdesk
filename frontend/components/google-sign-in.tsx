"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { authPost } from "@/lib/auth";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void; hd?: string }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

export function GoogleSignIn({ onSuccess }: { onSuccess: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !ready || !window.google || !container.current) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      hd: "iic.edu.np",
      callback: async ({ credential }) => {
        try {
          setError("");
          await authPost("google", { credential });
          onSuccess();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Google sign-in failed.");
        }
      },
    });
    container.current.replaceChildren();
    window.google.accounts.id.renderButton(container.current, { theme: "outline", size: "large", width: "320", text: "continue_with" });
  }, [clientId, onSuccess, ready]);

  if (!clientId) return <p className="oauth-unavailable">Google sign-in will appear after the IIC Google client ID is configured.</p>;

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setReady(true)} />
      <div className="google-button" ref={container} />
      {error && <p className="auth-error" role="alert">{error}</p>}
    </>
  );
}
