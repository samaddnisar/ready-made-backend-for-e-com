"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { RolePermissions } from "@repo/core/rbac";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import { formatRoleName, RoleDialog } from "./role-dialog";

/** Wire shapes of core's AdminUserRow / RoleWithCount — dates arrive as ISO strings. */
export type AdminRow = {
  id: string;
  authUserId: string;
  email: string;
  name: string | null;
  roleId: string;
  roleName: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoleRow = {
  id: string;
  name: string;
  permissions: RolePermissions;
  isSystem: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

type UsersPayload = { admins: AdminRow[]; roles: RoleRow[] };

export function UsersClient({
  currentAdminId,
  canCreate,
  canManage,
  canDelete,
}: {
  currentAdminId: string;
  canCreate: boolean;
  canManage: boolean;
  canDelete: boolean;
}) {
  const [data, setData] = useState<UsersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [removingAdmin, setRemovingAdmin] = useState<AdminRow | null>(null);
  const [roleDialog, setRoleDialog] = useState<{ role: RoleRow | null } | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<UsersPayload>("/api/admin/users"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(row: AdminRow, roleId: string) {
    if (roleId === row.roleId) return;
    setSavingRoleFor(row.id);
    try {
      await apiFetch(`/api/admin/users/${row.id}`, { method: "PATCH", body: { roleId } });
      toast.success(`Role updated for ${row.email}`);
    } catch (err) {
      // Surfaces core's guards as-is (e.g. "At least one super admin is required").
      toast.error("Couldn't change role", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSavingRoleFor(null);
      void load();
    }
  }

  async function removeAdmin(row: AdminRow) {
    try {
      await apiFetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
      toast.success(`Removed admin access for ${row.email}`);
      void load();
    } catch (err) {
      toast.error("Couldn't remove admin", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setRemovingAdmin(null);
    }
  }

  async function deleteRole(role: RoleRow) {
    try {
      await apiFetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      toast.success(`Role "${formatRoleName(role.name)}" deleted`);
      void load();
    } catch (err) {
      // 409s ("Reassign this role's members first") surface as-is.
      toast.error("Couldn't delete role", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setDeletingRole(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="font-medium">Failed to load admins and roles</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const admins = data?.admins ?? [];
  const roles = data?.roles ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Admins</CardTitle>
          <CardDescription>
            Everyone with access to this dashboard. Permissions come from the assigned role.
          </CardDescription>
          {canCreate ? (
            <CardAction>
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" aria-hidden />
                Invite admin
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Admin</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last login</TableHead>
                  {canDelete ? <TableHead className="w-12" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((row) => {
                  const isSelf = row.id === currentAdminId;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="font-medium">
                          {row.name ?? "—"}
                          {isSelf ? (
                            <Badge variant="secondary" className="ml-2">
                              You
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-sm text-muted-foreground">{row.email}</p>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Select
                            value={row.roleId}
                            onValueChange={(roleId) => void changeRole(row, roleId)}
                            disabled={isSelf || savingRoleFor === row.id}
                          >
                            <SelectTrigger
                              className="w-44"
                              aria-label={`Role for ${row.email}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roles.map((role) => (
                                <SelectItem key={role.id} value={role.id}>
                                  {formatRoleName(role.name)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">{formatRoleName(row.roleName)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.lastLoginAt ? formatDate(row.lastLoginAt) : "Never"}
                      </TableCell>
                      {canDelete ? (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove admin ${row.email}`}
                            disabled={isSelf}
                            onClick={() => setRemovingAdmin(row)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>
            Each role maps resources to allowed actions. Built-in roles can&apos;t be changed.
          </CardDescription>
          {canCreate ? (
            <CardAction>
              <Button variant="outline" onClick={() => setRoleDialog({ role: null })}>
                <Plus className="size-4" aria-hidden />
                New role
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-md border">
            {roles.map((role) => {
              const editable = canManage && !role.isSystem;
              return (
                <li key={role.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {formatRoleName(role.name)}
                      {role.isSystem ? <Badge variant="secondary">System</Badge> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {role.memberCount} member{role.memberCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      editable
                        ? `Edit role ${formatRoleName(role.name)}`
                        : `View role ${formatRoleName(role.name)}`
                    }
                    onClick={() => setRoleDialog({ role })}
                  >
                    {editable ? (
                      <Pencil className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </Button>
                  {canDelete && !role.isSystem ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete role ${formatRoleName(role.name)}`}
                      onClick={() => setDeletingRole(role)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {inviteOpen ? (
        <InviteDialog roles={roles} onClose={() => setInviteOpen(false)} onSaved={load} />
      ) : null}

      {roleDialog ? (
        <RoleDialog
          role={roleDialog.role}
          readOnly={!canManage || (roleDialog.role?.isSystem ?? false)}
          onClose={() => setRoleDialog(null)}
          onSaved={load}
        />
      ) : null}

      <ConfirmDialog
        open={removingAdmin !== null}
        onOpenChange={(open) => !open && setRemovingAdmin(null)}
        title={`Remove ${removingAdmin?.email ?? ""} as admin?`}
        description="They immediately lose access to this dashboard. Their login account is kept, so you can re-invite them later."
        confirmLabel="Remove"
        onConfirm={() => {
          if (removingAdmin) void removeAdmin(removingAdmin);
        }}
      />
      <ConfirmDialog
        open={deletingRole !== null}
        onOpenChange={(open) => !open && setDeletingRole(null)}
        title={`Delete role "${deletingRole ? formatRoleName(deletingRole.name) : ""}"?`}
        description="Roles with members can't be deleted — reassign those admins first."
        onConfirm={() => {
          if (deletingRole) void deleteRole(deletingRole);
        }}
      />
    </div>
  );
}

// ── Invite admin ─────────────────────────────────────────────

function InviteDialog({
  roles,
  onClose,
  onSaved,
}: {
  roles: RoleRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [saving, setSaving] = useState(false);

  async function invite() {
    const trimmedEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (!roleId) {
      toast.error("Pick a role for the new admin");
      return;
    }
    setSaving(true);
    try {
      const trimmedName = name.trim();
      await apiFetch<AdminRow>("/api/admin/users", {
        method: "POST",
        body: {
          email: trimmedEmail,
          roleId,
          ...(trimmedName ? { name: trimmedName } : {}),
        },
      });
      toast.success("Admin invited", {
        description: `Supabase emails ${trimmedEmail} an invite link to set their password.`,
      });
      onSaved();
      onClose();
    } catch (err) {
      toast.error("Invite failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite admin</DialogTitle>
          <DialogDescription>
            Sends a Supabase invite email. If they already have an account (e.g. as a
            customer), they're granted admin access directly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Name (optional)</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Doe"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="w-full" aria-label="Role for the new admin">
                <SelectValue placeholder="Pick a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {formatRoleName(role.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={invite} disabled={saving}>
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
