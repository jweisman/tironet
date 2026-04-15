import * as Sentry from "@sentry/nextjs";

// Required by Sentry SDK to suppress warning — no-op since tracing is disabled
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only error monitoring — no performance tracing
  tracesSampleRate: 0,

  // Filter out expected offline/network errors
  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value ?? "";
    // PowerSync network errors when offline — expected behavior
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return null;
    }
    return event;
  },
});
