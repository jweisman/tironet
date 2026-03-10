// Lightweight NextAuth config — no Prisma adapter, edge-compatible.
// Used by proxy.ts only. The full config (with adapter) is in auth.ts.
// NOTE: Nodemailer is intentionally omitted here — email providers require an
// adapter which is not available at the edge. Sign-in flows are handled by the
// API route which uses the full auth.ts config.
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const authConfig: NextAuthConfig = {
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      // Redirect authenticated users from landing/login to /home
      if (isLoggedIn && (pathname === "/" || pathname === "/login")) {
        return Response.redirect(new URL("/home", nextUrl));
      }

      // Protected routes require authentication
      const protectedPrefixes = [
        "/home",
        "/soldiers",
        "/activities",
        "/profile",
        "/admin",
      ];
      const isProtected = protectedPrefixes.some((p) =>
        pathname.startsWith(p)
      );
      if (isProtected && !isLoggedIn) {
        const loginUrl = new URL("/login", nextUrl);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return Response.redirect(loginUrl);
      }

      return true;
    },
  },
};
