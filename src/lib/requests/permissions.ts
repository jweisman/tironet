import { effectiveRole } from "@/lib/auth/permissions";
import type { RequestType, Role } from "@/types";

/**
 * Determines whether a user with the given role can edit a request of the given type.
 * Based purely on role — not on workflow state.
 */
export function canEditRequest(userRole: Role, requestType: RequestType): boolean {
  const eff = effectiveRole(userRole);
  if (eff === "platoon_commander" || eff === "company_commander") return true;
  if (userRole === "company_medic" && requestType === "medical") return true;
  if (userRole === "hardship_coordinator" && requestType === "hardship") return true;
  return false;
}

/**
 * Determines whether a user can delete a request.
 * Same role rules as editing, but only for open requests (assignedRole !== null).
 */
export function canDeleteRequest(
  userRole: Role,
  requestType: RequestType,
  assignedRole: Role | null,
): boolean {
  if (assignedRole === null) return false;
  return canEditRequest(userRole, requestType);
}
