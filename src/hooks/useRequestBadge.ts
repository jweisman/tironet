"use client";

import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { useCycle } from "@/contexts/CycleContext";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

/**
 * Returns the count of requests assigned to the current user's effective role
 * that require action, scoped to the user's unit.
 *
 * Squad commanders only see their own squad's requests; higher roles are
 * naturally scoped by the PowerSync sync streams (platoon/company).
 */
const BADGE_QUERY = `
  SELECT COUNT(*) as count
  FROM requests r
  JOIN soldiers s ON s.id = r.soldier_id
  JOIN squads sq ON sq.id = s.squad_id
  WHERE r.cycle_id = ?
    AND r.assigned_role = ?
    AND (? = '' OR s.squad_id = ?)
`;

export function useRequestBadge(): number {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const rawRole = selectedAssignment?.role ?? "";
  const role = rawRole ? effectiveRole(rawRole as Role) : "";
  const squadFilter =
    role === "squad_commander" ? (selectedAssignment?.unitId ?? "") : "";
  const params = useMemo(
    () => [selectedCycleId ?? "", role, squadFilter, squadFilter],
    [selectedCycleId, role, squadFilter],
  );
  const { data } = useQuery<{ count: number }>(BADGE_QUERY, params);

  if (!selectedCycleId || !role) return 0;
  return Number(data?.[0]?.count ?? 0);
}
