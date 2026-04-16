import type { DefaultSession } from "next-auth";
import type { CycleAssignment } from "./index";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      givenName: string;
      familyName: string;
      rank?: string | null;
      isAdmin: boolean;
      phone?: string | null;
      profileImageVersion?: string;
      cycleAssignments: CycleAssignment[];
      // PowerSync sync-rule claims (populated from JWT, used by /api/powersync/token)
      cycle_ids: string[];
      squad_ids: string[];
      platoon_ids: string[];
      company_ids: string[];
    } & DefaultSession["user"];
  }
}
