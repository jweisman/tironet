import { NextRequest } from "next/server";
import type { SessionUser, CycleAssignment, Role } from "@/types";

/**
 * Create a mock NextRequest for testing API route handlers.
 */
export function createMockRequest(
  method: string,
  url: string,
  body?: Record<string, unknown>,
  searchParams?: Record<string, string>
): NextRequest {
  const fullUrl = new URL(url, "http://localhost:3000");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      fullUrl.searchParams.set(key, value);
    }
  }
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(fullUrl, init as import("next/dist/server/web/spec-extension/request").RequestInit);
}

/**
 * Build a mock SessionUser for testing.
 */
export function mockSessionUser(
  overrides: Partial<SessionUser> & { isAdmin?: boolean } = {}
): SessionUser {
  return {
    id: "user-1",
    email: "test@example.com",
    givenName: "Test",
    familyName: "User",
    rank: "סגן",
    isAdmin: false,
    cycleAssignments: [],
    ...overrides,
  };
}

/**
 * Build a mock CycleAssignment.
 */
export function mockAssignment(
  overrides: Partial<CycleAssignment> = {}
): CycleAssignment {
  return {
    cycleId: "cycle-1",
    cycleName: "Test Cycle",
    cycleIsActive: true,
    role: "platoon_commander" as Role,
    unitType: "platoon",
    unitId: "platoon-1",
    ...overrides,
  };
}
