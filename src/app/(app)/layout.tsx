import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth/auth";
import { AppShell } from "@/components/layout/AppShell";
import { CycleProvider } from "@/contexts/CycleContext";
import { TironetPowerSyncProvider } from "@/components/providers/PowerSyncProvider";
import { TourProvider } from "@/contexts/TourContext";
import { UserPreferenceProvider } from "@/contexts/UserPreferenceContext";
import { SentryUserProvider } from "@/components/providers/SentryUserProvider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  return (
    <SessionProvider session={session}>
      <SentryUserProvider />
      <UserPreferenceProvider>
        <CycleProvider>
          <TironetPowerSyncProvider>
            <TourProvider>
              <AppShell>{children}</AppShell>
            </TourProvider>
          </TironetPowerSyncProvider>
        </CycleProvider>
      </UserPreferenceProvider>
    </SessionProvider>
  );
}
