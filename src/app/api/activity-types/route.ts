import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const types = await prisma.activityType.findMany({
    where: { isActive: true },
    select: { id: true, name: true, icon: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(types);
}
