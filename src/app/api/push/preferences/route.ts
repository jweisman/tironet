import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

const patchSchema = z.object({
  dailyTasksEnabled: z.boolean().optional(),
  requestAssignmentEnabled: z.boolean().optional(),
});

/**
 * GET — return the user's notification preferences.
 * Returns defaults (both enabled) if no row exists yet.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({
    dailyTasksEnabled: pref?.dailyTasksEnabled ?? true,
    requestAssignmentEnabled: pref?.requestAssignmentEnabled ?? true,
  });
}

/**
 * PATCH — update the user's notification preferences (upsert).
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const pref = await prisma.notificationPreference.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      ...parsed.data,
    },
    update: parsed.data,
  });

  return NextResponse.json({
    dailyTasksEnabled: pref.dailyTasksEnabled,
    requestAssignmentEnabled: pref.requestAssignmentEnabled,
  });
}
