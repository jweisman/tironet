import { describe, it, expect, vi, beforeEach } from "vitest";
import * as jose from "jose";

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { mockSessionUser } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
const TEST_POWERSYNC_URL = "http://localhost:8080";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.POWERSYNC_JWT_SECRET = TEST_SECRET;
  process.env.NEXT_PUBLIC_POWERSYNC_URL = TEST_POWERSYNC_URL;
});

describe("GET /api/powersync/token", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when session has no user.id", async () => {
    mockAuth.mockResolvedValue({
      user: { id: undefined },
    } as never);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 500 when POWERSYNC_JWT_SECRET is not set", async () => {
    delete process.env.POWERSYNC_JWT_SECRET;

    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        id: "user-1",
        cycleAssignments: [],
      }),
    } as never);

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("POWERSYNC_JWT_SECRET not configured");
  });

  it("returns signed JWT with correct claims", async () => {
    const user = mockSessionUser({
      id: "user-1",
      cycle_ids: ["cycle-1", "cycle-2"],
      platoon_ids: ["platoon-1", "platoon-2"],
      squad_id: "squad-1",
    } as never);

    mockAuth.mockResolvedValue({ user } as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.powersync_url).toBe(TEST_POWERSYNC_URL);
    expect(body.token).toBeDefined();

    // Verify the JWT
    const secret = new TextEncoder().encode(TEST_SECRET);
    const { payload } = await jose.jwtVerify(body.token, secret, {
      audience: TEST_POWERSYNC_URL,
    });

    expect(payload.sub).toBe("user-1");
    expect(payload.aud).toBe(TEST_POWERSYNC_URL);
    expect(payload.cycle_ids).toEqual(["cycle-1", "cycle-2"]);
    expect(payload.platoon_ids).toEqual(["platoon-1", "platoon-2"]);
    expect(payload.squad_id).toBe("squad-1");
    // Verify expiration is approximately 5 minutes from now
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(now);
    expect(payload.exp).toBeLessThanOrEqual(now + 300 + 5); // 5m + small buffer
  });

  it("returns default empty claims when user has no assignments", async () => {
    const user = mockSessionUser({ id: "user-2" });
    // The route reads cycle_ids, platoon_ids, squad_id from session.user
    // These default to [], [], null when not present
    mockAuth.mockResolvedValue({ user } as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    const secret = new TextEncoder().encode(TEST_SECRET);
    const { payload } = await jose.jwtVerify(body.token, secret, {
      audience: TEST_POWERSYNC_URL,
    });

    expect(payload.sub).toBe("user-2");
    expect(payload.cycle_ids).toEqual([]);
    expect(payload.platoon_ids).toEqual([]);
    expect(payload.squad_id).toBeNull();
  });

  it("uses HS256 algorithm with kid header", async () => {
    const user = mockSessionUser({ id: "user-1" });
    mockAuth.mockResolvedValue({ user } as never);

    const res = await GET();
    const body = await res.json();

    const secret = new TextEncoder().encode(TEST_SECRET);
    const { protectedHeader } = await jose.jwtVerify(body.token, secret, {
      audience: TEST_POWERSYNC_URL,
    });

    expect(protectedHeader.alg).toBe("HS256");
    expect(protectedHeader.kid).toBe("tironet-dev");
  });
});
