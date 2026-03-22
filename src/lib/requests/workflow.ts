import type { RequestStatus, RequestType, Role } from "@/types";

export type WorkflowAction = "approve" | "deny" | "acknowledge";

interface Transition {
  newStatus: RequestStatus;
  newAssignedRole: Role | null; // null = no assignment (workflow complete)
}

/**
 * Compute the next state for a request given the current state and action.
 * Returns null if the transition is invalid.
 */
export function getNextState(
  currentStatus: RequestStatus,
  currentAssignedRole: Role,
  action: WorkflowAction,
  requestType: RequestType,
): Transition | null {
  // Only open requests can be approved/denied
  if (action === "approve" || action === "deny") {
    if (currentStatus !== "open" && action === "approve") return null;
  }

  // Squad commander opens → assigned to platoon commander
  // Platoon commander opens → assigned to company commander (skip platoon approval)

  if (currentAssignedRole === "platoon_commander") {
    if (action === "approve" && currentStatus === "open") {
      // Hardship skips company commander
      if (requestType === "hardship") {
        return { newStatus: "approved", newAssignedRole: "squad_commander" };
      }
      // Normal: advance to company commander
      return { newStatus: "open", newAssignedRole: "company_commander" };
    }
    if (action === "deny" && currentStatus === "open") {
      return { newStatus: "denied", newAssignedRole: "squad_commander" };
    }
    // Acknowledge approved/denied from company commander
    if (action === "acknowledge" && (currentStatus === "approved" || currentStatus === "denied")) {
      return { newStatus: currentStatus, newAssignedRole: "squad_commander" };
    }
  }

  if (currentAssignedRole === "company_commander") {
    if (action === "approve" && currentStatus === "open") {
      return { newStatus: "approved", newAssignedRole: "platoon_commander" };
    }
    if (action === "deny" && currentStatus === "open") {
      return { newStatus: "denied", newAssignedRole: "platoon_commander" };
    }
  }

  if (currentAssignedRole === "squad_commander") {
    // Acknowledge final result (approved/denied that was passed down)
    if (action === "acknowledge" && (currentStatus === "approved" || currentStatus === "denied")) {
      return { newStatus: currentStatus, newAssignedRole: null };
    }
  }

  return null;
}

/**
 * Check if the given role can perform any action on a request with this assignment.
 */
export function canActOnRequest(
  userRole: Role,
  assignedRole: Role,
): boolean {
  return userRole === assignedRole;
}

/**
 * Get available actions for a role on a request in a given state.
 */
export function getAvailableActions(
  currentStatus: RequestStatus,
  currentAssignedRole: Role | null,
  userRole: Role,
  requestType: RequestType,
): WorkflowAction[] {
  if (!currentAssignedRole || userRole !== currentAssignedRole) return [];

  const actions: WorkflowAction[] = [];

  if (currentStatus === "open") {
    if (
      currentAssignedRole === "platoon_commander" ||
      currentAssignedRole === "company_commander"
    ) {
      actions.push("approve", "deny");
    }
  }

  if (currentStatus === "approved" || currentStatus === "denied") {
    if (
      currentAssignedRole === "platoon_commander" ||
      currentAssignedRole === "squad_commander"
    ) {
      actions.push("acknowledge");
    }
  }

  // Filter out actions that don't produce valid transitions
  return actions.filter(
    (a) => getNextState(currentStatus, currentAssignedRole, a, requestType) !== null,
  );
}
