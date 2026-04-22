import type { RequestStatus, RequestType, Role } from "@/types";

export type WorkflowAction = "approve" | "deny" | "acknowledge";

/**
 * Whether a user's role can act on a request assigned to the given role.
 * Platoon sergeant CANNOT act on platoon_commander assignments.
 */
function matchesAssignment(userRole: Role, assignedRole: Role): boolean {
  if (userRole === assignedRole) return true;
  return false;
}

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

  // Squad commander creates → assigned to platoon commander
  // Platoon commander approves/denies → assigned to squad commander for acknowledgment

  if (currentAssignedRole === "platoon_commander") {
    if (action === "approve" && currentStatus === "open") {
      return { newStatus: "approved", newAssignedRole: "squad_commander" };
    }
    if (action === "deny" && currentStatus === "open") {
      return { newStatus: "denied", newAssignedRole: "squad_commander" };
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
  return matchesAssignment(userRole, assignedRole);
}

/**
 * Validate that a (status, assignedRole) transition is reachable via some valid
 * workflow action. Used to guard the connector path where the client sends the
 * resulting state rather than the action name.
 */
export function isValidTransition(
  currentStatus: RequestStatus,
  currentAssignedRole: Role | null,
  newStatus: RequestStatus | undefined,
  newAssignedRole: Role | null | undefined,
  requestType: RequestType,
): boolean {
  // If neither field changed, it's a field-only edit — always valid.
  if (newStatus === undefined && newAssignedRole === undefined) return true;

  const targetStatus = newStatus ?? currentStatus;
  const targetRole = newAssignedRole !== undefined ? newAssignedRole : currentAssignedRole;

  // If nothing actually changed, it's a no-op — allow it.
  if (targetStatus === currentStatus && targetRole === currentAssignedRole) return true;

  // Must have a current assigned role for any workflow action.
  if (!currentAssignedRole) return false;

  // Check if any valid action produces this exact transition.
  const actions: WorkflowAction[] = ["approve", "deny", "acknowledge"];
  for (const action of actions) {
    const transition = getNextState(currentStatus, currentAssignedRole, action, requestType);
    if (
      transition &&
      transition.newStatus === targetStatus &&
      transition.newAssignedRole === targetRole
    ) {
      return true;
    }
  }
  return false;
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
  if (!currentAssignedRole || !matchesAssignment(userRole, currentAssignedRole)) return [];

  const actions: WorkflowAction[] = [];

  if (currentStatus === "open") {
    if (currentAssignedRole === "platoon_commander") {
      actions.push("approve", "deny");
    }
  }

  if (currentStatus === "approved" || currentStatus === "denied") {
    if (currentAssignedRole === "squad_commander") {
      actions.push("acknowledge");
    }
  }

  // Filter out actions that don't produce valid transitions
  return actions.filter(
    (a) => getNextState(currentStatus, currentAssignedRole, a, requestType) !== null,
  );
}
