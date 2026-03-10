import { auth } from "@/lib/auth/auth";
import { NextResponse } from "next/server";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }),
      session: null,
    };
  }
  return { error: null, session };
}
