import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect("/home");

  return (
    <div>
      <h1 className="text-2xl font-bold">ניהול</h1>
      <p className="mt-2 text-muted-foreground">
        פאנל הניהול יבנה בשלב 2
      </p>
    </div>
  );
}
