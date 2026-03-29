import Link from "next/link";
import { useTranslations } from "next-intl";
import { SoldierLogo } from "@/components/SoldierLogo";

export default function LandingPage() {
  return <LandingContent />;
}

function LandingContent() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const t = useTranslations("landing");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-center">
      <div className="max-w-md space-y-6">
        <SoldierLogo className="h-36 w-auto mx-auto text-[#273617] dark:text-[#7C9A6D]" />
        <h1 className="text-5xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-xl text-muted-foreground">{t("subtitle")}</p>
        <p className="text-muted-foreground">{t("description")}</p>
        <Link
          href="/login"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          {t("signIn")}
        </Link>
      </div>

      <footer className="absolute bottom-6 text-sm text-muted-foreground flex gap-3">
        <a href="/terms" className="hover:underline">Terms of Use</a>
        <span>·</span>
        <a href="/privacy" className="hover:underline">Privacy Policy</a>
      </footer>
    </main>
  );
}
