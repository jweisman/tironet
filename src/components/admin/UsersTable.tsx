"use client";

import { useState } from "react";
import { UserPlus, Trash2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { InviteUserForm } from "./InviteUserForm";
import { AssignUserForm } from "./AssignUserForm";
import { EditUserForm } from "./EditUserForm";
import { PendingInvitationsTable } from "@/components/users/PendingInvitationsTable";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { toIsraeliDisplay } from "@/lib/phone";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import type { Role } from "@/types";
import type { ManagedUser, ManagedInvitation, UnitStructure } from "@/types/users";

type Cycle = { id: string; name: string };

type Props = {
  initialUsers: ManagedUser[];
  initialInvitations: ManagedInvitation[];
  cycles: Cycle[];
  structureByCycle: Record<string, UnitStructure["company"][]>;
  currentUserId: string;
};

export function UsersTable({
  initialUsers,
  initialInvitations,
  cycles,
  structureByCycle,
  currentUserId,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterUnitName, setFilterUnitName] = useState<string | null>(null);

  async function reloadUsers() {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
  }

  async function reloadInvitations() {
    const res = await fetch("/api/admin/invitations");
    if (res.ok) setInvitations(await res.json());
  }

  async function deleteAssignment(userId: string, assignmentId: string) {
    await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    toast.success("השיבוץ הוסר");
    await reloadUsers();
  }

  async function deleteUser(id: string) {
    setDeleteError(null);
    const res = await fetch(`/api/admin/users/${id}/profile`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "אירעה שגיאה במחיקת המשתמש.");
      return;
    }
    toast.success("המשתמש נמחק");
    await reloadUsers();
  }

  const assigningUser = users.find((u) => u.id === assigningUserId) ?? null;
  const editingUser = users.find((u) => u.id === editingUserId) ?? null;

  // Compute available filter options
  const roleSet = new Set(users.flatMap((u) => u.cycleAssignments.map((a) => a.role)));
  const unitNameSet = new Set(users.flatMap((u) => u.cycleAssignments.map((a) => a.unitName)).filter(Boolean));
  const showFilters = users.length > 5 && (roleSet.size > 1 || unitNameSet.size > 1);

  const filteredUsers = users.filter((u) => {
    if (!filterRole && !filterUnitName) return true;
    if (filterRole && !u.cycleAssignments.some((a) => a.role === filterRole)) return false;
    if (filterUnitName && !u.cycleAssignments.some((a) => a.unitName === filterUnitName)) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      {deleteError && (
        <p className="text-sm text-destructive border border-destructive/30 rounded-lg px-3 py-2">
          {deleteError}
        </p>
      )}

      {/* ── Users ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{hebrewCount(filteredUsers.length, "משתמש", "משתמשים")}</p>
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <UserPlus className="w-4 h-4 ms-2" />
                  הזמן משתמש
                </Button>
              }
            />
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>הזמן משתמש</DialogTitle>
              </DialogHeader>
              <InviteUserForm
                cycles={cycles}
                structureByCycle={structureByCycle}
                onSuccess={() => {
                  setInviteOpen(false);
                  toast.success("ההזמנה נוצרה בהצלחה");
                  reloadInvitations();
                }}
                onCancel={() => setInviteOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>

        {showFilters && (
          <div className="space-y-2">
            {roleSet.size > 1 && (
              <div className="flex gap-2 flex-wrap">
                {Array.from(roleSet).map((r) => (
                  <button
                    key={r}
                    onClick={() => setFilterRole(filterRole === r ? null : r)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      filterRole === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    }`}
                  >
                    {ROLE_LABELS[r as Role]}
                  </button>
                ))}
              </div>
            )}
            {unitNameSet.size > 1 && (
              <div className="flex gap-2 flex-wrap">
                {Array.from(unitNameSet).map((name) => (
                  <button
                    key={name}
                    onClick={() => setFilterUnitName(filterUnitName === name ? null : name)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      filterUnitName === name
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-start px-3 py-2.5 font-medium">שם</th>
                <th className="text-start px-3 py-2.5 font-medium hidden sm:table-cell">אימייל / טלפון</th>
                <th className="text-start px-3 py-2.5 font-medium">שיבוצים</th>
                <th className="px-3 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">
                      {user.givenName} {user.familyName}
                    </div>
                    {user.rank && (
                      <div className="text-xs text-muted-foreground">{user.rank}</div>
                    )}
                    {user.isAdmin && (
                      <Badge variant="secondary" className="text-xs mt-0.5">מנהל</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden sm:table-cell" dir="ltr">
                    {user.email && <div className="text-muted-foreground">{user.email}</div>}
                    {user.phone && <div className="text-muted-foreground">{toIsraeliDisplay(user.phone)}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="space-y-1">
                      {user.cycleAssignments.length === 0 ? (
                        <span className="text-xs text-muted-foreground">אין שיבוץ</span>
                      ) : (
                        user.cycleAssignments.map((a) => (
                          <div key={a.id} className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs">
                              <span className="font-medium">{ROLE_LABELS[a.role as Role]}</span>
                              <span className="text-muted-foreground"> — {a.unitName}</span>
                              <span className="text-muted-foreground/60"> ({a.cycle.name})</span>
                            </span>
                            {!a.cycle.isActive && (
                              <Badge variant="outline" className="text-xs py-0">לא פעיל</Badge>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger
                                render={<button className="text-muted-foreground hover:text-destructive" />}
                              >
                                <Trash2 className="w-3 h-3" />
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>הסרת שיבוץ</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    האם אתה בטוח שברצונך להסיר את השיבוץ של {user.givenName} {user.familyName}?
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteAssignment(user.id, a.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    הסר
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="ערוך משתמש"
                        onClick={() => setEditingUserId(user.id)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="הוסף שיבוץ"
                        onClick={() => setAssigningUserId(user.id)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                      {user.id !== currentUserId && (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                aria-label="מחק משתמש"
                              />
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>מחיקת משתמש</AlertDialogTitle>
                              <AlertDialogDescription>
                                האם אתה בטוח שברצונך למחוק את {user.givenName} {user.familyName}? פעולה זו בלתי הפיכה.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>ביטול</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteUser(user.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                מחק
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredUsers.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">אין משתמשים</p>
          )}
        </div>
      </div>

      {/* ── Pending Invitations ── */}
      <PendingInvitationsTable
        invitations={invitations}
        showCycleColumn
        isAdmin
        onCancelled={reloadInvitations}
      />

      {/* ── Edit user dialog ── */}
      <Dialog
        open={editingUserId !== null}
        onOpenChange={(open) => { if (!open) setEditingUserId(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              ערוך {editingUser ? `${editingUser.givenName} ${editingUser.familyName}` : ""}
            </DialogTitle>
          </DialogHeader>
          {editingUser && (
            <EditUserForm
              user={{ ...editingUser, phone: editingUser.phone ?? null }}
              onSuccess={async () => {
                setEditingUserId(null);
                toast.success("המשתמש עודכן בהצלחה");
                await reloadUsers();
              }}
              onCancel={() => setEditingUserId(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Assign user dialog ── */}
      <Dialog
        open={assigningUserId !== null}
        onOpenChange={(open) => { if (!open) setAssigningUserId(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              שבץ {assigningUser ? `${assigningUser.givenName} ${assigningUser.familyName}` : ""}
            </DialogTitle>
          </DialogHeader>
          {assigningUser && (
            <AssignUserForm
              userId={assigningUser.id}
              cycles={cycles}
              structureByCycle={structureByCycle}
              onSuccess={async () => {
                setAssigningUserId(null);
                toast.success("השיבוץ נשמר בהצלחה");
                await reloadUsers();
              }}
              onCancel={() => setAssigningUserId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
