// Mirrors the Prisma enums — re-exported here so non-Prisma code
// (client components, utility functions) can import without pulling in the
// generated client bundle.

export type Role =
  | "company_commander"
  | "deputy_company_commander"
  | "platoon_commander"
  | "platoon_sergeant"
  | "squad_commander";

export type UnitType = "company" | "platoon" | "squad";

export type SoldierStatus = "active" | "transferred" | "dropped" | "injured";

export type ActivityStatus = "draft" | "active";

export type ActivityResult = "passed" | "failed" | "na";

export type RequestType = "leave" | "medical" | "hardship";

export type RequestStatus = "open" | "approved" | "denied";

export type RequestActionType = "create" | "approve" | "deny" | "acknowledge";

export type Transportation =
  | "public_transit"
  | "shuttle"
  | "military_transport"
  | "other";

// Serializable cycle assignment carried in the JWT and session
export interface CycleAssignment {
  cycleId: string;
  cycleName: string;
  cycleIsActive: boolean;
  role: Role;
  unitType: UnitType;
  unitId: string;
}

// Augmented session user (next-auth session.user)
export interface SessionUser {
  id: string;
  email: string | null;
  givenName: string;
  familyName: string;
  rank?: string | null;
  isAdmin: boolean;
  cycleAssignments: CycleAssignment[];
}

// Gap record (computed, never stored)
export interface Gap {
  soldierId: string;
  soldierName: string;
  activityId: string;
  activityName: string;
  result: "failed" | null; // null = missing
}
