"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SoldierLogo } from "@/components/SoldierLogo";
import { toE164 } from "@/lib/phone";

type WhatsAppStep = "idle" | "phone" | "code" | "sent";

function LoginForm() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/home";
  const isPhoneInvite = searchParams.get("invitePhone") === "1";

  // Magic link state
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // WhatsApp OTP state — auto-expand phone input when coming from a phone-only invite
  const [waStep, setWaStep] = useState<WhatsAppStep>(isPhoneInvite ? "phone" : "idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [waVerifying, setWaVerifying] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    await signIn("nodemailer", { email, callbackUrl, redirect: false });
    setSent(true);
    setSending(false);
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setWaError(null);
    const e164 = toE164(phone);
    if (!e164) {
      setWaError("מספר טלפון לא תקין. הזן מספר ישראלי (לדוגמה: 050-123-4567)");
      return;
    }
    setWaSending(true);
    try {
      const res = await fetch("/api/auth/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: e164 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setWaError(data.error ?? "שגיאה בשליחת הקוד");
        return;
      }
      setPhone(e164); // store in E.164 for verification
      setWaStep("sent");
    } catch {
      setWaError("שגיאה בשליחת הקוד");
    } finally {
      setWaSending(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setWaError(null);
    if (!code.trim()) return;
    setWaVerifying(true);
    try {
      const result = await signIn("whatsapp-otp", {
        phone,
        code: code.trim(),
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setWaError("קוד שגוי או שפג תוקפו. נסה שנית.");
        setCode("");
      } else {
        window.location.href = callbackUrl;
      }
    } catch {
      setWaError("שגיאה באימות. נסה שנית.");
    } finally {
      setWaVerifying(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <SoldierLogo className="h-28 w-auto mx-auto mb-4 text-[#273617] dark:text-[#7C9A6D]" />
          <h1 className="text-3xl font-bold">טירונט</h1>
          <p className="mt-2 text-muted-foreground">{t("signIn")}</p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center space-y-2">
            <p className="font-medium">{t("magicLinkSent")}</p>
            <p className="text-sm text-muted-foreground">{t("checkEmail")}</p>
          </div>
        ) : isPhoneInvite ? (
          /* Phone-only invite: show only SMS login */
          <div className="space-y-6">
            {waStep === "phone" && (
              <form onSubmit={handlePhoneSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wa-phone">מספר טלפון</Label>
                  <Input
                    id="wa-phone"
                    type="tel"
                    placeholder="לדוגמה: 050-123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    dir="ltr"
                    autoFocus
                  />
                </div>
                {waError && <p className="text-sm text-destructive">{waError}</p>}
                <Button type="submit" className="w-full" disabled={waSending}>
                  {waSending ? "שולח..." : "שלח קוד"}
                </Button>
              </form>
            )}

            {waStep === "sent" && (
              <form onSubmit={handleCodeSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wa-code">קוד SMS</Label>
                  <p className="text-sm text-muted-foreground">
                    קוד אימות נשלח ב-SMS לטלפון שלך
                  </p>
                  <Input
                    id="wa-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    dir="ltr"
                    autoFocus
                  />
                </div>
                {waError && <p className="text-sm text-destructive">{waError}</p>}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setWaStep("phone"); setCode(""); setWaError(null); }}
                  >
                    חזרה
                  </Button>
                  <Button type="submit" className="flex-1" disabled={waVerifying}>
                    {waVerifying ? "מאמת..." : "כניסה"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Google */}
            <Button
              className="w-full"
              variant="outline"
              onClick={() => signIn("google", { callbackUrl })}
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

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-sm text-muted-foreground">או</span>
              <Separator className="flex-1" />
            </div>

            {/* WhatsApp OTP */}
            {waStep === "idle" && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => { setWaStep("phone"); setWaError(null); }}
              >
                כניסה עם קוד SMS
              </Button>
            )}

            {waStep === "phone" && (
              <form onSubmit={handlePhoneSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wa-phone">מספר טלפון</Label>
                  <Input
                    id="wa-phone"
                    type="tel"
                    placeholder="לדוגמה: 050-123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    dir="ltr"
                    autoFocus
                  />
                </div>
                {waError && <p className="text-sm text-destructive">{waError}</p>}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setWaStep("idle"); setPhone(""); setWaError(null); }}
                  >
                    ביטול
                  </Button>
                  <Button type="submit" className="flex-1" disabled={waSending}>
                    {waSending ? "שולח..." : "שלח קוד"}
                  </Button>
                </div>
              </form>
            )}

            {waStep === "sent" && (
              <form onSubmit={handleCodeSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wa-code">קוד SMS</Label>
                  <p className="text-sm text-muted-foreground">
                    קוד אימות נשלח ב-SMS לטלפון שלך
                  </p>
                  <Input
                    id="wa-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    dir="ltr"
                    autoFocus
                  />
                </div>
                {waError && <p className="text-sm text-destructive">{waError}</p>}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setWaStep("phone"); setCode(""); setWaError(null); }}
                  >
                    חזרה
                  </Button>
                  <Button type="submit" className="flex-1" disabled={waVerifying}>
                    {waVerifying ? "מאמת..." : "כניסה"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
