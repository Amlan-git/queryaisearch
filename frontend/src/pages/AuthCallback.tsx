import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

/**
 * Two distinct failure modes get distinct recovery paths:
 *
 *   - "exchange-error": the PKCE round-trip failed (no `?code=`, expired
 *     verifier, signature mismatch, etc.). The Supabase session was never
 *     created, so the only recovery is to restart OAuth from `/auth`.
 *
 *   - "sync-error": the Supabase session is valid, but the backend `/signin`
 *     call to mirror the user into our local Postgres failed (e.g. DB down,
 *     5xx, network error). Navigating to `/search` anyway would cause the
 *     next write to trip the `Conversation.userId -> User.id` foreign key
 *     and surface an opaque 500 to the user. Instead we surface the failure
 *     here with a retry that re-runs the sync against the cached session,
 *     and an escape hatch to restart OAuth if the session itself is suspect.
 */
type CallbackStatus = "loading" | "exchange-error" | "sync-error";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<CallbackStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  // Guards against React 19 StrictMode's double-invoke of effects and against
  // any HMR-triggered re-runs while the exchange is in flight.
  const exchangeInitiated = useRef(false);

  // Cached session for the "Retry sync" path. The session is valid; only the
  // backend mirror failed. Retrying the sync should not need a fresh OAuth.
  const sessionRef = useRef<Session | null>(null);

  /**
   * POSTs to /signin to mirror the OAuth identity into our local DB, then
   * navigates into the app. On any failure we transition to "sync-error"
   * instead of navigating, so the user gets an actionable message instead
   * of a downstream 500 from `/query_ask`.
   */
  const syncAndNavigate = useCallback(async (session: Session) => {
    const name =
      session.user?.user_metadata?.full_name ||
      session.user?.user_metadata?.name ||
      session.user?.email ||
      "User";
    const rawProvider = session.user?.app_metadata?.provider || "google";
    const provider = rawProvider === "github" ? "GITHUB" : "GOOGLE";

    try {
      const response = await fetch("/signin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name, provider }),
      });

      if (!response.ok) {
        // Read the body for the console diagnostic but never surface it to
        // the user — backend error text may contain implementation detail.
        const detail = await response.text().catch(() => "");
        console.error(
          `[auth-callback] Backend sync failed (${response.status}):`,
          detail
        );
        sessionRef.current = session;
        setErrorMessage(
          response.status >= 500
            ? "Our servers had trouble linking your account. Try again in a moment."
            : "We couldn't finish signing you in. Try again, or sign in once more."
        );
        setStatus("sync-error");
        return;
      }

      console.log("[auth-callback] Backend sync succeeded");
    } catch (syncError) {
      console.error("[auth-callback] Network error during backend sync:", syncError);
      sessionRef.current = session;
      setErrorMessage(
        "We couldn't reach our servers to finish signing you in. Check your connection and try again."
      );
      setStatus("sync-error");
      return;
    }

    // Sync succeeded — navigate to the main app, preserving any `?prompt=`
    // forwarded from the public homepage's "try these questions" CTA.
    const prompt = new URLSearchParams(window.location.search).get("prompt");
    navigate(prompt ? `/search?prompt=${encodeURIComponent(prompt)}` : "/search");
  }, [navigate]);

  const handleRetrySync = useCallback(() => {
    if (!sessionRef.current) {
      // Defensive: if for some reason we lost the session, fall back to
      // restarting OAuth rather than retrying with a null session.
      navigate("/auth");
      return;
    }
    setStatus("loading");
    setErrorMessage("");
    syncAndNavigate(sessionRef.current);
  }, [navigate, syncAndNavigate]);

  useEffect(() => {
    async function handleCallback() {
      if (exchangeInitiated.current) return;
      exchangeInitiated.current = true;

      try {
        // 1. Use an existing session if one is already in storage (HMR or a
        //    pre-exchanged callback). Skips re-exchange and goes straight to
        //    the backend sync.
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession) {
          console.log("[auth-callback] Session already exists in client, syncing...");
          await syncAndNavigate(existingSession);
          return;
        }

        // 2. Extract the PKCE code from the URL.
        const code = new URLSearchParams(window.location.search).get("code");
        if (!code) {
          setErrorMessage("No authentication code found in the callback URL.");
          setStatus("exchange-error");
          return;
        }

        // 3. Exchange the code for a session.
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error || !data.session) {
          // The exchange call has been observed to fail spuriously while a
          // session was nonetheless created — check storage one more time
          // before declaring failure.
          const { data: { session: backupSession } } = await supabase.auth.getSession();
          if (backupSession) {
            console.log("[auth-callback] Exchange returned error but session is present, continuing...");
            await syncAndNavigate(backupSession);
            return;
          }

          console.error("[auth-callback] Exchange code failed:", error);
          setErrorMessage(error?.message || "Authentication failed. Please try again.");
          setStatus("exchange-error");
          return;
        }

        // 4. Hand the fresh session to the sync step.
        await syncAndNavigate(data.session);
      } catch (err: unknown) {
        console.error("[auth-callback] Unexpected error:", err);
        setErrorMessage("An unexpected error occurred. Please try again.");
        setStatus("exchange-error");
      }
    }

    handleCallback();
  }, [syncAndNavigate]);

  if (status === "exchange-error" || status === "sync-error") {
    const isSyncError = status === "sync-error";
    return (
      <div className="flex min-h-[80vh] items-center justify-center p-6 relative z-10">
        <Card className="w-full max-w-md bg-gradient-to-b from-card/85 to-card border border-destructive/20 shadow-xl backdrop-blur-md">
          <CardHeader className="text-center py-8 gap-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-2">
              <AlertCircle className="size-7" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight text-destructive">
              {isSyncError ? "Couldn't finish signing in" : "Authentication failed"}
            </CardTitle>
            <CardDescription className="max-w-xs mx-auto">
              {errorMessage}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col items-center gap-3 pb-8">
            {isSyncError ? (
              <>
                <Button onClick={handleRetrySync} className="px-6 py-5 cursor-pointer">
                  Retry
                </Button>
                <button
                  type="button"
                  onClick={() => navigate("/auth")}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Or sign in again
                </button>
              </>
            ) : (
              <Button onClick={() => navigate("/auth")} className="px-6 py-5 cursor-pointer">
                Try again
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-6 relative z-10">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-muted-foreground text-sm font-semibold animate-pulse">
          Completing sign in...
        </p>
      </div>
    </div>
  );
}
