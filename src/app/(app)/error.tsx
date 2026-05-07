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
    </div>
  );
}
