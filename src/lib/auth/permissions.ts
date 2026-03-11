import type { Role } from "@/types";

export const RANKS = ["טוראי", 'רב"ט', "סמל", 'סמ"ר', 'סג"מ', "סגן", "סרן", 'רס"ן'];

const ROLE_RANK: Record<Role, number> = {
  company_commander: 3,
  platoon_commander: 2,
  squad_commander: 1,
};

export const ROLE_LABELS: Record<Role, string> = {
  company_commander: 'מ"פ',
  platoon_commander: 'מ"מ',
  squad_commander: 'מ"כ',
};

export const UNIT_TYPE_FOR_ROLE: Record<Role, "company" | "platoon" | "squad"> = {
  company_commander: "company",
  platoon_commander: "platoon",
  squad_commander: "squad",
};

/** Returns which roles the given role (or admin) can invite. */
export function rolesInvitableBy(inviterRole: Role | null, isAdmin: boolean): Role[] {
  if (isAdmin) return Object.keys(ROLE_RANK) as Role[];
  if (!inviterRole) return [];
  return (Object.keys(ROLE_RANK) as Role[]).filter(
    (r) => ROLE_RANK[inviterRole] > ROLE_RANK[r]
  );
}

/** Returns true if the inviter can assign the target role. */
export function canInviteRole(inviterRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[inviterRole] > ROLE_RANK[targetRole];
}
