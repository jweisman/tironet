import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { getRequestScope } from "@/lib/api/request-scope";
import { z } from "zod";
import type { SessionUser } from "@/types";

const createSchema = z.object({
  id: z.string().uuid().optional(),
  requestId: z.string().uuid(),
  action: z.enum(["create", "approve", "deny", "acknowledge", "note"]),
  note: z.string().nullable().optional(),
  userName: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const sessionUser = session.user as SessionUser;

  // Verify the request exists and user has scope access
  const req = await prisma.request.findUnique({ where: { id: data.requestId } });
  if (!req) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const { scope, error } = await getRequestScope(req.cycleId);
  if (error || !scope) return error!;
  if (!scope.soldierIds.includes(req.soldierId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userName = data.userName || `${sessionUser.familyName} ${sessionUser.givenName}`;

  const action = await prisma.requestAction.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      requestId: data.requestId,
      userId: sessionUser.id,
      action: data.action,
      note: data.note ?? null,
      userName,
    },
  });

  return NextResponse.json({ action }, { status: 201 });
}
