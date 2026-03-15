import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import Credentials from "next-auth/providers/credentials";
import type { Adapter, AdapterUser, AdapterAccount } from "next-auth/adapters";
import { prisma } from "@/lib/db/prisma";
import { verifyWhatsAppOtp } from "@/lib/twilio";
import type { CycleAssignment } from "@/types";

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
// NextAuth config
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: tironetAdapter,
  session: { strategy: "jwt" },

  providers: [
    Google({ allowDangerousEmailAccountLinking: true }),
    Nodemailer({
      server: process.env.EMAIL_SERVER,
      from: process.env.FROM_EMAIL ?? "Tironet <noreply@localhost>",
    }),
    Credentials({
      id: "whatsapp-otp",
      name: "WhatsApp OTP",
      credentials: {
        phone: { label: "Phone", type: "text" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        const phone = credentials?.phone as string | undefined;
        const code = credentials?.code as string | undefined;
        if (!phone || !code) return null;

        const user = await prisma.user.findUnique({
          where: { phone },
          select: { id: true, email: true, givenName: true, familyName: true },
        });
        if (!user) return null;

        let approved = false;
        try {
          approved = await verifyWhatsAppOtp(phone, code);
        } catch {
          return null;
        }
        if (!approved) return null;

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
