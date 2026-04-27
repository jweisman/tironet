"use client";

import { useState } from "react";
import { RefreshCw, Send, MessageSquare, Trash2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { toIsraeliDisplay } from "@/lib/phone";
import type { ManagedInvitation } from "@/types/users";

type Props = {
  invitations: ManagedInvitation[];
  /** Show the cycle name column (useful for admin which shows all cycles). */
  showCycleColumn?: boolean;
  /** If provided, only show cancel for invitations created by this user (or admins). */
  currentUserId?: string;
  isAdmin?: boolean;
  onCancelled: () => void;
};

export function PendingInvitationsTable({
  invitations,
  showCycleColumn = false,
  currentUserId,
  isAdmin = false,
  onCancelled,
}: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [sentEmailId, setSentEmailId] = useState<string | null>(null);
  const [sendingSmsId, setSendingSmsId] = useState<string | null>(null);
  const [sentSmsId, setSentSmsId] = useState<string | null>(null);

  async function copyInviteLink(inv: ManagedInvitation) {
    await navigator.clipboard.writeText(inv.inviteUrl);
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 2500);
  }

  async function sendEmail(inv: ManagedInvitation) {
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

  async function sendSms(inv: ManagedInvitation) {
    if (!inv.phone) return;
    setSendingSmsId(inv.id);
    try {
      await fetch("/api/invitations/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: inv.id }),
      });
      setSentSmsId(inv.id);
      setTimeout(() => setSentSmsId(null), 2500);
    } finally {
      setSendingSmsId(null);
    }
  }

  async function cancelInvitation(id: string) {
    await fetch(`/api/admin/invitations/${id}`, { method: "DELETE" });
    toast.success("ההזמנה בוטלה");
    onCancelled();
  }

  if (invitations.length === 0) return null;

  return (
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
              {showCycleColumn && (
                <th className="text-start px-3 py-2 font-medium hidden sm:table-cell">מחזור</th>
              )}
              <th className="px-3 py-2 w-28" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {invitations.map((inv) => {
              const canCancel = isAdmin || !currentUserId || inv.invitedByUserId === currentUserId;
              return (
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
                      <div className="text-muted-foreground">{toIsraeliDisplay(inv.phone)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <span className="font-medium">{inv.roleLabel}</span>
                    <span className="text-muted-foreground"> — {inv.unitName}</span>
                  </td>
                  {showCycleColumn && (
                    <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">
                      {inv.cycleName}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      {/* Copy invite link */}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="העתק קישור הזמנה"
                        onClick={() => copyInviteLink(inv)}
                      >
                        {copiedId === inv.id ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>

                      {/* Send / resend email */}
                      {inv.email && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label="שלח הזמנה במייל"
                          disabled={sendingEmailId === inv.id}
                          onClick={() => sendEmail(inv)}
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

                      {/* Send / resend SMS */}
                      {inv.phone && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label="שלח הזמנה ב-SMS"
                          disabled={sendingSmsId === inv.id}
                          onClick={() => sendSms(inv)}
                        >
                          {sentSmsId === inv.id ? (
                            <Check className="w-3.5 h-3.5 text-green-600" />
                          ) : sendingSmsId === inv.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <MessageSquare className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      )}

                      {/* Cancel invitation */}
                      {canCancel && (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                aria-label="בטל הזמנה"
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
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
