"use client";

import { useState } from "react";
import { UserPlus, Pencil } from "lucide-react";
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
import { EditUserForm } from "@/components/admin/EditUserForm";
import { InviteUserForm } from "@/components/admin/InviteUserForm";
import { PendingInvitationsTable } from "@/components/users/PendingInvitationsTable";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { toIsraeliDisplay } from "@/lib/phone";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import type { Role } from "@/types";
import type { ManagedUser, ManagedInvitation, UnitStructure } from "@/types/users";

type Props = {
  initialUsers: ManagedUser[];
  initialInvitations: ManagedInvitation[];
  cycleId: string;
  structureByCycle: Record<string, UnitStructure["company"][]>;
  invitableRoles: Role[];
  currentUserId: string;
  isAdmin: boolean;
};

export function CommanderUsersPanel({
  initialUsers,
  initialInvitations,
  cycleId,
  structureByCycle,
  invitableRoles,
  currentUserId,
  isAdmin,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterUnitId, setFilterUnitId] = useState<string | null>(null);

  async function reload() {
    const res = await fetch(`/api/users/hierarchy?cycleId=${cycleId}`);
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      setInvitations(data.invitations);
    }
  }

  const inviteCycles = [{ id: cycleId, name: "" }];
  const inviteStructure = { [cycleId]: structureByCycle[cycleId] ?? [] };

  // Compute available filter options from current users
  const roleSet = new Set(users.flatMap((u) => u.cycleAssignments.filter((a) => a.cycleId === cycleId).map((a) => a.role)));
  const unitSet = new Map<string, string>();
  for (const u of users) {
    for (const a of u.cycleAssignments.filter((a) => a.cycleId === cycleId)) {
      if (a.unitName && !unitSet.has(a.unitId)) unitSet.set(a.unitId, a.unitName);
    }
  }
  const showFilters = users.length > 3 && (roleSet.size > 1 || unitSet.size > 1);

  // Apply filters
  const filteredUsers = users.filter((u) => {
    const assignments = u.cycleAssignments.filter((a) => a.cycleId === cycleId);
    if (assignments.length === 0) return false;
    if (filterRole && !assignments.some((a) => a.role === filterRole)) return false;
    if (filterUnitId && !assignments.some((a) => a.unitId === filterUnitId)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
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
          {unitSet.size > 1 && (
            <div className="flex gap-2 flex-wrap">
              {Array.from(unitSet.entries()).map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => setFilterUnitId(filterUnitId === id ? null : id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filterUnitId === id
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

      <div className="space-y-8">
        {/* Users */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{hebrewCount(filteredUsers.length, "מפקד", "מפקדים")}</p>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger
                render={
                  <Button size="sm">
                    <UserPlus className="w-4 h-4 ms-2" />
                    הזמן מפקד
                  </Button>
                }
              />
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>הזמן מפקד</DialogTitle>
                </DialogHeader>
                <InviteUserForm
                  cycles={inviteCycles}
                  structureByCycle={inviteStructure}
                  allowedRoles={invitableRoles}
                  onSuccess={() => {
                    setInviteOpen(false);
                    toast.success("ההזמנה נוצרה בהצלחה");
                    reload();
                  }}
                  onCancel={() => setInviteOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-start px-3 py-2.5 font-medium">שם</th>
                  <th className="text-start px-3 py-2.5 font-medium hidden sm:table-cell">אימייל / טלפון</th>
                  <th className="text-start px-3 py-2.5 font-medium">שיבוץ</th>
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
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell" dir="ltr">
                      {user.email && <div className="text-muted-foreground">{user.email}</div>}
                      {user.phone && <div className="text-muted-foreground">{toIsraeliDisplay(user.phone)}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="space-y-1">
                        {user.cycleAssignments
                          .filter((a) => a.cycleId === cycleId)
                          .map((a) => (
                            <div key={a.id} className="text-xs">
                              <span className="font-medium">{ROLE_LABELS[a.role as Role]}</span>
                              <span className="text-muted-foreground"> — {a.unitName}</span>
                              {!a.cycle.isActive && (
                                <Badge variant="outline" className="text-xs py-0 ms-1">לא פעיל</Badge>
                              )}
                            </div>
                          ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditingUserId(user.id)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">אין מפקדים בהיררכיה שלך</p>
            )}
          </div>

          {/* Edit user dialog */}
          {(() => {
            const editingUser = users.find((u) => u.id === editingUserId);
            return (
              <Dialog open={editingUserId !== null} onOpenChange={(open) => { if (!open) setEditingUserId(null); }}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>עריכת משתמש</DialogTitle>
                  </DialogHeader>
                  {editingUser && (
                    <EditUserForm
                      user={{ ...editingUser, phone: editingUser.phone ?? null, email: editingUser.email ?? null }}
                      showAdminToggle={false}
                      endpoint={`/api/users/${editingUserId}/profile`}
                      onSuccess={() => { setEditingUserId(null); toast.success("המשתמש עודכן"); reload(); }}
                      onCancel={() => setEditingUserId(null)}
                    />
                  )}
                </DialogContent>
              </Dialog>
            );
          })()}
        </div>

        <PendingInvitationsTable
          invitations={invitations}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onCancelled={reload}
        />
      </div>
    </div>
  );
}
