"use client";

import { useState } from "react";
import { UserPlus, Trash2, Plus, RefreshCw, Send, Pencil, Copy, Check } from "lucide-react";
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
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { toIsraeliDisplay } from "@/lib/phone";
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
  phone: string | null;
  rank: string | null;
  isAdmin: boolean;
  cycleAssignments: Assignment[];
};

type Invitation = {
  id: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  roleLabel: string;
  unitName: string;
  cycleName: string;
  expiresAt: string;
  token: string;
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
  // Per-invitation action states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [sentEmailId, setSentEmailId] = useState<string | null>(null);

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
    await reloadUsers();
  }

  async function deleteUser(id: string) {
    setDeleteError(null);
    const res = await fetch(`/api/admin/users/${id}/profile`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error ?? "אירעה שגיאה במחיקת המשתמש.");
      return;
    }
    await reloadUsers();
  }

  async function cancelInvitation(id: string) {
    await fetch(`/api/admin/invitations/${id}`, { method: "DELETE" });
    await reloadInvitations();
  }

  async function copyInviteLink(inv: Invitation) {
    const inviteUrl = `${window.location.origin}/invite/${inv.token}`;
    await navigator.clipboard.writeText(inviteUrl);
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 2500);
  }

  async function resendEmail(inv: Invitation) {
    if (!inv.email) return;
    setSendingEmailId(inv.id);
    try {
      await fetch("/api/invitations/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: inv.id }),
      });
      setSentEmailId(inv.id);
      setTimeout(() => setSentEmailId(null), 2500);
    } finally {
      setSendingEmailId(null);
    }
  }

  const assigningUser = users.find((u) => u.id === assigningUserId) ?? null;
  const editingUser = users.find((u) => u.id === editingUserId) ?? null;

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
          <p className="text-sm text-muted-foreground">{users.length} משתמשים</p>
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
                  reloadInvitations();
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
                <th className="text-start px-3 py-2.5 font-medium">שיבוצים</th>
                <th className="px-3 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => (
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
                  <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell" dir="ltr">
                    {user.email}
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
                        title="ערוך משתמש"
                        onClick={() => setEditingUserId(user.id)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="הוסף שיבוץ"
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
                                title="מחק משתמש"
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
          {users.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">אין משתמשים</p>
          )}
        </div>
      </div>

      {/* ── Pending Invitations ── */}
      {invitations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            הזמנות ממתינות ({invitations.length})
          </h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-start px-3 py-2 font-medium">שם</th>
                  <th className="text-start px-3 py-2 font-medium">אימייל / טלפון</th>
                  <th className="text-start px-3 py-2 font-medium hidden sm:table-cell">תפקיד / יחידה</th>
                  <th className="text-start px-3 py-2 font-medium hidden sm:table-cell">מחזור</th>
                  <th className="px-3 py-2 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {invitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2">
                      {inv.givenName || inv.familyName
                        ? <div className="font-medium">{[inv.givenName, inv.familyName].filter(Boolean).join(" ")}</div>
                        : <div className="text-muted-foreground text-xs">—</div>
                      }
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {inv.email && <div>{inv.email}</div>}
                      {inv.phone && (
                        <div className="text-muted-foreground">
                          {toIsraeliDisplay(inv.phone)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <span className="font-medium">{inv.roleLabel}</span>
                      <span className="text-muted-foreground"> — {inv.unitName}</span>
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">
                      {inv.cycleName}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        {/* Copy invite link */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="העתק קישור הזמנה"
                          onClick={() => copyInviteLink(inv)}
                        >
                          {copiedId === inv.id ? (
                            <Check className="w-3.5 h-3.5 text-green-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </Button>

                        {/* Send / resend email — only shown when invitation has email */}
                        {inv.email && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="שלח הזמנה במייל"
                            disabled={sendingEmailId === inv.id}
                            onClick={() => resendEmail(inv)}
                          >
                            {sentEmailId === inv.id ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : sendingEmailId === inv.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        )}

                        {/* Cancel invitation */}
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
                                האם אתה בטוח שברצונך לבטל את ההזמנה
                                {inv.email ? ` ל-${inv.email}` : inv.phone ? ` ל-${toIsraeliDisplay(inv.phone)}` : ""}?
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
