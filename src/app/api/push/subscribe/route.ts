import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/**
 * POST — save a push subscription for the authenticated user.
 * If a subscription with the same endpoint already exists, update it.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;

  await prisma.$transaction([
    prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: session.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      update: {
        userId: session.user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    }),
    // Ensure the user has a notification preferences row (both enabled by default)
    prisma.notificationPreference.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id },
      update: {},
    }),
  ]);

  return NextResponse.json({ ok: true });
}

/**
 * DELETE — remove a push subscription by endpoint.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const endpoint = z.string().url().safeParse(body.endpoint);
  if (!endpoint.success) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const userId = session.user.id;

  await prisma.pushSubscription.deleteMany({
    where: { endpoint: endpoint.data, userId },
  });

  // If this was the user's last subscription, remove their preference row
  const remaining = await prisma.pushSubscription.count({ where: { userId } });
  if (remaining === 0) {
    await prisma.notificationPreference.deleteMany({ where: { userId } });
  }

  return NextResponse.json({ ok: true });
}
