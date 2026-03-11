import Link from "next/link";
import { SessionProvider } from "next-auth/react";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { AcceptInviteButton } from "./AcceptInviteButton";
import type { Role } from "@/types";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { cycle: { select: { name: true } } },
  });

  // Resolve unit name
  let unitName = "";
  if (invitation) {
    if (invitation.unitType === "company") {
      const u = await prisma.company.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
      unitName = u?.name ?? "";
    } else if (invitation.unitType === "platoon") {
      const u = await prisma.platoon.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
      unitName = u?.name ?? "";
    } else {
      const u = await prisma.squad.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
      unitName = u?.name ?? "";
    }
  }

  // Error states
  if (!invitation) {
    return <InviteError message="ההזמנה לא נמצאה." />;
  }
  if (invitation.acceptedAt) {
    return <InviteError message="הזמנה זו כבר נוצלה." />;
  }
  if (invitation.expiresAt < new Date()) {
    return (
      <InviteError message="פג תוקפה של ההזמנה. פנה למפקד שלך לקבלת הזמנה חדשה." />
    );
  }

  const session = await auth();
  const roleLabel = ROLE_LABELS[invitation.role as Role];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">טירונט</h1>
          <p className="text-muted-foreground text-sm">הזמנה להצטרפות</p>
        </div>

        <div className="border rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-base">פרטי ההזמנה</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">תפקיד</span>
              <span className="font-medium">{roleLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">יחידה</span>
              <span className="font-medium">{unitName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">מחזור</span>
              <span className="font-medium">{invitation.cycle.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">אימייל</span>
              <span className="font-medium">{invitation.email}</span>
            </div>
          </div>
        </div>

        {session?.user ? (
          // Already logged in — show accept or mismatch
          session.user.email?.toLowerCase() === invitation.email.toLowerCase() ? (
            <SessionProvider session={session}>
              <AcceptInviteButton token={token} />
            </SessionProvider>
          ) : (
            <div className="text-center space-y-3">
              <p className="text-sm text-destructive">
                אתה מחובר כ-{session.user.email} אך ההזמנה מיועדת ל-{invitation.email}.
              </p>
              <p className="text-xs text-muted-foreground">
                התנתק והתחבר עם האימייל הנכון.
              </p>
            </div>
          )
        ) : (
          // Not logged in — send to login with callbackUrl
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              כדי לקבל את ההזמנה, יש להתחבר עם האימייל {invitation.email}.
            </p>
            <Button render={<Link href={`/login?callbackUrl=/invite/${token}`} />} className="w-full">
              התחבר וקבל הזמנה
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-3">
        <h1 className="text-xl font-bold">טירונט</h1>
        <p className="text-muted-foreground">{message}</p>
        <Button render={<Link href="/home" />} variant="outline">
          חזרה לדף הבית
        </Button>
      </div>
    </div>
  );
}
