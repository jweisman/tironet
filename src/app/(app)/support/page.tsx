"use client";

import { useState } from "react";
import { Send, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePowerSync } from "@powersync/react";
import { useSession } from "next-auth/react";
import { useCycle } from "@/contexts/CycleContext";

async function collectDiagnostics(
  db: ReturnType<typeof usePowerSync>,
  session: ReturnType<typeof useSession>["data"],
  selectedCycleId: string | null,
  selectedAssignment: { role: string; unitId: string; unitType: string } | null,
) {
  const diagnostics: Record<string, unknown> = {};

  // Device & browser
  diagnostics["Device"] = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenSize: `${screen.width}×${screen.height}`,
    viewportSize: `${window.innerWidth}×${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    standalone: window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone),
    online: navigator.onLine,
    cookiesEnabled: navigator.cookieEnabled,
  };

  // Storage
  try {
    const estimate = await navigator.storage.estimate();
    diagnostics["Storage"] = {
      usageKB: Math.round((estimate.usage ?? 0) / 1024),
      quotaKB: Math.round((estimate.quota ?? 0) / 1024),
      persisted: await navigator.storage.persisted?.() ?? "N/A",
    };
  } catch {
    diagnostics["Storage"] = { error: "navigator.storage unavailable" };
  }

  // Session & assignment
  diagnostics["Session"] = {
    userId: session?.user?.id ?? "not logged in",
    email: session?.user?.email ?? "—",
    isAdmin: session?.user?.isAdmin ?? false,
    selectedCycleId: selectedCycleId ?? "none",
    role: selectedAssignment?.role ?? "none",
    unitType: selectedAssignment?.unitType ?? "—",
    unitId: selectedAssignment?.unitId ?? "—",
  };

  // PowerSync status
  try {
    const status = db.currentStatus;
    diagnostics["PowerSync"] = {
      connected: status?.connected ?? false,
      hasSynced: status?.hasSynced ?? false,
      lastSyncedAt: status?.lastSyncedAt?.toISOString() ?? "never",
      downloading: String(status?.dataFlowStatus?.downloading ?? "unknown"),
      uploading: String(status?.dataFlowStatus?.uploading ?? "unknown"),
      uploadError: status?.dataFlowStatus?.uploadError ?? false,
    };
  } catch (e) {
    diagnostics["PowerSync"] = { error: String(e) };
  }

  // Table row counts
  try {
    const tables = ["soldiers", "squads", "platoons", "activities", "activity_reports", "requests", "request_actions"];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const result = await db.execute(`SELECT COUNT(*) as c FROM ${table}`);
        counts[table] = Number(result.rows?._array?.[0]?.c ?? result.rows?.item?.(0)?.c ?? 0);
      } catch {
        counts[table] = -1; // table doesn't exist or query failed
      }
    }
    diagnostics["Table Row Counts"] = counts;
  } catch (e) {
    diagnostics["Table Row Counts"] = { error: String(e) };
  }

  // PowerSync buckets
  try {
    const buckets = await db.execute("SELECT name, count_at_last, count_since_last FROM ps_buckets LIMIT 20");
    const rows = buckets.rows?._array ?? [];
    diagnostics["Sync Buckets"] = rows.length > 0
      ? rows.map((r: Record<string, unknown>) => ({
          name: r.name,
          countAtLast: r.count_at_last,
          countSinceLast: r.count_since_last,
        }))
      : "no buckets";
  } catch (e) {
    diagnostics["Sync Buckets"] = { error: String(e) };
  }

  // PowerSync sync claims from token
  try {
    const res = await fetch("/api/powersync/token");
    if (res.ok) {
      const { token } = await res.json();
      // Decode JWT payload (base64url)
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      diagnostics["Sync Claims"] = {
        cycle_ids: payload.cycle_ids,
        platoon_ids: payload.platoon_ids,
        squad_id: payload.squad_id,
        exp: new Date(payload.exp * 1000).toISOString(),
      };
    }
  } catch (e) {
    diagnostics["Sync Claims"] = { error: String(e) };
  }

  // ps_oplog sample — check if rows arrived but were processed as REMOVEs
  try {
    const oplog = await db.execute(
      "SELECT op, COUNT(*) as cnt FROM ps_oplog GROUP BY op LIMIT 10"
    );
    const rows = oplog.rows?._array ?? [];
    diagnostics["Oplog Summary"] = rows.length > 0
      ? Object.fromEntries(rows.map((r: Record<string, unknown>) => [String(r.op), r.cnt]))
      : "empty";
  } catch (e) {
    diagnostics["Oplog Summary"] = { error: String(e) };
  }

  // Sample queries — run the same queries the home/soldiers pages use
  try {
    const cycleId = selectedCycleId ?? "";
    const squads = await db.execute(
      `SELECT sq.id, sq.name, p.name AS platoon_name FROM squads sq JOIN platoons p ON p.id = sq.platoon_id WHERE sq.platoon_id IN (SELECT id FROM platoons WHERE id IN (SELECT platoon_id FROM squads WHERE id IN (SELECT squad_id FROM soldiers WHERE cycle_id = ?))) LIMIT 10`,
      [cycleId]
    );
    const soldiers = await db.execute(
      "SELECT COUNT(*) as cnt FROM soldiers WHERE cycle_id = ?",
      [cycleId]
    );
    const allSquads = await db.execute("SELECT COUNT(*) as cnt FROM squads");
    const allPlatoons = await db.execute("SELECT COUNT(*) as cnt FROM platoons");

    diagnostics["Sample Queries"] = {
      selectedCycleId: cycleId || "none",
      squadsForCycle: squads.rows?._array?.map((r: Record<string, unknown>) => `${r.platoon_name} > ${r.name}`) ?? [],
      soldiersForCycle: Number(soldiers.rows?._array?.[0]?.cnt ?? 0),
      totalSquads: Number(allSquads.rows?._array?.[0]?.cnt ?? 0),
      totalPlatoons: Number(allPlatoons.rows?._array?.[0]?.cnt ?? 0),
    };
  } catch (e) {
    diagnostics["Sample Queries"] = { error: String(e) };
  }

  // Service worker
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    diagnostics["Service Worker"] = {
      registered: !!reg,
      active: !!reg?.active,
      scope: reg?.scope ?? "—",
      updateFound: !!reg?.installing || !!reg?.waiting,
    };
  } catch {
    diagnostics["Service Worker"] = { registered: false };
  }

  // PWA / splash screen diagnostics
  try {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const splashLinks = Array.from(document.querySelectorAll('link[rel="apple-touch-startup-image"]'));
    const matchingSplash = splashLinks.filter((link) => {
      const media = link.getAttribute("media");
      return media ? window.matchMedia(media).matches : false;
    });
    diagnostics["PWA"] = {
      isIOS,
      standalone: window.matchMedia("(display-mode: standalone)").matches
        || ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone),
      splashLinksTotal: splashLinks.length,
      matchingSplashMedia: matchingSplash.length > 0
        ? matchingSplash.map((l) => l.getAttribute("media"))
        : `none matching (device: ${screen.width}×${screen.height} @${window.devicePixelRatio}x)`,
    };
  } catch (e) {
    diagnostics["PWA"] = { error: String(e) };
  }

  return diagnostics;
}

export default function SupportPage() {
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const db = usePowerSync();
  const { data: session } = useSession();
  const { selectedCycleId, selectedAssignment } = useCycle();

  async function handleSubmit() {
    setSending(true);
    try {
      const diagnostics = await collectDiagnostics(db, session, selectedCycleId ?? null, selectedAssignment ?? null);

      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() || undefined, diagnostics }),
      });

      if (!res.ok) throw new Error("Failed to send");
      setSent(true);
      toast.success("הדיווח נשלח בהצלחה");
    } catch {
      toast.error("שגיאה בשליחת הדיווח. נסה שוב.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4 px-4">
        <CheckCircle size={48} className="text-emerald-600" />
        <h1 className="text-xl font-bold">הדיווח נשלח</h1>
        <p className="text-muted-foreground text-sm max-w-md">
          קיבלנו את הדיווח שלך עם כל פרטי האבחון. נחזור אליך בהקדם.
        </p>
        <Button variant="outline" onClick={() => { setSent(false); setDescription(""); }}>
          שלח דיווח נוסף
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 py-4">
      <div>
        <h1 className="text-xl font-bold">תמיכה</h1>
        <p className="text-sm text-muted-foreground mt-1">
          תאר את הבעיה ושלח — אנחנו נקבל את כל פרטי האבחון הנדרשים לטיפול.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="support-desc" className="text-sm font-medium">
          תיאור הבעיה (אופציונלי)
        </label>
        <textarea
          id="support-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="מה קרה? מה ציפית שיקרה?"
          rows={4}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={sending}
        className="w-full"
      >
        {sending ? (
          <>
            <Loader2 size={16} className="animate-spin me-2" />
            שולח דיווח...
          </>
        ) : (
          <>
            <Send size={16} className="me-2" />
            שלח דיווח
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        הדיווח כולל מידע טכני על המכשיר, הדפדפן, ומצב הסנכרון — ללא מידע אישי על חיילים.
      </p>
    </div>
  );
}
