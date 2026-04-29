"use client";

import React, { useState } from "react";
import { UserPlus, Pencil, CalendarPlus, CalendarClock, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/alert-dialog";
import { EditUserForm } from "@/components/admin/EditUserForm";
import { InviteUserForm } from "@/components/admin/InviteUserForm";
import { PendingInvitationsTable } from "@/components/users/PendingInvitationsTable";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { toIsraeliDisplay } from "@/lib/phone";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import type { Role } from "@/types";
import type { ManagedUser, ManagedInvitation, UnitStructure, CommanderEventSummary } from "@/types/users";

type Props = {
  initialUsers: ManagedUser[];
  initialInvitations: ManagedInvitation[];
  cycleId: string;
  structureByCycle: Record<string, UnitStructure["company"][]>;
  invitableRoles: Role[];
  currentUserId: string;
  isAdmin: boolean;
  expandUserId?: string | null;
};

export function CommanderUsersPanel({
  initialUsers,
  initialInvitations,
  cycleId,
  structureByCycle,
  invitableRoles,
  currentUserId,
  isAdmin,
  expandUserId,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterUnitId, setFilterUnitId] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(expandUserId ?? null);
  const [eventDialogUserId, setEventDialogUserId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CommanderEventSummary | null>(null);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  async function reload() {
    const res = await fetch(`/api/users/hierarchy?cycleId=${cycleId}`);
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      setInvitations(data.invitations);
    }
  }

  async function handleSaveEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = (form.get("name") as string).trim();
    const description = (form.get("description") as string).trim() || undefined;
    const startDate = form.get("startDate") as string;
    const endDate = (form.get("endDate") as string) || startDate;

    if (!name) { setEventError("יש להזין שם אירוע"); return; }
    if (!startDate) { setEventError("יש לבחור תאריך"); return; }
    if (endDate < startDate) { setEventError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה"); return; }

    setEventSaving(true);
    setEventError(null);
    try {
      if (editingEvent) {
        const res = await fetch(`/api/commander-events/${editingEvent.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: description ?? null, startDate, endDate }),
        });
        if (!res.ok) throw new Error("Failed to update");
        toast.success("האירוע עודכן");
      } else {
        const res = await fetch("/api/commander-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycleId, userId: eventDialogUserId, name, description, startDate, endDate }),
        });
        if (!res.ok) throw new Error("Failed to create");
        toast.success("האירוע נוצר");
      }
      setEventDialogUserId(null);
      setEditingEvent(null);
      reload();
    } catch {
      toast.error("שגיאה בשמירת האירוע");
    } finally {
      setEventSaving(false);
    }
  }

  async function handleDeleteEvent() {
    if (!deletingEventId) return;
    try {
      const res = await fetch(`/api/commander-events/${deletingEventId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("האירוע נמחק");
      reload();
    } catch {
      toast.error("שגיאה במחיקת האירוע");
    } finally {
      setDeletingEventId(null);
    }
  }

  const inviteCycles = [{ id: cycleId, name: "" }];
  const inviteStructure = { [cycleId]: structureByCycle[cycleId] ?? [] };

  // Compute available filter options
  const roleSet = new Set(users.flatMap((u) => u.cycleAssignments.filter((a) => a.cycleId === cycleId).map((a) => a.role)));

  // Platoon-level unit filters (not squad-level — too granular for a users page)
  const platoonMap = new Map<string, string>();
  const companies = structureByCycle[cycleId] ?? [];
  for (const co of companies) {
    for (const pl of co.platoons) {
      platoonMap.set(pl.id, companies.length > 1 ? `${co.name} / ${pl.name}` : pl.name);
    }
  }
  // Build a lookup: squadId → platoonId for filtering users assigned at squad level
  const squadToPlatoon = new Map<string, string>();
  for (const co of companies) {
    for (const pl of co.platoons) {
      for (const sq of pl.squads) {
        squadToPlatoon.set(sq.id, pl.id);
      }
    }
  }

  const showRoleFilter = roleSet.size > 1;
  const showUnitFilter = platoonMap.size > 1;
  const showFilters = users.length > 3 && (showRoleFilter || showUnitFilter);

  // Resolve the platoon a user assignment belongs to
  function assignmentPlatoonId(a: { unitType: string; unitId: string }): string | null {
    if (a.unitType === "platoon") return a.unitId;
    if (a.unitType === "squad") return squadToPlatoon.get(a.unitId) ?? null;
    return null; // company-level roles don't belong to a specific platoon
  }

  // Apply filters
  const filteredUsers = users.filter((u) => {
    const assignments = u.cycleAssignments.filter((a) => a.cycleId === cycleId);
    if (assignments.length === 0) return false;
    if (filterRole && !assignments.some((a) => a.role === filterRole)) return false;
    if (filterUnitId && !assignments.some((a) => assignmentPlatoonId(a) === filterUnitId)) return false;
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
          {showUnitFilter && (
            <div className="flex gap-2 flex-wrap">
              {Array.from(platoonMap.entries()).map(([id, name]) => (
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
                  <Button size="sm" data-tour="users-invite">
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

          <div className="border rounded-lg overflow-hidden" data-tour="users-table">
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
                {filteredUsers.map((user, userIndex) => {
                  const events = user.commanderEvents ?? [];
                  const isExpanded = expandedUserId === user.id;
                  const isFirst = userIndex === 0;
                  return (
                    <React.Fragment key={user.id}>
                      <tr className="hover:bg-muted/20">
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
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => { setEventDialogUserId(user.id); setEditingEvent(null); }}
                              title="הוסף אירוע"
                              {...(isFirst ? { "data-tour": "users-add-event" } : {})}
                            >
                              <CalendarPlus className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => setEditingUserId(user.id)}
                              {...(isFirst ? { "data-tour": "users-edit" } : {})}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {events.length > 0 && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                                {...(isFirst ? { "data-tour": "users-events" } : {})}

                              >
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </Button>
                            )}
                            {events.length > 0 && !isExpanded && (
                              <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                                {events.length}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && events.length > 0 && (
                        <tr className="!border-t-0">
                          <td colSpan={4} className="p-3">
                            <div className="me-8 ms-6 rounded-lg bg-muted/40 border border-border/50 px-3 py-2 space-y-2">
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                                <CalendarClock className="w-3 h-3" />
                                אירועים
                              </div>
                              {events.map((ev) => (
                                <div key={ev.id} className="flex items-center gap-2 text-xs">
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium">{ev.name}</span>
                                    <span className="text-muted-foreground">
                                      {" · "}
                                      {new Date(ev.startDate + "T12:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short" })}
                                      {ev.startDate !== ev.endDate && (
                                        <> — {new Date(ev.endDate + "T12:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short" })}</>
                                      )}
                                    </span>
                                    {ev.description && (
                                      <div className="text-muted-foreground">{ev.description}</div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground p-2 -m-1"
                                    onClick={() => { setEventDialogUserId(user.id); setEditingEvent(ev); }}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-destructive p-2 -m-1"
                                    onClick={() => setDeletingEventId(ev.id)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
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

        {/* Event create/edit dialog */}
        <Dialog
          open={eventDialogUserId !== null}
          onOpenChange={(open) => { if (!open) { setEventDialogUserId(null); setEditingEvent(null); setEventError(null); } }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editingEvent ? "עריכת אירוע" : "אירוע חדש"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="event-name" required>שם האירוע</Label>
                <input
                  id="event-name"
                  name="name"
                  type="text"
                  defaultValue={editingEvent?.name ?? ""}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="חופשה, ביקור רופא..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-description">תיאור</Label>
                <textarea
                  id="event-description"
                  name="description"
                  rows={3}
                  defaultValue={editingEvent?.description ?? ""}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="event-start" required>מתאריך</Label>
                  <input
                    id="event-start"
                    name="startDate"
                    type="date"
                    defaultValue={editingEvent?.startDate ?? ""}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-end">עד תאריך</Label>
                  <input
                    id="event-end"
                    name="endDate"
                    type="date"
                    defaultValue={editingEvent?.endDate ?? ""}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {eventError && <p className="text-sm text-destructive">{eventError}</p>}

              <div className="flex flex-row-reverse gap-2 justify-end pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setEventDialogUserId(null); setEditingEvent(null); }}>
                  ביטול
                </Button>
                <Button type="submit" size="sm" disabled={eventSaving}>
                  {eventSaving ? "שומר..." : editingEvent ? "עדכן" : "צור"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete event confirmation */}
        <AlertDialog open={deletingEventId !== null} onOpenChange={(open) => { if (!open) setDeletingEventId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>מחיקת אירוע</AlertDialogTitle>
              <AlertDialogDescription>
                האם למחוק את האירוע?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteEvent}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                מחק
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div data-tour="users-invitations">
          <PendingInvitationsTable
            invitations={invitations}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onCancelled={reload}
          />
        </div>
      </div>
    </div>
  );
}
