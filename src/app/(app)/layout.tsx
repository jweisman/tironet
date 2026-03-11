import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth/auth";
import { AppShell } from "@/components/layout/AppShell";
import { CycleProvider } from "@/contexts/CycleContext";

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
        <AppShell>{children}</AppShell>
      </CycleProvider>
    </SessionProvider>
  );
}
