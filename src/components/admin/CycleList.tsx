"use client";

import { useState } from "react";
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

type Cycle = {
  id: string;
  name: string;
  isActive: boolean;
};

type Props = {
  initialCycles: Cycle[];
};

export default function CycleList({ initialCycles }: Props) {
  const [cycles, setCycles] = useState<Cycle[]>(initialCycles);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAdd() {
    if (!newName.trim()) return;
    setLoading(true);
    const res = await fetch("/api/admin/cycles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const cycle = await res.json();
      setCycles((prev) => [cycle, ...prev]);
      setNewName("");
      setAdding(false);
    }
    setLoading(false);
  }

  async function handleToggleActive(cycle: Cycle) {
    const res = await fetch(`/api/admin/cycles/${cycle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !cycle.isActive }),
    });
    if (res.ok) {
      const updated = await res.json();
      setCycles((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    }
  }

  async function handleEdit(id: string) {
    if (!editName.trim()) return;
    setLoading(true);
    const res = await fetch(`/api/admin/cycles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setCycles((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingId(null);
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/cycles/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCycles((prev) => prev.filter((c) => c.id !== id));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">מחזורים</h2>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <PlusCircle className="w-4 h-4 ms-2" />
          הוסף מחזור
        </Button>
      </div>

      {adding && (
        <div className="flex gap-2 items-center p-3 border rounded-lg bg-muted/30">
          <Input
            autoFocus
            placeholder="שם מחזור"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") setAdding(false);
            }}
            className="max-w-xs"
          />
          <Button size="sm" onClick={handleAdd} disabled={loading || !newName.trim()}>
            <Check className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {cycles.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8">אין מחזורים עדיין</p>
        )}
        {cycles.map((cycle) => (
          <div
            key={cycle.id}
            className="flex items-center gap-3 p-3 border rounded-lg"
          >
            {editingId === cycle.id ? (
              <>
                <Input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEdit(cycle.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="max-w-xs"
                />
                <Button size="sm" onClick={() => handleEdit(cycle.id)} disabled={loading}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 font-medium">{cycle.name}</span>
                <Badge variant={cycle.isActive ? "default" : "secondary"}>
                  {cycle.isActive ? "פעיל" : "לא פעיל"}
                </Badge>
                <Switch
                  checked={cycle.isActive}
                  onCheckedChange={() => handleToggleActive(cycle)}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => { setEditingId(cycle.id); setEditName(cycle.name); }}
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
                      <AlertDialogTitle>מחיקת מחזור</AlertDialogTitle>
                      <AlertDialogDescription>
                        האם אתה בטוח שברצונך למחוק את המחזור &quot;{cycle.name}&quot;?
                        פעולה זו תמחק את כל הפלוגות, המחלקות והכיתות הקשורות אליו.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ביטול</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(cycle.id)}
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
