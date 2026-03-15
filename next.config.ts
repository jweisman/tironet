import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withPWA from "@ducanh2912/next-pwa";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const pwaConfig = withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    // Exclude PowerSync worker assets — PowerSync manages its own worker lifecycle.
    // Exclude API routes — they require live auth tokens and must never be served stale.
    exclude: [/\/@powersync\//, /\/api\//],
  },
});

const nextConfig: NextConfig = {
  // Allow external profile pictures from Google OAuth
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },

  // Serve PowerSync WASM worker assets (copied to public/ by postinstall).
  // These are large binary files — mark them as immutable with long cache headers.
  async headers() {
    return [
      {
        source: "/@powersync/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default pwaConfig(withNextIntl(nextConfig));
