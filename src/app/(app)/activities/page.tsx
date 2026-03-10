import { useTranslations } from "next-intl";

export default function ActivitiesPage() {
  return <ActivitiesContent />;
}

function ActivitiesContent() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const t = useTranslations("activities");
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">
        ניהול פעילויות יבנה בשלב 5
      </p>
    </div>
  );
}
