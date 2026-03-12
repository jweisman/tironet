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
      profileImageVersion?: string;
      cycleAssignments: CycleAssignment[];
    } & DefaultSession["user"];
  }
}
