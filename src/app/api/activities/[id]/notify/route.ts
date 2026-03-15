import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { sendEmail } from "@/lib/email/send";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: activityId } = await params;

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      activityType: { select: { name: true, icon: true } },
      platoon: {
        select: {
          id: true,
          name: true,
          squads: { select: { id: true } },
        },
      },
    },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const { scope, error } = await getActivityScope(activity.cycleId);
  if (error || !scope) return error!;

  // Only platoon_commander for their platoon or admin can notify
  if (!scope.canEditMetadataForPlatoon(activity.platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const squadIds = activity.platoon.squads.map((s) => s.id);

  // Find all squad commanders for these squads in this cycle
  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      cycleId: activity.cycleId,
      role: "squad_commander",
      unitId: { in: squadIds },
    },
    include: {
      user: { select: { email: true, givenName: true, familyName: true } },
    },
  });

  if (assignments.length === 0) {
    return NextResponse.json({ notified: 0 });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const activityUrl = `${baseUrl}/activities/${activityId}`;

  const dateStr = activity.date instanceof Date
    ? activity.date.toLocaleDateString("he-IL", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : String(activity.date);

  let notified = 0;

  for (const assignment of assignments) {
    try {
      await sendEmail({
        to: assignment.user.email,
        subject: `[טירונט] פעילות חדשה: ${activity.name}`,
        html: `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; direction: rtl; color: #1a1a1a; }
    .container { max-width: 600px; margin: 0 auto; padding: 24px; }
    .header { background: #f59e0b; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0; }
    .content { background: #fff; border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 8px 8px; }
    .field { margin-bottom: 12px; }
    .label { font-size: 12px; color: #6b7280; margin-bottom: 2px; }
    .value { font-size: 16px; font-weight: 500; }
    .btn { display: inline-block; background: #f59e0b; color: white; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin:0">פעילות חדשה נוצרה</h2>
    </div>
    <div class="content">
      <p>שלום ${assignment.user.givenName},</p>
      <p>פעילות חדשה נוצרה עבור הפלוגה שלך:</p>

      <div class="field">
        <div class="label">שם הפעילות</div>
        <div class="value">${activity.activityType.icon} ${activity.name}</div>
      </div>

      <div class="field">
        <div class="label">סוג פעילות</div>
        <div class="value">${activity.activityType.name}</div>
      </div>

      <div class="field">
        <div class="label">תאריך</div>
        <div class="value">${dateStr}</div>
      </div>

      <div class="field">
        <div class="label">מחלקה</div>
        <div class="value">${activity.platoon.name}</div>
      </div>

      <a href="${activityUrl}" class="btn">עבור לפעילות</a>
    </div>
  </div>
</body>
</html>
        `.trim(),
      });
      notified++;
    } catch {
      // Continue notifying others even if one fails
    }
  }

  return NextResponse.json({ notified });
}
