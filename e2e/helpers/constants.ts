import { readFileSync } from "fs";
import { resolve } from "path";

/** Well-known IDs so tests can reference them directly. */
export const IDS = {
  adminUser: "e2e00000-0000-4000-8000-000000000001",
  platoonCmdUser: "e2e00000-0000-4000-8000-000000000002",
  squadCmdUser: "e2e00000-0000-4000-8000-000000000003",

  cycle: "e2e00000-0000-4000-8000-000000000010",
  company: "e2e00000-0000-4000-8000-000000000020",
  platoon1: "e2e00000-0000-4000-8000-000000000030",
  platoon2: "e2e00000-0000-4000-8000-000000000031",
  squadA: "e2e00000-0000-4000-8000-000000000040",
  squadB: "e2e00000-0000-4000-8000-000000000041",
  squadC: "e2e00000-0000-4000-8000-000000000042",

  activityTypeShooting: "e2e00000-0000-4000-8000-000000000050",
  activityTypeNav: "e2e00000-0000-4000-8000-000000000051",

  activity1: "e2e00000-0000-4000-8000-000000000060",
  activity2: "e2e00000-0000-4000-8000-000000000061",
  activityDraft: "e2e00000-0000-4000-8000-000000000062",
  activityP2: "e2e00000-0000-4000-8000-000000000063",

  soldier1: "e2e00000-0000-4000-8000-000000000070",
  soldier2: "e2e00000-0000-4000-8000-000000000071",
  soldier3: "e2e00000-0000-4000-8000-000000000072",
  soldier4: "e2e00000-0000-4000-8000-000000000073",
  soldier5: "e2e00000-0000-4000-8000-000000000074",
  soldier6: "e2e00000-0000-4000-8000-000000000075",
  soldier7: "e2e00000-0000-4000-8000-000000000076",

  invitation: "e2e00000-0000-4000-8000-000000000080",
  expiredInvitation: "e2e00000-0000-4000-8000-000000000081",
};

export const EMAILS = {
  admin: "admin-e2e@test.com",
  platoonCmd: "platoon-e2e@test.com",
  squadCmd: "squad-e2e@test.com",
  invitee: "new-e2e@test.com",
};

/**
 * Read invitation tokens written by the seed script.
 * The seed script writes them to `.e2e-tokens.json` at the project root.
 */
export function getTokens(): {
  INVITATION_TOKEN: string;
  EXPIRED_INVITATION_TOKEN: string;
} {
  const tokenFile = resolve(process.cwd(), ".e2e-tokens.json");
  return JSON.parse(readFileSync(tokenFile, "utf-8"));
}
