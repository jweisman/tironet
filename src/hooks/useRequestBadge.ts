"use client";

import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { useCycle } from "@/contexts/CycleContext";

/**
 * Returns the count of requests assigned to the current user's role
 * that require action (i.e. the badge count for the Requests tab).
 */
const BADGE_QUERY = `
  SELECT COUNT(*) as count
  FROM requests r
  WHERE r.cycle_id = ?
    AND r.assigned_role = ?
`;

export function useRequestBadge(): number {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const role = selectedAssignment?.role ?? "";
  const params = useMemo(
    () => [selectedCycleId ?? "", role],
    [selectedCycleId, role],
  );
  const { data } = useQuery<{ count: number }>(BADGE_QUERY, params);

  if (!selectedCycleId || !role) return 0;
  return Number(data?.[0]?.count ?? 0);
}
