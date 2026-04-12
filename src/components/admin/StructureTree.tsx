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
  ChevronsDownUp,
  ChevronsUpDown,
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
type Company = { id: string; name: string; battalionId: string | null; platoons: Platoon[] };
type Battalion = { id: string; name: string; sortOrder: number };
type Cycle = { id: string; name: string; isActive: boolean };

type Props = {
  cycles: Cycle[];
  battalions: Battalion[];
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

export default function StructureTree({ cycles, battalions: initialBattalions, initialStructure }: Props) {
  const [selectedCycleId, setSelectedCycleId] = useState(
    () => (cycles.find((c) => c.isActive) ?? cycles[0])?.id ?? ""
  );
  const [structure, setStructure] = useState<Record<string, Company[]>>(initialStructure);
  const [battalions, setBattalions] = useState<Battalion[]>(initialBattalions);
  const [expandedBattalions, setExpandedBattalions] = useState<Set<string>>(() => new Set(initialBattalions.map((b) => b.id)));
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [expandedPlatoons, setExpandedPlatoons] = useState<Set<string>>(new Set());

  const [addingBattalion, setAddingBattalion] = useState(false);
  const [editingBattalionId, setEditingBattalionId] = useState<string | null>(null);
  const [addingCompanyBattalionId, setAddingCompanyBattalionId] = useState<string | null>(null);
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
  async function addCompany(name: string, battalionId?: string) {
    const company = await mutate("/api/admin/structure", "POST", {
      type: "company",
      cycleId: selectedCycleId,
      name,
      ...(battalionId ? { battalionId } : {}),
    });
    updateStructure(selectedCycleId, (prev) => [...prev, { ...company, platoons: [] }]);
    setAddingCompany(false);
    setAddingCompanyBattalionId(null);
    setExpandedCompanies((prev) => new Set([...prev, company.id]));
  }

  // --- Battalion operations ---
  async function addBattalion(name: string) {
    const battalion = await mutate("/api/admin/structure", "POST", { type: "battalion", name });
    setBattalions((prev) => [...prev, battalion]);
    setExpandedBattalions((prev) => new Set([...prev, battalion.id]));
    setAddingBattalion(false);
  }

  async function renameBattalion(battalionId: string, name: string) {
    await mutate(`/api/admin/structure/${battalionId}`, "PATCH", { type: "battalion", name });
    setBattalions((prev) => prev.map((b) => (b.id === battalionId ? { ...b, name } : b)));
    setEditingBattalionId(null);
  }

  async function deleteBattalion(battalionId: string) {
    await mutate(`/api/admin/structure/${battalionId}`, "DELETE", { type: "battalion" });
    setBattalions((prev) => prev.filter((b) => b.id !== battalionId));
    // Unassign companies from this battalion
    updateStructure(selectedCycleId, (prev) =>
      prev.map((c) => (c.battalionId === battalionId ? { ...c, battalionId: null } : c))
    );
    toast.success("הגדוד נמחק");
  }

  function toggleBattalion(id: string) {
    setExpandedBattalions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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

  function toggleExpandAll(company: Company) {
    const platoonIds = company.platoons.map((p) => p.id);
    const companyExpanded = expandedCompanies.has(company.id);
    const allExpanded = companyExpanded && platoonIds.every((id) => expandedPlatoons.has(id));

    if (allExpanded) {
      setExpandedCompanies((prev) => {
        const next = new Set(prev);
        next.delete(company.id);
        return next;
      });
      setExpandedPlatoons((prev) => {
        const next = new Set(prev);
        platoonIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setExpandedCompanies((prev) => new Set([...prev, company.id]));
      setExpandedPlatoons((prev) => {
        const next = new Set(prev);
        platoonIds.forEach((id) => next.add(id));
        return next;
      });
    }
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
        <div className="space-y-4">
          {battalions.map((battalion) => {
            const battalionCompanies = companies.filter((c) => c.battalionId === battalion.id);
            const battalionExpanded = expandedBattalions.has(battalion.id);
            return (
              <div key={battalion.id} className="border-2 border-primary/20 rounded-xl overflow-hidden">
                {/* Battalion header */}
                <div className="flex items-center gap-2 p-3 bg-primary/5">
                  <button onClick={() => toggleBattalion(battalion.id)} className="text-muted-foreground hover:text-foreground">
                    {battalionExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <Shield className="w-4 h-4 text-primary shrink-0" />
                  {editingBattalionId === battalion.id ? (
                    <EditInline
                      initialName={battalion.name}
                      onSave={(name) => renameBattalion(battalion.id, name)}
                      onCancel={() => setEditingBattalionId(null)}
                    />
                  ) : (
                    <>
                      <span className="flex-1 font-semibold text-sm">{battalion.name}</span>
                      <span className="text-xs text-muted-foreground">{battalionCompanies.length} פלוגות</span>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setAddingCompanyBattalionId(battalion.id); setExpandedBattalions((prev) => new Set([...prev, battalion.id])); }}>
                        <PlusCircle className="w-3 h-3 ms-1" />
                        פלוגה
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingBattalionId(battalion.id)} aria-label="ערוך גדוד">
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="מחק גדוד" />}>
                          <Trash2 className="w-3 h-3" />
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>מחיקת גדוד</AlertDialogTitle>
                            <AlertDialogDescription>האם למחוק את &quot;{battalion.name}&quot;? הפלוגות שמתחתיו לא יימחקו.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>ביטול</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteBattalion(battalion.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">מחק</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>

                {/* Battalion content: companies */}
                {battalionExpanded && (
                  <div className="p-2 space-y-1">
                    {addingCompanyBattalionId === battalion.id && (
                      <div className="border rounded-lg p-3">
                        <InlineForm
                          placeholder="שם פלוגה"
                          onSave={(name) => addCompany(name, battalion.id)}
                          onCancel={() => setAddingCompanyBattalionId(null)}
                        />
                      </div>
                    )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleCompanyDragEnd}
          >
            <SortableContext items={battalionCompanies.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {battalionCompanies.map((company) => {
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
                              {company.platoons.length > 0 && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => toggleExpandAll(company)}
                                  aria-label={companyExpanded && company.platoons.every((p) => expandedPlatoons.has(p.id)) ? "כווץ הכל" : "הרחב הכל"}
                                >
                                  {companyExpanded && company.platoons.every((p) => expandedPlatoons.has(p.id)) ? (
                                    <ChevronsDownUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronsUpDown className="w-3.5 h-3.5" />
                                  )}
                                </Button>
                              )}
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

                  </div>
                )}
              </div>
            );
          })}

          {/* Unassigned companies (no battalion) */}
          {(() => {
            const unassigned = companies.filter((c) => !c.battalionId);
            if (unassigned.length === 0) return null;
            return (
              <div className="border border-dashed rounded-xl p-2 space-y-1">
                <p className="text-xs text-muted-foreground px-2 py-1">פלוגות ללא גדוד</p>
                {unassigned.map((company) => (
                  <div key={company.id} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 p-2.5 bg-muted/30">
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
                          {battalions.length > 0 && (
                            <Select
                              value=""
                              onValueChange={async (battalionId) => {
                                if (!battalionId) return;
                                await mutate(`/api/admin/structure/${company.id}`, "PATCH", { type: "company", name: company.name, battalionId });
                                updateStructure(selectedCycleId, (prev) =>
                                  prev.map((c) => (c.id === company.id ? { ...c, battalionId } : c))
                                );
                                toast.success("הפלוגה שויכה לגדוד");
                              }}
                            >
                              <SelectTrigger className="h-7 w-36 text-xs">
                                <SelectValue placeholder="שייך לגדוד" />
                              </SelectTrigger>
                              <SelectContent>
                                {battalions.map((b) => (
                                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingCompanyId(company.id)} aria-label="ערוך פלוגה">
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger render={<Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="מחק פלוגה" />}>
                              <Trash2 className="w-3 h-3" />
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>מחיקת פלוגה</AlertDialogTitle>
                                <AlertDialogDescription>האם למחוק את &quot;{company.name}&quot;?</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>ביטול</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteCompany(company.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">מחק</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Add battalion */}
          {addingBattalion && (
            <div className="border-2 border-dashed border-primary/30 rounded-xl p-3">
              <InlineForm
                placeholder="שם גדוד"
                onSave={addBattalion}
                onCancel={() => setAddingBattalion(false)}
              />
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingBattalion(true)}
            disabled={addingBattalion}
            className="mt-2"
          >
            <PlusCircle className="w-4 h-4 ms-2" />
            הוסף גדוד
          </Button>
        </div>
      )}
    </div>
  );
}
