import { useTranslations } from "next-intl";

export default function SoldiersPage() {
  return <SoldiersContent />;
}

function SoldiersContent() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const t = useTranslations("soldiers");
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">
        ניהול חיילים יבנה בשלב 4
      </p>
    </div>
  );
}
