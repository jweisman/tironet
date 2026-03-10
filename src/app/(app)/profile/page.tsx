import { useTranslations } from "next-intl";

export default function ProfilePage() {
  return <ProfileContent />;
}

function ProfileContent() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const t = useTranslations("profile");
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">
        פרופיל משתמש יבנה בשלב 3
      </p>
    </div>
  );
}
