import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth/auth";
import { AppShell } from "@/components/layout/AppShell";
import { CycleProvider } from "@/contexts/CycleContext";
import { TironetPowerSyncProvider } from "@/components/providers/PowerSyncProvider";

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
      <CycleProvider>
        <TironetPowerSyncProvider>
          <AppShell>{children}</AppShell>
        </TironetPowerSyncProvider>
      </CycleProvider>
    </SessionProvider>
  );
}
