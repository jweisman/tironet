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

type SmsStep = "idle" | "phone" | "sent";

function LoginForm() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/home";
  const isPhoneInvite = searchParams.get("invitePhone") === "1";

  // Magic link state
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // SMS OTP state — auto-expand phone input when coming from a phone-only invite
  const [smsStep, setSmsStep] = useState<SmsStep>(isPhoneInvite ? "phone" : "idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsVerifying, setSmsVerifying] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

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
    setSmsError(null);
    const e164 = toE164(phone);
    if (!e164) {
      setSmsError("מספר טלפון לא תקין. הזן מספר ישראלי (לדוגמה: 050-123-4567)");
      return;
    }
    setSmsSending(true);
    try {
      const res = await fetch("/api/auth/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: e164 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSmsError(data.error ?? "שגיאה בשליחת הקוד");
        return;
      }
      setPhone(e164); // store in E.164 for verification
      setSmsStep("sent");
    } catch {
      setSmsError("שגיאה בשליחת הקוד");
    } finally {
      setSmsSending(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSmsError(null);
    if (!code.trim()) return;
    setSmsVerifying(true);
    try {
      const result = await signIn("sms-otp", {
        phone,
        code: code.trim(),
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setSmsError("קוד שגוי או שפג תוקפו. נסה שנית.");
        setCode("");
      } else {
        window.location.href = callbackUrl;
      }
    } catch {
      setSmsError("שגיאה באימות. נסה שנית.");
    } finally {
      setSmsVerifying(false);
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
            {smsStep === "phone" && (
              <form onSubmit={handlePhoneSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sms-phone">מספר טלפון</Label>
                  <Input
                    id="sms-phone"
                    type="tel"
                    placeholder="לדוגמה: 050-123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    dir="ltr"
                    autoFocus
                  />
                </div>
                {smsError && <p className="text-sm text-destructive">{smsError}</p>}
                <Button type="submit" className="w-full" disabled={smsSending}>
                  {smsSending ? "שולח..." : "שלח קוד"}
                </Button>
              </form>
            )}

            {smsStep === "sent" && (
              <form onSubmit={handleCodeSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sms-code">קוד SMS</Label>
                  <p className="text-sm text-muted-foreground">
                    קוד אימות נשלח ב-SMS לטלפון שלך
                  </p>
                  <Input
                    id="sms-code"
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
                {smsError && <p className="text-sm text-destructive">{smsError}</p>}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setSmsStep("phone"); setCode(""); setSmsError(null); }}
                  >
                    חזרה
                  </Button>
                  <Button type="submit" className="flex-1" disabled={smsVerifying}>
                    {smsVerifying ? "מאמת..." : "כניסה"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* SMS OTP — primary login method */}
            {(smsStep === "idle" || smsStep === "phone") && (
              <form onSubmit={handlePhoneSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sms-phone">כניסה עם קוד SMS</Label>
                  <Input
                    id="sms-phone"
                    type="tel"
                    placeholder="לדוגמה: 050-123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    dir="ltr"
                  />
                </div>
                {smsError && <p className="text-sm text-destructive">{smsError}</p>}
                <Button type="submit" className="w-full" disabled={smsSending}>
                  {smsSending ? "שולח..." : "שלח קוד"}
                </Button>
              </form>
            )}

            {smsStep === "sent" && (
              <form onSubmit={handleCodeSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sms-code">קוד SMS</Label>
                  <p className="text-sm text-muted-foreground">
                    קוד אימות נשלח ב-SMS לטלפון שלך
                  </p>
                  <Input
                    id="sms-code"
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
                {smsError && <p className="text-sm text-destructive">{smsError}</p>}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setSmsStep("phone"); setCode(""); setSmsError(null); }}
                  >
                    חזרה
                  </Button>
                  <Button type="submit" className="flex-1" disabled={smsVerifying}>
                    {smsVerifying ? "מאמת..." : "כניסה"}
                  </Button>
                </div>
              </form>
            )}

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-sm text-muted-foreground">או</span>
              <Separator className="flex-1" />
            </div>

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
