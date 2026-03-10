import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";

const { auth } = NextAuth(authConfig);

export const proxy = auth;

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|icons|favicon.ico|manifest.json).*)",
  ],
};
