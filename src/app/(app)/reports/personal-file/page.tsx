"use client";

import { useEffect, useState, useMemo } from "react";
import { ArrowRight, Download, Loader2, SlidersHorizontal, FileText } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useCycle } from "@/contexts/CycleContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SoldierSummary {
  id: string;
  givenName: string;
  familyName: string;
  idNumber: string | null;
  rank: string | null;
  status: string;
  profileImage: string | null;
  squadName: string;
  platoonId: string;
  platoonName: string;
}

interface Platoon {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: "פעיל",
  transferred: "הועבר",
  dropped: "נשר",
  injured: "פצוע",
};

export default function PersonalFilePage() {
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [soldiers, setSoldiers] = useState<SoldierSummary[]>([]);
  const [platoons, setPlatoons] = useState<Platoon[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatoonId, setSelectedPlatoonId] = useState("all");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [exportingSoldierId, setExportingSoldierId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    fetch(`/api/reports/personal-file?cycleId=${selectedCycleId}`)
      .then((res) => res.json())
      .then((data) => {
        setSoldiers(data.soldiers ?? []);
        setPlatoons(data.platoons ?? []);
      })
      .catch(() => toast.error("שגיאה בטעינת נתונים"))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  const isMultiPlatoon = platoons.length > 1;

  const filtered = useMemo(() => {
    if (selectedPlatoonId === "all") return soldiers;
    return soldiers.filter((s) => s.platoonId === selectedPlatoonId);
  }, [soldiers, selectedPlatoonId]);

  async function handleExportPdf(soldier: SoldierSummary) {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    setExportingSoldierId(soldier.id);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId!, soldierId: soldier.id });
      const res = await fetch(`/api/reports/personal-file/pdf?${params}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `תיק-אישי-${soldier.familyName}-${soldier.givenName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("שגיאה בהפקת הדוח");
    } finally {
      setExportingSoldierId(null);
    }
  }

  if (cycleLoading) return null;

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/reports" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowRight size={18} />
            </Link>
            <h1 className="text-lg font-bold">תיק אישי</h1>
          </div>

          {/* Mobile filter toggle */}
          {isMultiPlatoon && (
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={cn(
                "relative md:hidden flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                mobileFiltersOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground",
              )}
            >
              <SlidersHorizontal size={15} />
              <span>סינון</span>
              {selectedPlatoonId !== "all" && (
                <span className="absolute -top-1.5 -left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  1
                </span>
              )}
            </button>
          )}
        </div>

        {/* Mobile filter panel */}
        {mobileFiltersOpen && isMultiPlatoon && (
          <div className="md:hidden">
            <select
              value={selectedPlatoonId}
              onChange={(e) => setSelectedPlatoonId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">כל המחלקות</option>
              {platoons.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Desktop filter */}
        {isMultiPlatoon && (
          <div className="hidden md:block">
            <select
              value={selectedPlatoonId}
              onChange={(e) => setSelectedPlatoonId(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">כל המחלקות</option>
              {platoons.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="p-4 space-y-2 pb-32">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
            <FileText size={32} className="text-muted-foreground" />
            <p className="text-muted-foreground">אין חיילים להצגה</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                {/* Avatar */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                  {s.profileImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.profileImage} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span>{(s.givenName[0] ?? "") + (s.familyName[0] ?? "")}</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{s.familyName} {s.givenName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.platoonName} / {s.squadName}
                    {s.rank && ` · ${s.rank}`}
                    {s.idNumber && ` · מ.א. ${s.idNumber}`}
                  </p>
                </div>

                {/* Export button */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportingSoldierId === s.id}
                  onClick={() => handleExportPdf(s)}
                >
                  {exportingSoldierId === s.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} className="ml-1" />
                  )}
                  PDF
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
