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
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { RANKS } from "@/lib/auth/permissions";

type Squad = { id: string; name: string };

interface Props {
  cycleId: string;
  squads: Squad[];
  defaultSquadId?: string;
  onSuccess: (activeActivityCount: number, soldierId: string) => void;
  onCancel: () => void;
}

export function AddSoldierForm({
  cycleId,
  squads,
  defaultSquadId,
  onSuccess,
  onCancel,
}: Props) {
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [rank, setRank] = useState("");
  const [status, setStatus] = useState("active");
  const [squadId, setSquadId] = useState(
    defaultSquadId ?? squads[0]?.id ?? ""
  );
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const singleSquad = squads.length === 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!givenName.trim() || !familyName.trim() || !squadId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/soldiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId,
          squadId,
          givenName: givenName.trim(),
          familyName: familyName.trim(),
          rank: rank || null,
          status,
          profileImage: imageBase64 ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "שגיאה בהוספת החייל");
        return;
      }
      const data = await res.json();
      onSuccess(data.activeActivityCount, data.soldier.id);
    } catch {
      setError("שגיאה בהוספת החייל");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="soldier-given">שם פרטי *</Label>
          <Input
            id="soldier-given"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            placeholder="שם פרטי"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="soldier-family">שם משפחה *</Label>
          <Input
            id="soldier-family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder="שם משפחה"
            required
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
          <Select value={status} onValueChange={(v) => setStatus(v ?? "active")}>
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

      {!singleSquad && (
        <div className="space-y-1.5">
          <Label>כיתה</Label>
          <Select
            value={squadId}
            onValueChange={(v) => setSquadId(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="בחר כיתה">
                {squads.find((s) => s.id === squadId)?.name ?? "בחר כיתה"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {squads.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
          disabled={
            loading ||
            !givenName.trim() ||
            !familyName.trim() ||
            !squadId
          }
        >
          {loading ? "מוסיף..." : "הוסף חייל"}
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
