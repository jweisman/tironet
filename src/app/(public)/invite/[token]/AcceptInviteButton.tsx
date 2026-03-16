"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token }: { token: string }) {
  const { update } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invitations/${token}/accept`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "session_invalid") {
          // Stale JWT — sign out (clears cookie) then redirect back to this invite
          await signOut({ redirectTo: `/login?callbackUrl=/invite/${token}` });
          return;
        }
        const msgs: Record<string, string> = {
          already_used: "הזמנה זו כבר נוצלה.",
          expired: "פג תוקפה של ההזמנה.",
          email_mismatch: "האימייל אינו תואם את ההזמנה.",
          phone_mismatch: "מספר הטלפון אינו תואם את ההזמנה.",
        };
        setError(msgs[data.error] ?? "אירעה שגיאה. נסה שנית.");
        return;
      }
      // Force JWT refresh so the new cycleAssignment appears immediately
      await update();
      window.location.href = "/home";
    } catch {
      setError("אירעה שגיאה. נסה שנית.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={accept} disabled={loading} className="w-full">
        {loading ? "מקבל הזמנה..." : "קבל הזמנה"}
      </Button>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
    </div>
  );
}
