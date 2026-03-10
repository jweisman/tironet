import { useTranslations } from "next-intl";

export default function HomePage() {
  return <HomeContent />;
}

function HomeContent() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const t = useTranslations("dashboard");
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">
        לוח הבקרה יבנה בשלב 6
      </p>
    </div>
  );
}
