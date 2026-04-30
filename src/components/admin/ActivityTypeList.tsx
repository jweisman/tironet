"use client";

import { useState } from "react";
import { toast } from "sonner";
import * as LucideIcons from "lucide-react";
import { PlusCircle, Pencil, Trash2, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ScoreConfig, ScoreSlot } from "@/types/score-config";
import { SCORE_KEYS, getActiveScores } from "@/types/score-config";
import type { DisplayConfiguration } from "@/types/display-config";
import { DEFAULT_RESULT_LABELS, getResultLabels, getNoteOptions } from "@/types/display-config";

type ExportCategory = "physical" | "test" | "military" | "navigation";

const EXPORT_CATEGORY_LABELS: Record<ExportCategory, string> = {
  physical: "אימון גופני",
  test: "בוחן",
  military: "אימון צבאי",
  navigation: "ניווט",
};

type ActivityType = {
  id: string;
  name: string;
  icon: string;
  isActive: boolean;
  scoreConfig: ScoreConfig | null;
  displayConfiguration: DisplayConfiguration | null;
  exportCategory: ExportCategory | null;
};

type Props = {
  initialTypes: ActivityType[];
};

interface EditScoreSlot {
  label: string;
  format: "number" | "time";
  threshold: string;
  thresholdOperator: ">" | ">=" | "<" | "<=" | "";
}

function LucideIcon({ name, className }: { name: string; className?: string }) {
  const icons = LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  const pascalName = name
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const Icon = icons[pascalName];
  if (!Icon) return <span className={className}>?</span>;
  return <Icon className={className} />;
}

function activeScoreCount(type: ActivityType): number {
  return getActiveScores(type.scoreConfig).length;
}

const FORMAT_LABELS: Record<string, string> = {
  number: "מספר",
  time: "זמן (M:SS)",
};

export default function ActivityTypeList({ initialTypes }: Props) {
  const [types, setTypes] = useState<ActivityType[]>(initialTypes);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("Activity");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editScores, setEditScores] = useState<EditScoreSlot[]>(
    Array.from({ length: 6 }, () => ({ label: "", format: "number" as const, threshold: "", thresholdOperator: "" as const }))
  );
  const [editFailureThreshold, setEditFailureThreshold] = useState("");
  const [scoresExpandedId, setScoresExpandedId] = useState<string | null>(null);
  const [editResultLabels, setEditResultLabels] = useState({ completed: "", skipped: "", na: "" });
  const [editNoteOptions, setEditNoteOptions] = useState<string[]>([]);
  const [editExportCategory, setEditExportCategory] = useState<ExportCategory | "">("");
  const [loading, setLoading] = useState(false);

  function startEdit(type: ActivityType) {
    setEditingId(type.id);
    setEditName(type.name);
    setEditIcon(type.icon);
    const config = type.scoreConfig;
    setEditScores(
      SCORE_KEYS.map((k) => {
        const slot = config?.[k];
        return slot
          ? { label: slot.label, format: slot.format ?? "number", threshold: slot.threshold != null ? String(slot.threshold) : "", thresholdOperator: slot.thresholdOperator ?? "" }
          : { label: "", format: "number" as const, threshold: "", thresholdOperator: "" as const };
      })
    );
    setEditFailureThreshold(config?.failureThreshold != null ? String(config.failureThreshold) : "");
    const labels = getResultLabels(type.displayConfiguration);
    setEditResultLabels({
      completed: labels.completed.label,
      skipped: labels.skipped.label,
      na: labels.na.label,
    });
    const noteOpts = getNoteOptions(type.displayConfiguration);
    setEditNoteOptions(noteOpts ?? []);
    setEditExportCategory(type.exportCategory ?? "");
    setScoresExpandedId(type.id);
  }

  function buildScoreConfig(scores: EditScoreSlot[]): ScoreConfig {
    const config = {} as ScoreConfig;
    SCORE_KEYS.forEach((k, i) => {
      const slot = scores[i];
      if (!slot.label.trim()) {
        config[k] = null;
      } else {
        config[k] = {
          label: slot.label.trim(),
          format: slot.format,
          ...(slot.threshold.trim() && slot.thresholdOperator
            ? { threshold: Number(slot.threshold), thresholdOperator: slot.thresholdOperator }
            : {}),
        };
      }
    });
    const ft = editFailureThreshold.trim();
    if (ft) config.failureThreshold = Number(ft);
    return config;
  }

  function buildDisplayConfig(): DisplayConfiguration | null {
    const completed = editResultLabels.completed.trim();
    const skipped = editResultLabels.skipped.trim();
    const na = editResultLabels.na.trim();
    const isDefault =
      completed === DEFAULT_RESULT_LABELS.completed.label &&
      skipped === DEFAULT_RESULT_LABELS.skipped.label &&
      na === DEFAULT_RESULT_LABELS.na.label;
    const filteredOptions = editNoteOptions.map((o) => o.trim()).filter(Boolean);
    if (isDefault && filteredOptions.length === 0) return null;
    const config: DisplayConfiguration = {};
    if (!isDefault) {
      config.results = {
        completed: { label: completed || DEFAULT_RESULT_LABELS.completed.label },
        skipped: { label: skipped || DEFAULT_RESULT_LABELS.skipped.label },
        na: { label: na || DEFAULT_RESULT_LABELS.na.label },
      };
    }
    if (filteredOptions.length > 0) {
      config.note = { type: "list", options: filteredOptions };
    }
    return config;
  }

  async function handleAdd() {
    if (!newName.trim() || !newIcon.trim()) return;
    setLoading(true);
    const res = await fetch("/api/admin/activity-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), icon: newIcon.trim() }),
    });
    if (res.ok) {
      const type = await res.json();
      setTypes((prev) => [...prev, type]);
      setNewName("");
      setNewIcon("Activity");
      setAdding(false);
    }
    setLoading(false);
  }

  async function handleToggleActive(type: ActivityType) {
    const res = await fetch(`/api/admin/activity-types/${type.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !type.isActive }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    }
  }

  async function handleEdit(id: string) {
    if (!editName.trim() || !editIcon.trim()) return;
    setLoading(true);
    const res = await fetch(`/api/admin/activity-types/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        icon: editIcon.trim(),
        scoreConfig: buildScoreConfig(editScores),
        displayConfiguration: buildDisplayConfig(),
        exportCategory: editExportCategory || null,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingId(null);
      setScoresExpandedId(null);
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/activity-types/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTypes((prev) => prev.filter((t) => t.id !== id));
      toast.success("סוג הפעילות נמחק");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">סוגי פעילות</h2>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <PlusCircle className="w-4 h-4 ms-2" />
          הוסף סוג
        </Button>
      </div>

      {adding && (
        <div className="flex flex-wrap gap-2 items-center p-3 border rounded-lg bg-muted/30">
          <Input
            autoFocus
            placeholder="שם סוג פעילות"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="max-w-48"
          />
          <div className="flex items-center gap-2">
            <Input
              placeholder="שם אייקון (Lucide)"
              value={newIcon}
              onChange={(e) => setNewIcon(e.target.value)}
              className="max-w-40"
            />
            <div className="w-8 h-8 flex items-center justify-center border rounded text-muted-foreground">
              <LucideIcon name={newIcon} className="w-5 h-5" />
            </div>
          </div>
          <Button size="sm" onClick={handleAdd} disabled={loading || !newName.trim() || !newIcon.trim()} aria-label="אישור">
            <Check className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); setNewIcon("Activity"); }} aria-label="ביטול">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        שם האייקון חייב להיות שם Lucide תקין, לדוגמה: Dumbbell, Run, Shield, Target, Flame, Heart, Zap
      </p>

      <div className="space-y-2">
        {types.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8">אין סוגי פעילות</p>
        )}
        {types.map((type) => (
          <div
            key={type.id}
            className="border rounded-lg"
          >
            <div className="flex items-center gap-3 p-3">
              <div className="w-9 h-9 flex items-center justify-center rounded-md bg-muted">
                <LucideIcon name={type.icon} className="w-5 h-5" />
              </div>

              {editingId === type.id ? (
                <>
                  <Input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="max-w-40"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={editIcon}
                      onChange={(e) => setEditIcon(e.target.value)}
                      className="max-w-32"
                      placeholder="אייקון"
                    />
                    <div className="w-7 h-7 flex items-center justify-center border rounded">
                      <LucideIcon name={editIcon} className="w-4 h-4" />
                    </div>
                  </div>
                  <Button size="sm" onClick={() => handleEdit(type.id)} disabled={loading} aria-label="שמור">
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setScoresExpandedId(null); }} aria-label="ביטול">
                    <X className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{type.name}</span>
                    <span className="text-xs text-muted-foreground ms-2">
                      {activeScoreCount(type) === 0 ? "ללא ציונים" : activeScoreCount(type) === 1 ? "ציון 1" : `${activeScoreCount(type)} ציונים`}
                    </span>
                  </div>
                  <Badge variant={type.isActive ? "default" : "secondary"}>
                    {type.isActive ? "פעיל" : "לא פעיל"}
                  </Badge>
                  <Switch
                    checked={type.isActive}
                    onCheckedChange={() => handleToggleActive(type)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="הגדרות ציונים"
                    onClick={() => setScoresExpandedId(scoresExpandedId === type.id ? null : type.id)}
                  >
                    {scoresExpandedId === type.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="ערוך סוג פעילות"
                    onClick={() => startEdit(type)}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" aria-label="מחק סוג פעילות" />}
                    >
                      <Trash2 className="w-4 h-4" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>מחיקת סוג פעילות</AlertDialogTitle>
                        <AlertDialogDescription>
                          האם אתה בטוח שברצונך למחוק את &quot;{type.name}&quot;?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>ביטול</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(type.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          מחק
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>

            {/* Score config section (view or edit) */}
            {scoresExpandedId === type.id && (
              <div className="border-t px-3 py-3 bg-muted/20 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">הגדרות ציונים (השאר ריק לביטול)</p>
                <div className="space-y-2">
                  {SCORE_KEYS.map((key, i) => {
                    if (editingId === type.id) {
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                          <Input
                            placeholder={`ציון ${i + 1}`}
                            value={editScores[i].label}
                            onChange={(e) => setEditScores((prev) => {
                              const next = [...prev];
                              next[i] = { ...next[i], label: e.target.value };
                              return next;
                            })}
                            className="text-xs flex-1"
                          />
                          <Select
                            value={editScores[i].format}
                            onValueChange={(v) => {
                              if (!v) return;
                              setEditScores((prev) => {
                                const next = [...prev];
                                next[i] = { ...next[i], format: v as "number" | "time" };
                                return next;
                              });
                            }}
                          >
                            <SelectTrigger className="w-28 text-xs h-8">
                              <SelectValue>
                                {FORMAT_LABELS[editScores[i].format]}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="number">מספר</SelectItem>
                              <SelectItem value="time">זמן (M:SS)</SelectItem>
                            </SelectContent>
                          </Select>
                          {editScores[i].label.trim() && (
                            <>
                              <select
                                value={editScores[i].thresholdOperator}
                                onChange={(e) => setEditScores((prev) => {
                                  const next = [...prev];
                                  next[i] = { ...next[i], thresholdOperator: e.target.value as EditScoreSlot["thresholdOperator"] };
                                  return next;
                                })}
                                className="rounded-md border border-border bg-background px-1.5 py-1 text-xs h-8 w-14"
                                aria-label="אופרטור סף"
                              >
                                <option value="">—</option>
                                <option value=">">&gt;</option>
                                <option value=">=">&gt;=</option>
                                <option value="<">&lt;</option>
                                <option value="<=">&lt;=</option>
                              </select>
                              <Input
                                placeholder="סף"
                                value={editScores[i].threshold}
                                onChange={(e) => setEditScores((prev) => {
                                  const next = [...prev];
                                  next[i] = { ...next[i], threshold: e.target.value };
                                  return next;
                                })}
                                className="text-xs w-16 h-8"
                                inputMode="numeric"
                              />
                            </>
                          )}
                        </div>
                      );
                    }
                    const slot: ScoreSlot | null = type.scoreConfig?.[key] ?? null;
                    return slot ? (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs bg-background border rounded px-2 py-1">
                          {i + 1}. {slot.label}
                        </span>
                        {slot.format === "time" && (
                          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                            M:SS
                          </span>
                        )}
                        {slot.threshold != null && slot.thresholdOperator && (
                          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                            נכשל אם {slot.thresholdOperator === ">" ? "גדול מ" : slot.thresholdOperator === ">=" ? "גדול או שווה ל" : slot.thresholdOperator === "<" ? "קטן מ" : "קטן או שווה ל"}{slot.threshold}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span key={key} className="text-xs text-muted-foreground/50 px-2 py-1 block">
                        {i + 1}. —
                      </span>
                    );
                  })}
                </div>

                {/* Failure threshold (edit mode only, shown when any score has a threshold) */}
                {editingId === type.id && editScores.some((s) => s.label.trim() && s.threshold.trim() && s.thresholdOperator) && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground shrink-0">מספר ציונים כושלים לסימון ככישלון:</span>
                    <Input
                      value={editFailureThreshold}
                      onChange={(e) => setEditFailureThreshold(e.target.value)}
                      className="text-xs w-16 h-8"
                      inputMode="numeric"
                      placeholder="—"
                    />
                  </div>
                )}

                {/* View mode: show failure threshold if configured */}
                {editingId !== type.id && type.scoreConfig?.failureThreshold && (
                  <p className="text-xs text-muted-foreground pt-1">
                    סף כישלון: {type.scoreConfig.failureThreshold} ציונים כושלים
                  </p>
                )}

                {/* Display configuration section */}
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">תצוגת תוצאות</p>
                  {editingId === type.id ? (
                    <div className="space-y-2">
                      {(["completed", "skipped", "na"] as const).map((key) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-20 shrink-0 text-end">
                            {key === "completed" ? "ביצע:" : key === "skipped" ? "לא ביצע:" : "לא רלוונטי:"}
                          </span>
                          <Input
                            placeholder={DEFAULT_RESULT_LABELS[key].label}
                            value={editResultLabels[key]}
                            onChange={(e) => setEditResultLabels((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="text-xs flex-1"
                          />
                        </div>
                      ))}

                      <p className="text-xs font-semibold text-muted-foreground mt-3">אפשרויות הערה (רשימה נפתחת)</p>
                      <div className="space-y-1">
                        {editNoteOptions.map((opt, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              value={opt}
                              onChange={(e) => setEditNoteOptions((prev) => {
                                const next = [...prev];
                                next[i] = e.target.value;
                                return next;
                              })}
                              className="text-xs flex-1"
                              placeholder={`אפשרות ${i + 1}`}
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              onClick={() => setEditNoteOptions((prev) => prev.filter((_, j) => j !== i))}
                              aria-label="הסר אפשרות"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => setEditNoteOptions((prev) => [...prev, ""])}
                        >
                          <PlusCircle className="w-3 h-3 me-1" />
                          הוסף אפשרות
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        השאר ריק לשדה הערה חופשי. הוסף אפשרויות כדי להציג רשימה נפתחת.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {(() => {
                        const labels = getResultLabels(type.displayConfiguration);
                        const noteOpts = getNoteOptions(type.displayConfiguration);
                        const isDefault =
                          labels.completed.label === DEFAULT_RESULT_LABELS.completed.label &&
                          labels.skipped.label === DEFAULT_RESULT_LABELS.skipped.label &&
                          labels.na.label === DEFAULT_RESULT_LABELS.na.label;
                        return (
                          <>
                            {isDefault ? (
                              <p className="text-xs text-muted-foreground/50">ברירת מחדל ({DEFAULT_RESULT_LABELS.completed.label} / {DEFAULT_RESULT_LABELS.skipped.label} / {DEFAULT_RESULT_LABELS.na.label})</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {(["completed", "skipped", "na"] as const).map((key) => (
                                  <span key={key} className="text-xs bg-background border rounded px-2 py-1">
                                    {labels[key].label}
                                  </span>
                                ))}
                              </div>
                            )}
                            {noteOpts && noteOpts.length > 0 && (
                              <div className="mt-1">
                                <span className="text-[10px] text-muted-foreground">הערה (רשימה): </span>
                                <span className="text-xs">{noteOpts.join(", ")}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Export category section */}
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">קטגוריית ייצוא (דוח מדא&quot;גיות)</p>
                  {editingId === type.id ? (
                    <div className="space-y-1">
                      <select
                        value={editExportCategory}
                        onChange={(e) => setEditExportCategory(e.target.value as ExportCategory | "")}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                      >
                        <option value="">ללא</option>
                        {(Object.entries(EXPORT_CATEGORY_LABELS) as [ExportCategory, string][]).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-muted-foreground">
                        פעילויות עם קטגוריה ייכללו בדוח מדא&quot;גיות בגיליון המתאים.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/50">
                      {type.exportCategory
                        ? EXPORT_CATEGORY_LABELS[type.exportCategory]
                        : "לא מוגדר"}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
