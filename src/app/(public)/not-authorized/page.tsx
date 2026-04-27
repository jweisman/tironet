"use client";

import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function NotAuthorizedPage() {
  const t = useTranslations("auth");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-2xl font-bold">{t("notAuthorized")}</h1>
        <p className="text-muted-foreground">{t("notAuthorizedDesc")}</p>
        <Button
          variant="outline"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          התנתק
        </Button>
      </div>
    </main>
  );
}
