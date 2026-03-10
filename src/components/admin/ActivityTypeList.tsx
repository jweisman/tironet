"use client";

import { useState } from "react";
import * as LucideIcons from "lucide-react";
import { PlusCircle, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

type ActivityType = {
  id: string;
  name: string;
  icon: string;
  isActive: boolean;
  sortOrder: number;
};

type Props = {
  initialTypes: ActivityType[];
};

function LucideIcon({ name, className }: { name: string; className?: string }) {
  const icons = LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  // Convert kebab-case or PascalCase icon names to PascalCase
  const pascalName = name
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const Icon = icons[pascalName];
  if (!Icon) return <span className={className}>?</span>;
  return <Icon className={className} />;
}

export default function ActivityTypeList({ initialTypes }: Props) {
  const [types, setTypes] = useState<ActivityType[]>(initialTypes);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("Activity");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [loading, setLoading] = useState(false);

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
      body: JSON.stringify({ name: editName.trim(), icon: editIcon.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingId(null);
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/activity-types/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTypes((prev) => prev.filter((t) => t.id !== id));
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
          <Button size="sm" onClick={handleAdd} disabled={loading || !newName.trim() || !newIcon.trim()}>
            <Check className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); setNewIcon("Activity"); }}>
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
            className="flex items-center gap-3 p-3 border rounded-lg"
          >
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
                <Button size="sm" onClick={() => handleEdit(type.id)} disabled={loading}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 font-medium">{type.name}</span>
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
                  onClick={() => {
                    setEditingId(type.id);
                    setEditName(type.name);
                    setEditIcon(type.icon);
                  }}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" />}
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
        ))}
      </div>
    </div>
  );
}
