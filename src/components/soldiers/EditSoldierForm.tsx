"use client";

import { useRef, useState } from "react";
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
import dynamic from "next/dynamic";
import { RANKS } from "@/lib/auth/permissions";
import { toIsraeliDisplay } from "@/lib/phone";

const ImageCropDialog = dynamic(() => import("@/components/ImageCropDialog").then(m => m.ImageCropDialog));
import type { SoldierStatus } from "@/types";

interface SoldierData {
  id: string;
  givenName: string;
  familyName: string;
  idNumber: string | null;
  civilianId: string | null;
  rank: string | null;
  status: SoldierStatus;
  profileImage: string | null;
  phone: string | null;
  emergencyPhone: string | null;
  street: string | null;
  apt: string | null;
  city: string | null;
  notes: string | null;
}

interface Props {
  soldier: SoldierData;
  onSuccess: (updated: SoldierData) => void;
  onCancel: () => void;
}

export function EditSoldierForm({ soldier, onSuccess, onCancel }: Props) {
  const [givenName, setGivenName] = useState(soldier.givenName);
  const [familyName, setFamilyName] = useState(soldier.familyName);
  const [idNumber, setIdNumber] = useState(soldier.idNumber ?? "");
  const [civilianId, setCivilianId] = useState(soldier.civilianId ?? "");
  const [rank, setRank] = useState(soldier.rank ?? "");
  const [status, setStatus] = useState<SoldierStatus>(soldier.status);
  const [phone, setPhone] = useState(soldier.phone ? toIsraeliDisplay(soldier.phone) : "");
  const [emergencyPhone, setEmergencyPhone] = useState(soldier.emergencyPhone ? toIsraeliDisplay(soldier.emergencyPhone) : "");
  const [street, setStreet] = useState(soldier.street ?? "");
  const [apt, setApt] = useState(soldier.apt ?? "");
  const [city, setCity] = useState(soldier.city ?? "");
  const [notes, setNotes] = useState(soldier.notes ?? "");
  const [imagePreview, setImagePreview] = useState<string | null>(
    soldier.profileImage
  );
  const [imageBase64, setImageBase64] = useState<string | null>(
    soldier.profileImage
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!givenName.trim() || !familyName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/soldiers/${soldier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          givenName: givenName.trim(),
          familyName: familyName.trim(),
          idNumber: idNumber.trim() || null,
          civilianId: civilianId.trim() || null,
          rank: rank || null,
          status,
          profileImage: imageBase64,
          phone: phone.trim() || null,
          emergencyPhone: emergencyPhone.trim() || null,
          street: street.trim() || null,
          apt: apt.trim() || null,
          city: city.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "שגיאה בעדכון החייל");
        return;
      }
      const updated = await res.json();
      onSuccess(updated);
    } catch {
      setError("שגיאה בעדכון החייל");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-given">שם פרטי *</Label>
          <Input
            id="edit-given"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            placeholder="שם פרטי"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-family">שם משפחה *</Label>
          <Input
            id="edit-family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder="שם משפחה"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-id-number">מספר אישי</Label>
          <Input
            id="edit-id-number"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            placeholder="מספר אישי"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-civilian-id">מספר זהות</Label>
          <Input
            id="edit-civilian-id"
            value={civilianId}
            onChange={(e) => setCivilianId(e.target.value)}
            placeholder="מספר זהות"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>דרגה</Label>
          <Select
            value={rank}
            onValueChange={(v) => setRank(!v || v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="ללא דרגה">
                {rank || "ללא דרגה"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">ללא דרגה</SelectItem>
              {RANKS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>סטטוס</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus((v ?? "active") as SoldierStatus)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {status === "active"
                  ? "פעיל"
                  : status === "transferred"
                  ? "הועבר"
                  : status === "dropped"
                  ? "נשר"
                  : "פצוע"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">פעיל</SelectItem>
              <SelectItem value="transferred">הועבר</SelectItem>
              <SelectItem value="dropped">נשר</SelectItem>
              <SelectItem value="injured">פצוע</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>תמונה</Label>
        <div className="flex items-center gap-3">
          {imagePreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imagePreview}
              alt=""
              className="h-10 w-10 rounded-full object-cover shrink-0"
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
            {imagePreview ? "החלף תמונה" : "בחר תמונה"}
          </Button>
          {imagePreview && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setImagePreview(null);
                setImageBase64(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              הסר
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-phone">טלפון</Label>
          <Input
            id="edit-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="לדוגמה: 050-1234567"
            dir="ltr"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-emergency-phone">טלפון חירום</Label>
          <Input
            id="edit-emergency-phone"
            type="tel"
            value={emergencyPhone}
            onChange={(e) => setEmergencyPhone(e.target.value)}
            placeholder="לדוגמה: 050-9876543"
            dir="ltr"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-street">רחוב</Label>
          <Input
            id="edit-street"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="רחוב ומספר"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-city">עיר</Label>
          <Input
            id="edit-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="עיר"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-apt">דירה</Label>
        <Input
          id="edit-apt"
          value={apt}
          onChange={(e) => setApt(e.target.value)}
          placeholder="מספר דירה"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-notes">הערות</Label>
        <textarea
          id="edit-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="הערות על החייל"
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 justify-end pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={loading}
        >
          ביטול
        </Button>
        <Button
          type="submit"
          disabled={loading || !givenName.trim() || !familyName.trim()}
        >
          {loading ? "שומר..." : "שמור שינויים"}
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
