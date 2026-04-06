import type { Role } from "@/types";

export const RANKS = ["טוראי", 'רב"ט', "סמל", 'סמ"ר', 'סג"מ', "סגן", "סרן", 'רס"ן'];

/**
 * Maps deputy roles to their equivalent base role for permission checks.
 * Use this everywhere permissions are evaluated — except request creation
 * routing, where platoon_sergeant has its own routing rule.
 */
export function effectiveRole(role: Role): Role {
  if (role === "deputy_company_commander") return "company_commander";
  if (role === "platoon_sergeant") return "platoon_commander";
  return role;
}

const ROLE_RANK: Record<Role, number> = {
  company_commander: 3,
  deputy_company_commander: 3,
  instructor: 3,
  company_medic: 3,
  platoon_commander: 2,
  platoon_sergeant: 2,
  squad_commander: 1,
};

export const ROLE_LABELS: Record<Role, string> = {
  company_commander: 'מ"פ',
  deputy_company_commander: 'סמ"פ',
  instructor: "מדריך",
  company_medic: 'חופ"ל',
  platoon_commander: 'מ"מ',
  platoon_sergeant: 'סמ"ח',
  squad_commander: 'מ"כ',
};

export const UNIT_TYPE_FOR_ROLE: Record<Role, "company" | "platoon" | "squad"> = {
  company_commander: "company",
  deputy_company_commander: "company",
  instructor: "company",
  company_medic: "company",
  platoon_commander: "platoon",
  platoon_sergeant: "platoon",
  squad_commander: "squad",
};

/** Returns which roles the given role (or admin) can invite. */
export function rolesInvitableBy(inviterRole: Role | null, isAdmin: boolean): Role[] {
  if (isAdmin) return Object.keys(ROLE_RANK) as Role[];
  if (!inviterRole) return [];
  const roles = (Object.keys(ROLE_RANK) as Role[]).filter(
    (r) => ROLE_RANK[inviterRole] > ROLE_RANK[r]
  );
  // Exception: platoon commanders can also invite platoon sergeants
  if (inviterRole === "platoon_commander" && !roles.includes("platoon_sergeant")) {
    roles.push("platoon_sergeant");
  }
  return roles;
}

/** Returns true if the inviter can assign the target role. */
export function canInviteRole(inviterRole: Role, targetRole: Role): boolean {
  if (inviterRole === "platoon_commander" && targetRole === "platoon_sergeant") return true;
  return ROLE_RANK[inviterRole] > ROLE_RANK[targetRole];
}
