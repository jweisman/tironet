"use client";

import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export default function ProfilePage() {
  const { data: session, update } = useSession();
  const [givenName, setGivenName] = useState(session?.user?.givenName ?? "");
  const [familyName, setFamilyName] = useState(session?.user?.familyName ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
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
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("אירעה שגיאה. נסה שנית.");
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
      if (res.ok) await update();
      else setError("שגיאה בהעלאת התמונה");
    } catch {
      setError("שגיאה בהעלאת התמונה");
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
            <Label htmlFor="given-name">שם פרטי</Label>
            <Input
              id="given-name"
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="family-name">שם משפחה</Label>
            <Input
              id="family-name"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              required
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

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-green-600">הפרטים נשמרו בהצלחה</p>}

        <Button type="submit" disabled={saving}>
          {saving ? "שומר..." : "שמור שינויים"}
        </Button>
      </form>

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
