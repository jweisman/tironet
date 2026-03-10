"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    await signIn("nodemailer", { email, redirect: false });
    setSent(true);
    setSending(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">טירונט</h1>
          <p className="mt-2 text-muted-foreground">{t("signIn")}</p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center space-y-2">
            <p className="font-medium">{t("magicLinkSent")}</p>
            <p className="text-sm text-muted-foreground">{t("checkEmail")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Google */}
            <Button
              className="w-full"
              variant="outline"
              onClick={() => signIn("google", { callbackUrl: "/home" })}
            >
              {t("signInWithGoogle")}
            </Button>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-sm text-muted-foreground">או</span>
              <Separator className="flex-1" />
            </div>

            {/* Magic link */}
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("signInWithEmail")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  dir="ltr"
                />
              </div>
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? "שולח..." : t("sendMagicLink")}
              </Button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
