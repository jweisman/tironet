"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";

const ImageCropDialog = dynamic(() => import("@/components/ImageCropDialog").then(m => m.ImageCropDialog));
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS, UNIT_TYPE_FOR_ROLE, RANKS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

type Squad = { id: string; name: string };
type Platoon = { id: string; name: string; squads: Squad[] };
type Company = { id: string; name: string; platoons: Platoon[] };
type Cycle = { id: string; name: string };

type Props = {
  cycles: Cycle[];
  structureByCycle: Record<string, Company[]>;
  allowedRoles?: Role[];
  onSuccess: () => void;
  onCancel: () => void;
};

type CreatedInvitation = {
  id: string;
  inviteUrl: string;
  hasEmail: boolean;
};

const ALL_ROLES: Role[] = ["company_commander", "platoon_commander", "squad_commander"];

export function InviteUserForm({ cycles, structureByCycle, allowedRoles, onSuccess, onCancel }: Props) {
  const roles = allowedRoles ?? ALL_ROLES;
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [rank, setRank] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? "");
  const [role, setRole] = useState<Role>(roles[0] ?? "squad_commander");
  const [unitId, setUnitId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const companies = structureByCycle[cycleId] ?? [];
  const unitType = UNIT_TYPE_FOR_ROLE[role];

  const unitOptions: { id: string; name: string }[] = (() => {
    if (unitType === "company") {
      return companies.map((c) => ({ id: c.id, name: c.name }));
    }
    if (unitType === "platoon") {
      return companies.flatMap((c) => c.platoons.map((p) => ({ id: p.id, name: `${c.name} / ${p.name}` })));
    }
    return companies.flatMap((c) =>
      c.platoons.flatMap((p) =>
        p.squads.map((s) => ({ id: s.id, name: `${c.name} / ${p.name} / ${s.name}` }))
      )
    );
  })();

  const hasContact = email.trim() || phone.trim();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!hasContact || !cycleId || !unitId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          cycleId,
          role,
          unitType,
          unitId,
          givenName: givenName.trim() || undefined,
          familyName: familyName.trim() || undefined,
          rank: rank || undefined,
          profileImage: imageBase64 || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "שגיאה ביצירת ההזמנה");
        return;
      }
      const data = await res.json();
      setCreated({ id: data.id, inviteUrl: data.inviteUrl, hasEmail: !!email.trim() });
    } catch {
      setError("שגיאה ביצירת ההזמנה");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    await navigator.clipboard.writeText(created.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function sendEmail() {
    if (!created) return;
    setEmailSending(true);
    try {
      await fetch("/api/invitations/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: created.id }),
      });
      setEmailSent(true);
    } finally {
      setEmailSending(false);
    }
  }

  // Post-creation screen: choose send email or copy link
  if (created) {
    return (
      <div className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-1">
          <p className="font-medium">ההזמנה נוצרה בהצלחה</p>
          <p className="text-muted-foreground break-all" dir="ltr">{created.inviteUrl}</p>
        </div>

        <div className="space-y-2">
          <Button
            className="w-full"
            variant="outline"
            onClick={copyLink}
          >
            {copied ? "הקישור הועתק ✓" : "העתק קישור הזמנה"}
          </Button>

          {created.hasEmail && (
            <Button
              className="w-full"
              onClick={sendEmail}
              disabled={emailSending || emailSent}
            >
              {emailSent ? "המייל נשלח ✓" : emailSending ? "שולח..." : "שלח הזמנה במייל"}
            </Button>
          )}
        </div>

        <Button variant="ghost" className="w-full" onClick={onSuccess}>
          סיום
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">אימייל</Label>
        <Input
          id="invite-email"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          dir="ltr"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invite-phone">טלפון (לכניסה עם SMS)</Label>
        <Input
          id="invite-phone"
          type="tel"
          placeholder="050-123-4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="off"
          dir="ltr"
        />
      </div>

      {!hasContact && (
        <p className="text-xs text-muted-foreground">יש לספק אימייל או מספר טלפון</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="invite-given">שם פרטי</Label>
          <Input
            id="invite-given"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            placeholder="לא חובה"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-family">שם משפחה</Label>
          <Input
            id="invite-family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder="לא חובה"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>דרגה</Label>
          <Select value={rank} onValueChange={(v) => setRank(!v || v === "__none__" ? "" : v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="ללא דרגה">{rank || "ללא דרגה"}</SelectValue>
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
          <Label>תמונה</Label>
          {imagePreview && (
            <img src={imagePreview} alt="" className="w-8 h-8 rounded-full object-cover mb-1" />
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile(f); }} />
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => fileInputRef.current?.click()}>
            בחר תמונה
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>מחזור</Label>
        <Select value={cycleId} onValueChange={(v) => { setCycleId(v ?? ""); setUnitId(""); }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="בחר מחזור">
              {cycles.find((c) => c.id === cycleId)?.name ?? "בחר מחזור"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {cycles.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>תפקיד</Label>
        <Select value={role} onValueChange={(v) => { setRole(v as Role); setUnitId(""); }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="בחר תפקיד">
              {ROLE_LABELS[role]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>יחידה</Label>
        <Select value={unitId} onValueChange={(v) => setUnitId(v ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="בחר יחידה">
              <span className="truncate">
                {unitOptions.find((u) => u.id === unitId)?.name ?? "בחר יחידה"}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {unitOptions.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {unitOptions.length === 0 && (
          <p className="text-xs text-muted-foreground">אין יחידות במחזור זה. צור מבנה פיקוד תחילה.</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          ביטול
        </Button>
        <Button type="submit" disabled={loading || !hasContact || !unitId}>
          {loading ? "יוצר..." : "צור הזמנה"}
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
