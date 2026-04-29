"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCycle } from "@/contexts/CycleContext";
import { effectiveRole, rolesInvitableBy } from "@/lib/auth/permissions";
import { CommanderUsersPanel } from "@/components/CommanderUsersPanel";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { usersTourSteps } from "@/lib/tour/steps";
import type { Role } from "@/types";

export default function UsersPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const { selectedCycleId, selectedAssignment, isLoading: cycleLoading } = useCycle();
  const expandUserId = searchParams.get("expand");
  const [data, setData] = useState<{
    users: Parameters<typeof CommanderUsersPanel>[0]["initialUsers"];
    invitations: Parameters<typeof CommanderUsersPanel>[0]["initialInvitations"];
    structureByCycle: Parameters<typeof CommanderUsersPanel>[0]["structureByCycle"];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCycleId || !session?.user) return;
    setLoading(true);
    fetch(`/api/users/hierarchy?cycleId=${selectedCycleId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [selectedCycleId, session?.user]);

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "users", steps: usersTourSteps, ready: !loading && !!data && data.users.length > 0 });
  useEffect(() => { registerTour(startTour); return unregisterTour; }, [registerTour, unregisterTour, startTour]);

  if (cycleLoading || loading) return null;

  if (!session?.user || !selectedAssignment) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-6">מפקדים</h1>
        <p className="text-sm text-muted-foreground">אינך מוגדר כמפקד מחלקה או פלוגה.</p>
      </div>
    );
  }

  const eRole = effectiveRole(selectedAssignment.role as Role);
  if (eRole !== "company_commander" && eRole !== "platoon_commander") {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-6">מפקדים</h1>
        <p className="text-sm text-muted-foreground">אינך מוגדר כמפקד מחלקה או פלוגה.</p>
      </div>
    );
  }

  // Compute invitable roles for the current assignment
  const invitableRoles = rolesInvitableBy(selectedAssignment.role as Role, false);

  if (!data) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-6">מפקדים</h1>
      <CommanderUsersPanel
        initialUsers={data.users}
        initialInvitations={data.invitations}
        cycleId={selectedCycleId!}
        structureByCycle={data.structureByCycle}
        invitableRoles={invitableRoles}
        currentUserId={session.user.id}
        isAdmin={session.user.isAdmin ?? false}
        expandUserId={expandUserId}
      />
    </div>
  );
}
