import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { requireAdmin } from "../admin-guard";
import { auth } from "@/lib/auth/auth";

const mockAuth = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdmin", () => {
  it("returns 403 when no session", async () => {
    mockAuth.mockResolvedValue(null as never);

    const result = await requireAdmin();
    expect(result.error).not.toBeNull();
    expect(result.session).toBeNull();

    const body = await result.error!.json();
    expect(body.error).toBe("Unauthorized");
    expect(result.error!.status).toBe(403);
  });

  it("returns 403 when user is not admin", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", isAdmin: false },
    } as never);

    const result = await requireAdmin();
    expect(result.error).not.toBeNull();
    expect(result.session).toBeNull();
  });

  it("returns session when user is admin", async () => {
    const session = { user: { id: "user-1", isAdmin: true } };
    mockAuth.mockResolvedValue(session as never);

    const result = await requireAdmin();
    expect(result.error).toBeNull();
    expect(result.session).toBe(session);
  });
});
