import { useTranslations } from "next-intl";

export default function NotAuthorizedPage() {
  return <NotAuthorizedContent />;
}

function NotAuthorizedContent() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const t = useTranslations("auth");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-2xl font-bold">{t("notAuthorized")}</h1>
        <p className="text-muted-foreground">{t("notAuthorizedDesc")}</p>
      </div>
    </main>
  );
}
