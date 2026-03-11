"use client";

import { useState } from "react";
import { UserPlus, RefreshCw, Send, Trash2 } from "lucide-react";
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
import { InviteUserForm } from "@/components/admin/InviteUserForm";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

type Assignment = {
  id: string;
  role: string;
  unitType: string;
  unitId: string;
  unitName: string;
  cycleId: string;
  cycle: { name: string; isActive: boolean };
};

type User = {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  rank: string | null;
  isAdmin: boolean;
  cycleAssignments: Assignment[];
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  roleLabel: string;
  unitName: string;
  cycleName: string;
  expiresAt: string;
};

type Squad = { id: string; name: string };
type Platoon = { id: string; name: string; squads: Squad[] };
type Company = { id: string; name: string; platoons: Platoon[] };
type Cycle = { id: string; name: string };

type Props = {
  initialUsers: User[];
  initialInvitations: Invitation[];
  cycles: Cycle[];
  structureByCycle: Record<string, Company[]>;
  invitableRoles: Role[];
};

export function CommanderUsersPanel({
  initialUsers,
  initialInvitations,
  cycles,
  structureByCycle,
  invitableRoles,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [selectedCycleId, setSelectedCycleId] = useState(cycles[0]?.id ?? "");

  async function reload() {
    const res = await fetch("/api/users/hierarchy");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      setInvitations(data.invitations);
    }
  }

  async function cancelInvitation(id: string) {
    await fetch(`/api/admin/invitations/${id}`, { method: "DELETE" });
    await reload();
  }

  async function resendInvitation(id: string) {
    setResending(id);
    await fetch(`/api/admin/invitations/${id}`, { method: "POST" });
    setResending(null);
  }

  if (cycles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        אינך מוגדר כמפקד מחלקה או פלוגה באף מחזור פעיל.
      </p>
    );
  }

  const selectedCycleName = cycles.find((c) => c.id === selectedCycleId)?.name ?? "";

  const visibleUsers = users.filter((u) =>
    u.cycleAssignments.some((a) => a.cycleId === selectedCycleId)
  );
  const visibleInvitations = invitations.filter((inv) => inv.cycleName === selectedCycleName);

  // Only show the structure for the selected cycle in the invite form
  const inviteCycles = cycles.filter((c) => c.id === selectedCycleId);
  const inviteStructure = { [selectedCycleId]: structureByCycle[selectedCycleId] ?? [] };

  return (
    <div className="space-y-6">
      {/* Cycle tabs */}
      {cycles.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {cycles.map((c) => (
            <button
              key={c.id}
              onClick={() => { setSelectedCycleId(c.id); setInviteOpen(false); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                c.id === selectedCycleId
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-8">
        {/* Users */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{visibleUsers.length} מפקדים</p>
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
                  <th className="text-start px-3 py-2.5 font-medium hidden sm:table-cell">אימייל</th>
                  <th className="text-start px-3 py-2.5 font-medium">שיבוץ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      <div className="font-medium">
                        {user.givenName} {user.familyName}
                      </div>
                      {user.rank && (
                        <div className="text-xs text-muted-foreground">{user.rank}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell" dir="ltr">
                      {user.email}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="space-y-1">
                        {user.cycleAssignments
                          .filter((a) => a.cycleId === selectedCycleId)
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
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleUsers.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">אין מפקדים בהיררכיה שלך</p>
            )}
          </div>
        </div>

        {/* Pending invitations */}
        {visibleInvitations.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              הזמנות ממתינות ({visibleInvitations.length})
            </h3>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium">אימייל</th>
                    <th className="text-start px-3 py-2 font-medium hidden sm:table-cell">תפקיד / יחידה</th>
                    <th className="px-3 py-2 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleInvitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2" dir="ltr">{inv.email}</td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <span className="font-medium">{inv.roleLabel}</span>
                        <span className="text-muted-foreground"> — {inv.unitName}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="שלח שוב"
                            disabled={resending === inv.id}
                            onClick={() => resendInvitation(inv.id)}
                          >
                            {resending === inv.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                />
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>ביטול הזמנה</AlertDialogTitle>
                                <AlertDialogDescription>
                                  האם אתה בטוח שברצונך לבטל את ההזמנה ל-{inv.email}?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>ביטול</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => cancelInvitation(inv.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  בטל הזמנה
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
