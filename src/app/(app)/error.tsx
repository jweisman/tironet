"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-4">
      <h2 className="text-xl font-semibold">משהו השתבש</h2>
      <p className="text-muted-foreground text-sm max-w-md">
        אירעה שגיאה בלתי צפויה. ניתן לנסות שוב או לחזור לדף הבית.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>נסה שוב</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/home")}>
          דף הבית
        </Button>
      </div>
      {/* TEMPORARY: staging-only debug panel for issue #160. Remove before
          merging — exposes stack traces to anyone who hits an error. */}
      <details className="mt-4 w-full max-w-lg text-left" dir="ltr">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Debug details
        </summary>
        <pre
          className="mt-2 max-h-72 overflow-auto rounded border border-border bg-muted/50 p-3 text-[11px] leading-tight whitespace-pre-wrap break-all"
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          {`name: ${error.name}\n`}
          {`message: ${error.message}\n`}
          {error.digest ? `digest: ${error.digest}\n` : ""}
          {`url: ${typeof window !== "undefined" ? window.location.href : ""}\n`}
          {`ua: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}\n`}
          {`online: ${typeof navigator !== "undefined" ? navigator.onLine : "?"}\n`}
          {`time: ${new Date().toISOString()}\n\n`}
          {error.stack ?? "(no stack)"}
        </pre>
        <button
          type="button"
          onClick={() => {
            const text = [
              `name: ${error.name}`,
              `message: ${error.message}`,
              error.digest ? `digest: ${error.digest}` : "",
              `url: ${typeof window !== "undefined" ? window.location.href : ""}`,
              `ua: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
              `online: ${typeof navigator !== "undefined" ? navigator.onLine : "?"}`,
              `time: ${new Date().toISOString()}`,
              "",
              error.stack ?? "(no stack)",
            ].filter(Boolean).join("\n");
            navigator.clipboard?.writeText(text).catch(() => {});
          }}
          className="mt-2 text-xs underline text-muted-foreground"
        >
          Copy to clipboard
        </button>
      </details>
    </div>
  );
}
