"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS, UNIT_TYPE_FOR_ROLE } from "@/lib/auth/permissions";
import type { Role } from "@/types";

type Squad = { id: string; name: string };
type Platoon = { id: string; name: string; squads: Squad[] };
type Company = { id: string; name: string; platoons: Platoon[] };
type Cycle = { id: string; name: string };

type Props = {
  userId: string;
  cycles: Cycle[];
  structureByCycle: Record<string, Company[]>;
  onSuccess: () => void;
  onCancel: () => void;
};

const ROLES: Role[] = ["company_commander", "deputy_company_commander", "platoon_commander", "platoon_sergeant", "squad_commander", "instructor", "company_medic", "hardship_coordinator"];

export function AssignUserForm({ userId, cycles, structureByCycle, onSuccess, onCancel }: Props) {
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? "");
  const [role, setRole] = useState<Role>("squad_commander");
  const [unitId, setUnitId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companies = structureByCycle[cycleId] ?? [];
  const unitType = UNIT_TYPE_FOR_ROLE[role];

  const unitOptions: { id: string; name: string }[] = (() => {
    if (unitType === "company") return companies.map((c) => ({ id: c.id, name: c.name }));
    if (unitType === "platoon")
      return companies.flatMap((c) => c.platoons.map((p) => ({ id: p.id, name: `${c.name} / ${p.name}` })));
    return companies.flatMap((c) =>
      c.platoons.flatMap((p) =>
        p.squads.map((s) => ({ id: s.id, name: `${c.name} / ${p.name} / ${s.name}` }))
      )
    );
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cycleId || !unitId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, role, unitType, unitId }),
      });
      if (!res.ok) {
        setError("שגיאה בשמירת השיבוץ");
        return;
      }
      onSuccess();
    } catch {
      setError("שגיאה בשמירת השיבוץ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
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
        <Select value={role} onValueChange={(v) => { setRole((v ?? "squad_commander") as Role); setUnitId(""); }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="בחר תפקיד">
              {ROLE_LABELS[role]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
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
          <p className="text-xs text-muted-foreground">אין יחידות במחזור זה.</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-row-reverse gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          ביטול
        </Button>
        <Button type="submit" disabled={loading || !unitId}>
          {loading ? "שומר..." : "שבץ"}
        </Button>
      </div>
    </form>
  );
}
