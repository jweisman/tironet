"use client";

import { useSession } from "next-auth/react";
import { useCycle } from "@/contexts/CycleContext";
import { CyclePicker } from "@/components/CyclePicker";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export default function HomePage() {
  const { data: session } = useSession();
  const { selectedAssignment, activeCycles } = useCycle();

  const isAdmin = session?.user?.isAdmin;

  // Non-admin with no active cycles
  if (!isAdmin && activeCycles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">אין לך גישה למחזור פעיל</p>
        <p className="text-muted-foreground text-sm">פנה למפקד שלך כדי לקבל הזמנה.</p>
      </div>
    );
  }

  // Multiple active cycles and none selected yet
  if (!selectedAssignment && activeCycles.length > 1) {
    return <CyclePicker />;
  }

  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-bold">
        שלום, {session?.user?.givenName}
      </h1>
      {selectedAssignment ? (
        <p className="text-muted-foreground">
          {ROLE_LABELS[selectedAssignment.role as Role]} — {selectedAssignment.cycleName}
        </p>
      ) : isAdmin ? (
        <p className="text-muted-foreground">מנהל מערכת</p>
      ) : null}
      <p className="mt-6 text-muted-foreground">לוח הבקרה יבנה בשלב 6</p>
    </div>
  );
}
