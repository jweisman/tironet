import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { sendPushToUser } from "@/lib/push/send";

/**
 * POST — send a test push notification to the authenticated user.
 * Returns detailed results for each subscription attempt.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const result = await sendPushToUser(userId, {
      title: "הודעת בדיקה",
      body: "אם אתה רואה הודעה זו, ההתראות עובדות!",
      url: "/support",
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e) {
    console.error("[push/test] failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
