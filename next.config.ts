import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSerwist } from "@serwist/turbopack";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy: allow inline styles (Tailwind), data: URIs (base64
// profile images), blob: (WASM workers), Google fonts/images, and PowerSync WS.
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://apis.google.com https://cdn.jsdelivr.net", // unsafe-inline: Next.js hydration scripts; unsafe-eval: wa-sqlite WASM; apis.google.com: Google Picker; cdn.jsdelivr.net: browser-image-compression worker
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Tailwind injects inline styles; Google Fonts for report print
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' http://localhost:* ws://localhost:* https://*.powersync.journeyapps.com wss://*.powersync.journeyapps.com https://accounts.google.com https://sheets.googleapis.com https://www.googleapis.com https://oauth2.googleapis.com https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "frame-src 'self' https://accounts.google.com https://docs.google.com",   // Google OAuth popup + Drive Picker
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "puppeteer-core", "@sparticuz/chromium-min"],
  // Allow external profile pictures from Google OAuth
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },

  async rewrites() {
    return [
      { source: "/privacy", destination: "/privacy.html" },
      { source: "/terms", destination: "/terms.html" },
    ];
  },

  async headers() {
    return [
      // PowerSync WASM assets — immutable, long-lived cache
      {
        source: "/@powersync/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // Security headers for all routes
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspDirectives },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  // Upload source maps for readable stack traces in Sentry
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // Suppress Sentry CLI logs during build
  silent: !process.env.CI,
  // Disable Sentry telemetry
  telemetry: false,
});
