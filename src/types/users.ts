/** Shared types for user management pages (admin + commanders). */

export type UserAssignment = {
  id: string;
  role: string;
  unitType: string;
  unitId: string;
  unitName: string;
  cycleId: string;
  cycle: { name: string; isActive: boolean };
};

export type CommanderEventSummary = {
  id: string;
  cycleId: string;
  name: string;
  description: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

export type ManagedUser = {
  id: string;
  givenName: string;
  familyName: string;
  email: string | null;
  phone: string | null;
  rank: string | null;
  isAdmin: boolean;
  cycleAssignments: UserAssignment[];
  commanderEvents?: CommanderEventSummary[];
};

export type ManagedInvitation = {
  id: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  roleLabel: string;
  unitName: string;
  cycleName: string;
  expiresAt: string;
  inviteUrl: string;
  invitedByUserId: string | null;
};

export type UnitStructure = {
  squad: { id: string; name: string };
  platoon: { id: string; name: string; squads: { id: string; name: string }[] };
  company: { id: string; name: string; platoons: { id: string; name: string; squads: { id: string; name: string }[] }[] };
};
