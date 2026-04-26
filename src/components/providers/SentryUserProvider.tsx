"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import * as Sentry from "@sentry/nextjs";

/**
 * Sets the Sentry user context from the NextAuth session.
 * All subsequent Sentry events (errors, messages) will include
 * the user ID and email, making it easy to identify which user
 * is affected by issues like DB corruption.
 */
export function SentryUserProvider() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user?.id) {
      Sentry.setUser({
        id: session.user.id,
        email: session.user.email ?? undefined,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [session?.user?.id, session?.user?.email]);

  return null;
}
