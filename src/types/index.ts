// Mirrors the Prisma enums — re-exported here so non-Prisma code
// (client components, utility functions) can import without pulling in the
// generated client bundle.

export type Role =
  | "company_commander"
  | "platoon_commander"
  | "squad_commander";

export type UnitType = "company" | "platoon" | "squad";

export type SoldierStatus = "active" | "transferred" | "dropped" | "injured";

export type ActivityStatus = "draft" | "active";

export type ActivityResult = "passed" | "failed" | "na";

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
