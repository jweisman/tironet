"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  PlusCircle,
  Pencil,
  Trash2,
  Check,
  X,
  Building2,
  Users,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

type Squad = { id: string; name: string };
type Platoon = { id: string; name: string; squads: Squad[] };
type Company = { id: string; name: string; platoons: Platoon[] };
type Cycle = { id: string; name: string };

type Props = {
  cycles: Cycle[];
  initialStructure: Record<string, Company[]>;
};

type InlineFormProps = {
  placeholder: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
};

function InlineForm({ placeholder, onSave, onCancel }: InlineFormProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setLoading(true);
    await onSave(name.trim());
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2 mt-2 ms-2">
      <Input
        autoFocus
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        className="h-8 max-w-48 text-sm"
      />
      <Button size="icon" className="h-8 w-8" onClick={submit} disabled={loading || !name.trim()}>
        <Check className="w-3 h-3" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCancel} aria-label="ביטול">
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}

type EditInlineProps = {
  initialName: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
};

function EditInline({ initialName, onSave, onCancel }: EditInlineProps) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setLoading(true);
    await onSave(name.trim());
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        className="h-7 max-w-40 text-sm"
      />
      <Button size="icon" className="h-7 w-7" onClick={submit} disabled={loading || !name.trim()}>
        <Check className="w-3 h-3" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCancel} aria-label="ביטול">
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}

// ---- Sortable wrappers ----

function SortableCompanyRow({
  id,
  children,
}: {
  id: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      aria-label="גרור לסידור מחדש"
      className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
    >
      <GripVertical className="w-4 h-4" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-50 z-50 relative")}>
      {children(handle)}
    </div>
  );
}

function SortablePlatoonRow({
  id,
  children,
}: {
  id: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      aria-label="גרור לסידור מחדש"
      className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
    >
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-50 z-50 relative")}>
      {children(handle)}
    </div>
  );
}

function SortableSquadRow({
  id,
  children,
}: {
  id: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      aria-label="גרור לסידור מחדש"
      className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
    >
      <GripVertical className="w-3 h-3" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-50 z-50 relative")}>
      {children(handle)}
    </div>
  );
}

export default function StructureTree({ cycles, initialStructure }: Props) {
  const [selectedCycleId, setSelectedCycleId] = useState(cycles[0]?.id ?? "");
  const [structure, setStructure] = useState<Record<string, Company[]>>(initialStructure);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [expandedPlatoons, setExpandedPlatoons] = useState<Set<string>>(new Set());

  const [addingCompany, setAddingCompany] = useState(false);
  const [addingPlatoonId, setAddingPlatoonId] = useState<string | null>(null);
  const [addingSquadId, setAddingSquadId] = useState<string | null>(null);

  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingPlatoonId, setEditingPlatoonId] = useState<string | null>(null);
  const [editingSquadId, setEditingSquadId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const companies = structure[selectedCycleId] ?? [];

  async function mutate(url: string, method: string, body: object) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function updateStructure(cycleId: string, updater: (companies: Company[]) => Company[]) {
    setStructure((prev) => ({
      ...prev,
      [cycleId]: updater(prev[cycleId] ?? []),
    }));
  }

  // --- Reorder ---
  async function reorderCompanies(newOrder: Company[]) {
    const ids = newOrder.map((c) => c.id);
    updateStructure(selectedCycleId, () => newOrder);
    await mutate("/api/admin/structure/reorder", "PATCH", { type: "company", ids });
  }

  async function reorderPlatoons(companyId: string, newOrder: Platoon[]) {
    const ids = newOrder.map((p) => p.id);
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) => (c.id === companyId ? { ...c, platoons: newOrder } : c))
    );
    await mutate("/api/admin/structure/reorder", "PATCH", { type: "platoon", ids });
  }

  async function reorderSquads(companyId: string, platoonId: string, newOrder: Squad[]) {
    const ids = newOrder.map((s) => s.id);
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) =>
        c.id === companyId
          ? {
              ...c,
              platoons: c.platoons.map((p) =>
                p.id === platoonId ? { ...p, squads: newOrder } : p
              ),
            }
          : c
      )
    );
    await mutate("/api/admin/structure/reorder", "PATCH", { type: "squad", ids });
  }

  function handleCompanyDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = companies.findIndex((c) => c.id === active.id);
    const newIndex = companies.findIndex((c) => c.id === over.id);
    reorderCompanies(arrayMove(companies, oldIndex, newIndex));
  }

  function handlePlatoonDragEnd(companyId: string, platoons: Platoon[]) {
    return (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = platoons.findIndex((p) => p.id === active.id);
      const newIndex = platoons.findIndex((p) => p.id === over.id);
      reorderPlatoons(companyId, arrayMove(platoons, oldIndex, newIndex));
    };
  }

  function handleSquadDragEnd(companyId: string, platoonId: string, squads: Squad[]) {
    return (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = squads.findIndex((s) => s.id === active.id);
      const newIndex = squads.findIndex((s) => s.id === over.id);
      reorderSquads(companyId, platoonId, arrayMove(squads, oldIndex, newIndex));
    };
  }

  // --- Company operations ---
  async function addCompany(name: string) {
    const company = await mutate("/api/admin/structure", "POST", {
      type: "company",
      cycleId: selectedCycleId,
      name,
    });
    updateStructure(selectedCycleId, (prev) => [...prev, { ...company, platoons: [] }]);
    setAddingCompany(false);
    setExpandedCompanies((prev) => new Set([...prev, company.id]));
  }

  async function renameCompany(companyId: string, name: string) {
    await mutate(`/api/admin/structure/${companyId}`, "PATCH", { type: "company", name });
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) => (c.id === companyId ? { ...c, name } : c))
    );
    setEditingCompanyId(null);
  }

  async function deleteCompany(companyId: string) {
    await mutate(`/api/admin/structure/${companyId}`, "DELETE", { type: "company" });
    updateStructure(selectedCycleId, (prev) => prev.filter((c) => c.id !== companyId));
    toast.success("הפלוגה נמחקה");
  }

  // --- Platoon operations ---
  async function addPlatoon(companyId: string, name: string) {
    const platoon = await mutate("/api/admin/structure", "POST", {
      type: "platoon",
      companyId,
      name,
    });
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) =>
        c.id === companyId
          ? { ...c, platoons: [...c.platoons, { ...platoon, squads: [] }] }
          : c
      )
    );
    setAddingPlatoonId(null);
    setExpandedPlatoons((prev) => new Set([...prev, platoon.id]));
  }

  async function renamePlatoon(companyId: string, platoonId: string, name: string) {
    await mutate(`/api/admin/structure/${platoonId}`, "PATCH", { type: "platoon", name });
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) =>
        c.id === companyId
          ? { ...c, platoons: c.platoons.map((p) => (p.id === platoonId ? { ...p, name } : p)) }
          : c
      )
    );
    setEditingPlatoonId(null);
  }

  async function deletePlatoon(companyId: string, platoonId: string) {
    await mutate(`/api/admin/structure/${platoonId}`, "DELETE", { type: "platoon" });
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) =>
        c.id === companyId
          ? { ...c, platoons: c.platoons.filter((p) => p.id !== platoonId) }
          : c
      )
    );
    toast.success("המחלקה נמחקה");
  }

  // --- Squad operations ---
  async function addSquad(companyId: string, platoonId: string, name: string) {
    const squad = await mutate("/api/admin/structure", "POST", { type: "squad", platoonId, name });
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) =>
        c.id === companyId
          ? {
              ...c,
              platoons: c.platoons.map((p) =>
                p.id === platoonId ? { ...p, squads: [...p.squads, squad] } : p
              ),
            }
          : c
      )
    );
    setAddingSquadId(null);
  }

  async function renameSquad(
    companyId: string,
    platoonId: string,
    squadId: string,
    name: string
  ) {
    await mutate(`/api/admin/structure/${squadId}`, "PATCH", { type: "squad", name });
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) =>
        c.id === companyId
          ? {
              ...c,
              platoons: c.platoons.map((p) =>
                p.id === platoonId
                  ? { ...p, squads: p.squads.map((s) => (s.id === squadId ? { ...s, name } : s)) }
                  : p
              ),
            }
          : c
      )
    );
    setEditingSquadId(null);
  }

  async function deleteSquad(companyId: string, platoonId: string, squadId: string) {
    await mutate(`/api/admin/structure/${squadId}`, "DELETE", { type: "squad" });
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) =>
        c.id === companyId
          ? {
              ...c,
              platoons: c.platoons.map((p) =>
                p.id === platoonId
                  ? { ...p, squads: p.squads.filter((s) => s.id !== squadId) }
                  : p
              ),
            }
          : c
      )
    );
    toast.success("הכיתה נמחקה");
  }

  function toggleCompany(id: string) {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function togglePlatoon(id: string) {
    setExpandedPlatoons((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">מבנה פיקוד</h2>
        <Select
          value={selectedCycleId}
          onValueChange={(v) => {
            setSelectedCycleId(v ?? "");
            setAddingCompany(false);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="בחר מחזור">
              {cycles.find((c) => c.id === selectedCycleId)?.name ?? "בחר מחזור"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {cycles.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedCycleId && (
        <p className="text-muted-foreground text-sm">אין מחזורים. צור מחזור תחילה.</p>
      )}

      {selectedCycleId && (
        <div className="space-y-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleCompanyDragEnd}
          >
            <SortableContext items={companies.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {companies.map((company) => {
                const companyExpanded = expandedCompanies.has(company.id);
                return (
                  <SortableCompanyRow key={company.id} id={company.id}>
                    {(dragHandle) => (
                      <div className="border rounded-lg overflow-hidden">
                        {/* Company row */}
                        <div className="flex items-center gap-2 p-2.5 bg-muted/30">
                          {dragHandle}
                          <button
                            onClick={() => toggleCompany(company.id)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {companyExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                          <Building2 className="w-4 h-4 text-primary shrink-0" />
                          {editingCompanyId === company.id ? (
                            <EditInline
                              initialName={company.name}
                              onSave={(name) => renameCompany(company.id, name)}
                              onCancel={() => setEditingCompanyId(null)}
                            />
                          ) : (
                            <>
                              <span className="flex-1 font-medium text-sm">{company.name}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setAddingPlatoonId(company.id);
                                  setExpandedCompanies((prev) => new Set([...prev, company.id]));
                                }}
                              >
                                <PlusCircle className="w-3 h-3 ms-1" />
                                מחלקה
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setEditingCompanyId(company.id)}
                                aria-label="ערוך פלוגה"
                              >
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger
                                  render={
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      aria-label="מחק פלוגה"
                                    />
                                  }
                                >
                                  <Trash2 className="w-3 h-3" />
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>מחיקת פלוגה</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      האם אתה בטוח שברצונך למחוק את הפלוגה &quot;{company.name}&quot;?
                                      כל המחלקות והכיתות שלה יימחקו.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>ביטול</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteCompany(company.id)}
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

                        {/* Platoons */}
                        {companyExpanded && (
                          <div className="ps-6 border-t">
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={handlePlatoonDragEnd(company.id, company.platoons)}
                            >
                              <SortableContext
                                items={company.platoons.map((p) => p.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                {company.platoons.map((platoon) => {
                                  const platoonExpanded = expandedPlatoons.has(platoon.id);
                                  return (
                                    <SortablePlatoonRow key={platoon.id} id={platoon.id}>
                                      {(platoonDragHandle) => (
                                        <div className="border-b last:border-b-0">
                                          {/* Platoon row */}
                                          <div className="flex items-center gap-2 p-2 ps-2">
                                            {platoonDragHandle}
                                            <button
                                              onClick={() => togglePlatoon(platoon.id)}
                                              className="text-muted-foreground hover:text-foreground"
                                            >
                                              {platoonExpanded ? (
                                                <ChevronDown className="w-3.5 h-3.5" />
                                              ) : (
                                                <ChevronRight className="w-3.5 h-3.5" />
                                              )}
                                            </button>
                                            <Users className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                            {editingPlatoonId === platoon.id ? (
                                              <EditInline
                                                initialName={platoon.name}
                                                onSave={(name) =>
                                                  renamePlatoon(company.id, platoon.id, name)
                                                }
                                                onCancel={() => setEditingPlatoonId(null)}
                                              />
                                            ) : (
                                              <>
                                                <span className="flex-1 text-sm">{platoon.name}</span>
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  className="h-6 px-2 text-xs"
                                                  onClick={() => {
                                                    setAddingSquadId(platoon.id);
                                                    setExpandedPlatoons(
                                                      (prev) => new Set([...prev, platoon.id])
                                                    );
                                                  }}
                                                >
                                                  <PlusCircle className="w-3 h-3 ms-1" />
                                                  כיתה
                                                </Button>
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-6 w-6"
                                                  onClick={() => setEditingPlatoonId(platoon.id)}
                                                  aria-label="ערוך מחלקה"
                                                >
                                                  <Pencil className="w-3 h-3" />
                                                </Button>
                                                <AlertDialog>
                                                  <AlertDialogTrigger
                                                    render={
                                                      <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-6 w-6 text-destructive hover:text-destructive"
                                                        aria-label="מחק מחלקה"
                                                      />
                                                    }
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </AlertDialogTrigger>
                                                  <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                      <AlertDialogTitle>מחיקת מחלקה</AlertDialogTitle>
                                                      <AlertDialogDescription>
                                                        האם אתה בטוח שברצונך למחוק את המחלקה &quot;
                                                        {platoon.name}&quot;? כל הכיתות שלה יימחקו.
                                                      </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                      <AlertDialogCancel>ביטול</AlertDialogCancel>
                                                      <AlertDialogAction
                                                        onClick={() =>
                                                          deletePlatoon(company.id, platoon.id)
                                                        }
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

                                          {/* Squads */}
                                          {platoonExpanded && (
                                            <div
                                              className={cn(
                                                "ps-8 pb-1",
                                                platoon.squads.length > 0 && "border-t border-dashed"
                                              )}
                                            >
                                              <DndContext
                                                sensors={sensors}
                                                collisionDetection={closestCenter}
                                                onDragEnd={handleSquadDragEnd(
                                                  company.id,
                                                  platoon.id,
                                                  platoon.squads
                                                )}
                                              >
                                                <SortableContext
                                                  items={platoon.squads.map((s) => s.id)}
                                                  strategy={verticalListSortingStrategy}
                                                >
                                                  {platoon.squads.map((squad) => (
                                                    <SortableSquadRow key={squad.id} id={squad.id}>
                                                      {(squadDragHandle) => (
                                                        <div className="flex items-center gap-2 py-1.5 px-2">
                                                          {squadDragHandle}
                                                          <Shield className="w-3 h-3 text-green-600 shrink-0" />
                                                          {editingSquadId === squad.id ? (
                                                            <EditInline
                                                              initialName={squad.name}
                                                              onSave={(name) =>
                                                                renameSquad(
                                                                  company.id,
                                                                  platoon.id,
                                                                  squad.id,
                                                                  name
                                                                )
                                                              }
                                                              onCancel={() => setEditingSquadId(null)}
                                                            />
                                                          ) : (
                                                            <>
                                                              <span className="flex-1 text-sm text-muted-foreground">
                                                                {squad.name}
                                                              </span>
                                                              <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-6 w-6"
                                                                onClick={() =>
                                                                  setEditingSquadId(squad.id)
                                                                }
                                                                aria-label="ערוך כיתה"
                                                              >
                                                                <Pencil className="w-3 h-3" />
                                                              </Button>
                                                              <AlertDialog>
                                                                <AlertDialogTrigger
                                                                  render={
                                                                    <Button
                                                                      size="icon"
                                                                      variant="ghost"
                                                                      className="h-6 w-6 text-destructive hover:text-destructive"
                                                                      aria-label="מחק כיתה"
                                                                    />
                                                                  }
                                                                >
                                                                  <Trash2 className="w-3 h-3" />
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                  <AlertDialogHeader>
                                                                    <AlertDialogTitle>
                                                                      מחיקת כיתה
                                                                    </AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                      האם אתה בטוח שברצונך למחוק את
                                                                      הכיתה &quot;{squad.name}&quot;?
                                                                    </AlertDialogDescription>
                                                                  </AlertDialogHeader>
                                                                  <AlertDialogFooter>
                                                                    <AlertDialogCancel>
                                                                      ביטול
                                                                    </AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                      onClick={() =>
                                                                        deleteSquad(
                                                                          company.id,
                                                                          platoon.id,
                                                                          squad.id
                                                                        )
                                                                      }
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
                                                      )}
                                                    </SortableSquadRow>
                                                  ))}
                                                </SortableContext>
                                              </DndContext>
                                              {addingSquadId === platoon.id && (
                                                <InlineForm
                                                  placeholder="שם כיתה"
                                                  onSave={(name) =>
                                                    addSquad(company.id, platoon.id, name)
                                                  }
                                                  onCancel={() => setAddingSquadId(null)}
                                                />
                                              )}
                                            </div>
                                          )}

                                          {/* Add squad form when platoon is collapsed */}
                                          {!platoonExpanded && addingSquadId === platoon.id && (
                                            <div className="ps-8 pb-1 border-t border-dashed">
                                              <InlineForm
                                                placeholder="שם כיתה"
                                                onSave={(name) =>
                                                  addSquad(company.id, platoon.id, name)
                                                }
                                                onCancel={() => setAddingSquadId(null)}
                                              />
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </SortablePlatoonRow>
                                  );
                                })}
                              </SortableContext>
                            </DndContext>

                            {/* Add platoon form */}
                            {addingPlatoonId === company.id && (
                              <div className="p-2">
                                <InlineForm
                                  placeholder="שם מחלקה"
                                  onSave={(name) => addPlatoon(company.id, name)}
                                  onCancel={() => setAddingPlatoonId(null)}
                                />
                              </div>
                            )}

                            {company.platoons.length === 0 && addingPlatoonId !== company.id && (
                              <p className="text-xs text-muted-foreground px-4 py-2">אין מחלקות</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </SortableCompanyRow>
                );
              })}
            </SortableContext>
          </DndContext>

          {/* Add company form */}
          {addingCompany && (
            <div className="border rounded-lg p-3">
              <InlineForm
                placeholder="שם פלוגה"
                onSave={addCompany}
                onCancel={() => setAddingCompany(false)}
              />
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingCompany(true)}
            disabled={addingCompany}
            className="mt-2"
          >
            <PlusCircle className="w-4 h-4 ms-2" />
            הוסף פלוגה
          </Button>
        </div>
      )}
    </div>
  );
}
