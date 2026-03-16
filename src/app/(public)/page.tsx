import Link from "next/link";
import { useTranslations } from "next-intl";

export default function LandingPage() {
  return <LandingContent />;
}

function LandingContent() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const t = useTranslations("landing");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-center">
      <div className="max-w-md space-y-6">
        <img src="/soldier.svg" alt="" className="h-36 w-auto mx-auto" />
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
    </main>
  );
}
