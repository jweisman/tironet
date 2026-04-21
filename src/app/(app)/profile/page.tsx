"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { signOutAndClearCaches } from "@/lib/auth/sign-out";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { UserAvatar, PROFILE_IMAGE_UPDATED_EVENT } from "@/components/layout/UserAvatar";
import dynamic from "next/dynamic";

const ImageCropDialog = dynamic(() => import("@/components/ImageCropDialog").then(m => m.ImageCropDialog));
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { toIsraeliDisplay } from "@/lib/phone";
import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { Monitor, Sun, Moon, Bell } from "lucide-react";
import type { Role } from "@/types";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "מערכת", icon: Monitor },
  { value: "light", label: "בהיר", icon: Sun },
  { value: "dark", label: "כהה", icon: Moon },
];

export default function ProfilePage() {
  const { data: session, update } = useSession();
  const { preference, setPreference } = useTheme();
  const [givenName, setGivenName] = useState(session?.user?.givenName ?? "");
  const [familyName, setFamilyName] = useState(session?.user?.familyName ?? "");
  const [saving, setSaving] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Push notification state
  const push = usePushSubscription();
  const [dailyTasksEnabled, setDailyTasksEnabled] = useState(true);
  const [requestAssignmentEnabled, setRequestAssignmentEnabled] = useState(true);
  const [activeRequestsEnabled, setActiveRequestsEnabled] = useState(true);
  const [newAppointmentEnabled, setNewAppointmentEnabled] = useState(true);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load notification preferences from server
  useEffect(() => {
    fetch("/api/push/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setDailyTasksEnabled(data.dailyTasksEnabled);
          setRequestAssignmentEnabled(data.requestAssignmentEnabled);
          setActiveRequestsEnabled(data.activeRequestsEnabled);
          setNewAppointmentEnabled(data.newAppointmentEnabled);
        }
        setPrefsLoaded(true);
      })
      .catch(() => setPrefsLoaded(true));
  }, []);

  const updatePreference = useCallback(
    async (field: "dailyTasksEnabled" | "requestAssignmentEnabled" | "activeRequestsEnabled" | "newAppointmentEnabled", value: boolean) => {
      const res = await fetch("/api/push/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        toast.error("שגיאה בשמירת העדפות התראות");
        // Revert
        if (field === "dailyTasksEnabled") setDailyTasksEnabled(!value);
        else if (field === "requestAssignmentEnabled") setRequestAssignmentEnabled(!value);
        else if (field === "activeRequestsEnabled") setActiveRequestsEnabled(!value);
        else setNewAppointmentEnabled(!value);
      }
    },
    [],
  );

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          givenName: givenName.trim(),
          familyName: familyName.trim(),
        }),
      });
      if (!res.ok) throw new Error("שגיאה בשמירה");
      await update();
      toast.success("הפרטים נשמרו בהצלחה");
    } catch {
      toast.error("אירעה שגיאה. נסה שנית.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCropConfirm(base64: string) {
    setPendingFile(null);
    // Reset file input so the same file can be re-selected
    if (fileRef.current) fileRef.current.value = "";
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileImage: base64 }),
      });
      if (res.ok) {
        // Notify all UserAvatar instances immediately (belt-and-suspenders
        // alongside the session-based profileImageVersion mechanism)
        window.dispatchEvent(
          new CustomEvent(PROFILE_IMAGE_UPDATED_EVENT, { detail: base64 })
        );
        await update();
      } else toast.error("שגיאה בהעלאת התמונה");
    } catch {
      toast.error("שגיאה בהעלאת התמונה");
    }
  }

  const assignments = session?.user?.cycleAssignments ?? [];

  return (
    <div className="max-w-md space-y-8">
      <h1 className="text-2xl font-bold">הפרופיל שלי</h1>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <UserAvatar size={64} />
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            שנה תמונה
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPendingFile(f);
            }}
          />
          <p className="text-xs text-muted-foreground mt-1">JPG, PNG — עד 5MB</p>
        </div>
      </div>

      <Separator />

      {/* Edit form */}
      <form onSubmit={saveProfile} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="given-name" required>שם פרטי</Label>
            <Input
              id="given-name"
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="family-name" required>שם משפחה</Label>
            <Input
              id="family-name"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>דרגה</Label>
          <Input value={session?.user?.rank ?? "ללא דרגה"} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>אימייל</Label>
          <Input value={session?.user?.email ?? ""} disabled dir="ltr" />
        </div>
        {session?.user?.phone && (
          <div className="space-y-1.5">
            <Label>טלפון</Label>
            <Input value={toIsraeliDisplay(session.user.phone)} disabled dir="ltr" />
          </div>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? "שומר..." : "שמור שינויים"}
        </Button>
      </form>

      {/* Display mode */}
      <Separator />
      <div className="space-y-3">
        <Label>מצב תצוגה</Label>
        <div className="flex gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreference(value)}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors ${
                preference === value
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <Separator />
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell size={18} />
          <Label className="text-base font-semibold">התראות</Label>
        </div>

        {push.permission === "unsupported" ? (
          <p className="text-sm text-muted-foreground">
            הדפדפן אינו תומך בהתראות.
          </p>
        ) : push.iosRequiresInstall ? (
          <p className="text-sm text-muted-foreground">
            כדי לקבל התראות ב-iPhone, יש להוסיף את האפליקציה למסך הבית תחילה.
          </p>
        ) : push.permission === "denied" ? (
          <p className="text-sm text-muted-foreground">
            התראות חסומות. יש לאפשר התראות בהגדרות הדפדפן.
          </p>
        ) : !push.isSubscribed ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              אפשר התראות כדי לקבל עדכונים על בקשות ודיווחים חסרים.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={push.loading}
              onClick={async () => {
                const ok = await push.subscribe();
                if (ok) toast.success("התראות הופעלו בהצלחה");
                else if (Notification.permission === "denied") toast.error("התראות חסומות בהגדרות הדפדפן");
              }}
            >
              {push.loading ? "מפעיל..." : "הפעל התראות"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">דיווחי פעילויות חסרים</p>
                <p className="text-xs text-muted-foreground">תזכורת יומית על דיווחים חסרים</p>
              </div>
              <Switch
                checked={dailyTasksEnabled}
                disabled={!prefsLoaded}
                onCheckedChange={(v) => {
                  setDailyTasksEnabled(v);
                  updatePreference("dailyTasksEnabled", v);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">בקשות ממתינות</p>
                <p className="text-xs text-muted-foreground">כאשר בקשה מוקצית לתפקידך</p>
              </div>
              <Switch
                checked={requestAssignmentEnabled}
                disabled={!prefsLoaded}
                onCheckedChange={(v) => {
                  setRequestAssignmentEnabled(v);
                  updatePreference("requestAssignmentEnabled", v);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">בקשות פעילות</p>
                <p className="text-xs text-muted-foreground">תזכורת על בקשות פעילות להיום ולמחר</p>
              </div>
              <Switch
                checked={activeRequestsEnabled}
                disabled={!prefsLoaded}
                onCheckedChange={(v) => {
                  setActiveRequestsEnabled(v);
                  updatePreference("activeRequestsEnabled", v);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">תור חדש</p>
                <p className="text-xs text-muted-foreground">כאשר תור נוסף לבקשה רפואית</p>
              </div>
              <Switch
                checked={newAppointmentEnabled}
                disabled={!prefsLoaded}
                onCheckedChange={(v) => {
                  setNewAppointmentEnabled(v);
                  updatePreference("newAppointmentEnabled", v);
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={push.loading}
              onClick={async () => {
                await push.unsubscribe();
                toast.success("התראות בוטלו");
              }}
            >
              {push.loading ? "מבטל..." : "בטל התראות במכשיר זה"}
            </Button>
          </div>
        )}
      </div>

      {/* Cycle assignments (read-only) */}
      {assignments.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <h2 className="font-semibold">שיבוצים</h2>
            <div className="space-y-2">
              {assignments.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                  <div>
                    <span className="font-medium">{ROLE_LABELS[a.role as Role]}</span>
                    <span className="text-muted-foreground"> — {a.cycleName}</span>
                  </div>
                  {!a.cycleIsActive && (
                    <Badge variant="outline" className="text-xs">לא פעיל</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <Separator className="md:hidden" />
      <Button
        variant="outline"
        className="w-full md:hidden text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        onClick={() => signOutAndClearCaches()}
      >
        התנתק
      </Button>

      <ImageCropDialog
        file={pendingFile}
        onConfirm={handleCropConfirm}
        onCancel={() => {
          setPendingFile(null);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />
    </div>
  );
}
