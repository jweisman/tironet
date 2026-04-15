"use client";

import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import dynamic from "next/dynamic";
import { RANKS } from "@/lib/auth/permissions";

const ImageCropDialog = dynamic(() => import("@/components/ImageCropDialog").then(m => m.ImageCropDialog));
import { toIsraeliDisplay } from "@/lib/phone";

type User = {
  id: string;
  givenName: string;
  familyName: string;
  rank: string | null;
  isAdmin: boolean;
  phone: string | null;
  email?: string | null;
};

type Props = {
  user: User;
  onSuccess: () => void;
  onCancel: () => void;
  showAdminToggle?: boolean;
  endpoint?: string;
};

export function EditUserForm({ user, onSuccess, onCancel, showAdminToggle = true, endpoint }: Props) {
  const [givenName, setGivenName] = useState(user.givenName);
  const [familyName, setFamilyName] = useState(user.familyName);
  const [rank, setRank] = useState(user.rank ?? "");
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [phone, setPhone] = useState(
    user.phone ? toIsraeliDisplay(user.phone) : ""
  );
  const [email, setEmail] = useState(user.email ?? "");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null | undefined>(undefined);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const url = endpoint ?? `/api/admin/users/${user.id}/profile`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => { if (data.profileImage) setImagePreview(data.profileImage); })
      .catch(() => {});
  }, [user.id, endpoint]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!givenName.trim() || !familyName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        givenName: givenName.trim(),
        familyName: familyName.trim(),
        rank: rank.trim() || null,
        isAdmin,
        phone: phone.trim() || null,
        email: email.trim() || null,
      };
      if (imageBase64 !== undefined) {
        body.profileImage = imageBase64;
      }
      const url = endpoint ?? `/api/admin/users/${user.id}/profile`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError("שגיאה בשמירת הפרופיל");
        return;
      }
      onSuccess();
    } catch {
      setError("שגיאה בשמירת הפרופיל");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-given">שם פרטי</Label>
          <Input
            id="edit-given"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-family">שם משפחה</Label>
          <Input
            id="edit-family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>דרגה</Label>
        <Select value={rank} onValueChange={(v) => setRank(!v || v === "__none__" ? "" : v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="ללא דרגה">
              {rank || "ללא דרגה"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">ללא דרגה</SelectItem>
            {RANKS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-phone">טלפון (SMS)</Label>
        <Input
          id="edit-phone"
          type="tel"
          placeholder="לדוגמה: 050-123-4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-email">אימייל</Label>
        <Input
          id="edit-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
        />
      </div>

      {showAdminToggle && (
        <div className="flex items-center justify-between">
          <Label htmlFor="edit-admin">מנהל מערכת</Label>
          <Switch
            id="edit-admin"
            checked={isAdmin}
            onCheckedChange={setIsAdmin}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>תמונת פרופיל</Label>
        {imagePreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreview}
            alt="תצוגה מקדימה"
            className="w-16 h-16 rounded-full object-cover mb-2"
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPendingFile(f);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          בחר תמונה
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-row-reverse gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          ביטול
        </Button>
        <Button type="submit" disabled={loading || !givenName.trim() || !familyName.trim()}>
          {loading ? "שומר..." : "שמור"}
        </Button>
      </div>

      <ImageCropDialog
        file={pendingFile}
        onConfirm={(base64) => {
          setPendingFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          setImagePreview(base64);
          setImageBase64(base64);
        }}
        onCancel={() => {
          setPendingFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
    </form>
  );
}
