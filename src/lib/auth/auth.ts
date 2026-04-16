import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import Credentials from "next-auth/providers/credentials";
import type { Adapter, AdapterUser, AdapterAccount } from "next-auth/adapters";
import { prisma } from "@/lib/db/prisma";
import { verifySmsOtp } from "@/lib/twilio";
import type { CycleAssignment } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";

// ---------------------------------------------------------------------------
// Adapter — extend PrismaAdapter to map name → givenName/familyName
// The NextAuth Prisma adapter sets { name, email, image } on User, but our
// schema uses { givenName, familyName, profileImage } instead.
// ---------------------------------------------------------------------------

function splitName(name?: string | null): {
  givenName: string;
  familyName: string;
} {
  if (!name?.trim()) return { givenName: "", familyName: "" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { givenName: parts[0], familyName: "" };
  const familyName = parts[parts.length - 1];
  const givenName = parts.slice(0, -1).join(" ");
  return { givenName, familyName };
}

const baseAdapter = PrismaAdapter(prisma);

const tironetAdapter: Adapter = {
  ...baseAdapter,

  async createVerificationToken(data: { identifier: string; token: string; expires: Date }) {
    return prisma.verificationToken.create({ data });
  },

  async useVerificationToken(params: { identifier: string; token: string }) {
    try {
      return await prisma.verificationToken.delete({
        where: { identifier_token: { identifier: params.identifier, token: params.token } },
      });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2025") return null;
      throw error;
    }
  },

  async createUser(data: Omit<AdapterUser, "id">) {
    const { givenName, familyName } = splitName(data.name);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        givenName,
        familyName,
        profileImage: data.image ?? null,
      },
    });
    return {
      ...user,
      name: `${user.givenName} ${user.familyName}`.trim(),
      image: null,
      emailVerified: null,
    } as AdapterUser;
  },

  async getUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    return {
      ...user,
      name: `${user.givenName} ${user.familyName}`.trim(),
      image: null,
      emailVerified: null,
    } as AdapterUser;
  },

  async getUserByEmail(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    return {
      ...user,
      name: `${user.givenName} ${user.familyName}`.trim(),
      image: null,
      emailVerified: null,
    } as AdapterUser;
  },

  async linkAccount(data: AdapterAccount) {
    await prisma.account.create({
      data: {
        userId: data.userId,
        type: data.type,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        refreshToken: data.refresh_token ?? null,
        accessToken: data.access_token ?? null,
        expiresAt: data.expires_at ?? null,
        tokenType: data.token_type ?? null,
        scope: data.scope ?? null,
        idToken: data.id_token ?? null,
        sessionState: (data.session_state as string | undefined) ?? null,
      },
    });
  },

  async updateUser(data: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
    const update: Record<string, unknown> = {};
    if (data.name) {
      const { givenName, familyName } = splitName(data.name);
      update.givenName = givenName;
      update.familyName = familyName;
    }
    if (data.image !== undefined) update.profileImage = data.image;
    const user = await prisma.user.update({
      where: { id: data.id },
      data: update,
    });
    return {
      ...user,
      name: `${user.givenName} ${user.familyName}`.trim(),
      image: null,
      emailVerified: null,
    } as AdapterUser;
  },
};

// ---------------------------------------------------------------------------
// PowerSync JWT claim helpers
//
// Resolves flat arrays of cycle/platoon IDs that the sync rules consume.
// Called inside the JWT callback after cycleAssignments are loaded.
// ---------------------------------------------------------------------------

type RawAssignment = {
  cycleId: string;
  role: string;
  unitType: string;
  unitId: string;
  cycle?: { isActive: boolean };
};

async function resolvePowerSyncClaims(assignments: RawAssignment[]): Promise<{
  cycle_ids: string[];
  squad_ids: string[];
  platoon_ids: string[];
  company_ids: string[];
}> {
  // Only include active cycles — inactive cycle assignments should not pollute
  // the sync scope (e.g. a squad_commander role in a past cycle should not
  // affect a platoon_commander's view in the current one).
  const active = assignments.filter((a) => a.cycle?.isActive !== false);
  const cycle_ids = [...new Set(active.map((a) => a.cycleId))];
  const squad_ids = new Set<string>();
  const platoon_ids = new Set<string>();
  const company_ids = new Set<string>();

  for (const a of active) {
    const role = a.role as import("@/types").Role;
    const eff = effectiveRole(role);
    if (eff === "company_commander" || role === "instructor" || role === "company_medic" || role === "hardship_coordinator") {
      company_ids.add(a.unitId);
    } else if (eff === "platoon_commander") {
      platoon_ids.add(a.unitId);
    } else if (eff === "squad_commander") {
      squad_ids.add(a.unitId);
    }
  }

  return {
    cycle_ids,
    squad_ids: Array.from(squad_ids),
    platoon_ids: Array.from(platoon_ids),
    company_ids: Array.from(company_ids),
  };
}

// ---------------------------------------------------------------------------
// NextAuth config
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: tironetAdapter,
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 /* 1 day — forces daily refresh of cycleAssignments */ },

  providers: [
    Google({ allowDangerousEmailAccountLinking: true }),
    Nodemailer({
      server: process.env.EMAIL_SERVER,
      from: process.env.FROM_EMAIL ?? "Tironet <noreply@localhost>",
    }),
    Credentials({
      id: "sms-otp",
      name: "SMS OTP",
      credentials: {
        phone: { label: "Phone", type: "text" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        const phone = credentials?.phone as string | undefined;
        const code = credentials?.code as string | undefined;
        if (!phone || !code) return null;

        // Verify OTP before touching the DB (don't create users on bad codes)
        let approved = false;
        try {
          approved = await verifySmsOtp(phone, code);
        } catch {
          return null;
        }
        if (!approved) return null;

        // Find user by phone
        let user = await prisma.user.findUnique({
          where: { phone },
          select: { id: true, email: true, givenName: true, familyName: true },
        });

        if (!user) {
          // No user with this phone yet — check for a valid pending invitation
          const invitation = await prisma.invitation.findFirst({
            where: { phone, acceptedAt: null, expiresAt: { gt: new Date() } },
            select: { email: true, givenName: true, familyName: true },
          });
          if (!invitation) return null;

          if (invitation.email) {
            // Invitation has email — find or create user by email
            const existing = await prisma.user.findUnique({
              where: { email: invitation.email },
              select: { id: true, email: true, givenName: true, familyName: true },
            });
            if (existing) {
              await prisma.user.update({ where: { id: existing.id }, data: { phone } });
              user = existing;
            } else {
              user = await prisma.user.create({
                data: {
                  email: invitation.email,
                  phone,
                  givenName: invitation.givenName ?? "",
                  familyName: invitation.familyName ?? "",
                },
                select: { id: true, email: true, givenName: true, familyName: true },
              });
            }
          } else {
            // Phone-only invitation — create user without email
            user = await prisma.user.create({
              data: {
                phone,
                givenName: invitation.givenName ?? "",
                familyName: invitation.familyName ?? "",
              },
              select: { id: true, email: true, givenName: true, familyName: true },
            });
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.givenName} ${user.familyName}`.trim(),
        };
      },
    }),
  ],

  pages: {
    signIn: "/login",
    error: "/login",
  },

  callbacks: {
    async jwt({ token, user }) {
      // On first sign-in `user` is populated; on subsequent calls only `token`
      if (user?.id) {
        // Full load on initial sign-in (handled below)
        token.sub = user.id;

        // Load full user record + cycle assignments
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            cycleAssignments: {
              include: { cycle: { select: { name: true, isActive: true } } },
            },
          },
        });

        if (dbUser) {
          token.givenName = dbUser.givenName;
          token.familyName = dbUser.familyName;
          token.rank = dbUser.rank;
          token.isAdmin = dbUser.isAdmin;
          token.phone = dbUser.phone;
          token.profileImageVersion = dbUser.updatedAt.toISOString();
          token.cycleAssignments = dbUser.cycleAssignments.map(
            (a: {
              cycleId: string;
              cycle: { name: string; isActive: boolean };
              role: string;
              unitType: string;
              unitId: string;
            }) => ({
              cycleId: a.cycleId,
            cycleName: a.cycle.name,
            cycleIsActive: a.cycle.isActive,
            role: a.role,
            unitType: a.unitType,
            unitId: a.unitId,
          })) as CycleAssignment[];

          // PowerSync sync-rule claims
          const ps = await resolvePowerSyncClaims(dbUser.cycleAssignments);
          token.cycle_ids = ps.cycle_ids;
          token.squad_ids = ps.squad_ids;
          token.platoon_ids = ps.platoon_ids;
          token.company_ids = ps.company_ids;
        }
      } else if (token.sub) {
        // On subsequent token refreshes, re-read isAdmin and cycleAssignments
        // from DB so that changes (make-admin, accepting invitations) take
        // effect without requiring a full sign-out/sign-in.
        const fresh = await prisma.user.findUnique({
          where: { id: token.sub },
          select: {
            givenName: true,
            familyName: true,
            rank: true,
            phone: true,
            isAdmin: true,
            updatedAt: true,
            cycleAssignments: {
              select: {
                cycleId: true,
                role: true,
                unitType: true,
                unitId: true,
                cycle: { select: { name: true, isActive: true } },
              },
            },
          },
        });
        if (fresh) {
          token.givenName = fresh.givenName;
          token.familyName = fresh.familyName;
          token.rank = fresh.rank;
          token.phone = fresh.phone;
          token.isAdmin = fresh.isAdmin;
          token.profileImageVersion = fresh.updatedAt.toISOString();
          token.cycleAssignments = fresh.cycleAssignments.map(
            (a: {
              cycleId: string;
              cycle: { name: string; isActive: boolean };
              role: string;
              unitType: string;
              unitId: string;
            }) => ({
              cycleId: a.cycleId,
              cycleName: a.cycle.name,
              cycleIsActive: a.cycle.isActive,
              role: a.role,
              unitType: a.unitType,
              unitId: a.unitId,
            })
          ) as CycleAssignment[];

          // PowerSync sync-rule claims
          const ps = await resolvePowerSyncClaims(fresh.cycleAssignments);
          token.cycle_ids = ps.cycle_ids;
          token.squad_ids = ps.squad_ids;
          token.platoon_ids = ps.platoon_ids;
          token.company_ids = ps.company_ids;
        }
      }
      return token;
    },

    async session({ session, token }) {
      session.user.id = token.sub!;
      session.user.givenName = token.givenName as string;
      session.user.familyName = token.familyName as string;
      session.user.rank = token.rank as string | null;
      session.user.isAdmin = (token.isAdmin as boolean) ?? false;
      session.user.phone = (token.phone as string | null | undefined) ?? null;
      session.user.profileImageVersion = token.profileImageVersion as string | undefined;
      session.user.cycleAssignments =
        (token.cycleAssignments as CycleAssignment[]) ?? [];
      session.user.cycle_ids = (token.cycle_ids as string[]) ?? [];
      session.user.squad_ids = (token.squad_ids as string[]) ?? [];
      session.user.platoon_ids = (token.platoon_ids as string[]) ?? [];
      session.user.company_ids = (token.company_ids as string[]) ?? [];
      return session;
    },

    // TODO (Phase 3): block sign-in for emails without a pending invitation
    // async signIn({ user }) {
    //   const hasAssignment = await prisma.userCycleAssignment.findFirst({
    //     where: { userId: user.id }
    //   });
    //   if (!hasAssignment) return "/not-authorized";
    //   return true;
    // },
  },
});
