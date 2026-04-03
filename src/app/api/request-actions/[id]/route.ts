import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { z } from "zod";

const patchSchema = z.object({
  note: z.string().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const action = await prisma.requestAction.findUnique({
    where: { id },
    include: { request: { select: { assignedRole: true } } },
  });

  if (!action) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Users can only edit their own notes
  if (action.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cannot edit notes on completed requests
  if (action.request.assignedRole === null) {
    return NextResponse.json(
      { error: "Cannot edit notes on completed requests" },
      { status: 400 },
    );
  }

  const updated = await prisma.requestAction.update({
    where: { id },
    data: { note: parsed.data.note },
  });

  return NextResponse.json({ action: updated });
}
