"use client";

import { useState } from "react";
import { toast } from "sonner";
// Value imports from the client-safe rbac subpath — never the @repo/core root.
import { ACTIONS, RESOURCES } from "@repo/core/rbac";
import type { Action, Resource, RolePermissions } from "@repo/core/rbac";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client-api";
import type { RoleRow } from "./users-client";

/** "super_admin" → "Super admin". */
export function formatRoleName(name: string): string {
  const label = name.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Grants = Array<Action | "*">;
type Matrix = Record<Resource, Grants>;

/**
 * Expand stored permissions into a full per-resource matrix, mirroring
 * hasPermission's lookup: a resource-specific entry wins, otherwise the
 * "*" entry applies.
 */
function initMatrix(role: RoleRow | null): Matrix {
  const matrix = {} as Matrix;
  const wildcard = role?.permissions["*"];
  for (const resource of RESOURCES) {
    const grants = role?.permissions[resource] ?? wildcard ?? [];
    matrix[resource] = grants.includes("*") ? ["*"] : [...grants];
  }
  return matrix;
}

function initEverything(role: RoleRow | null): boolean {
  if (!role) return false;
  const wildcard = role.permissions["*"] ?? [];
  if (!wildcard.includes("*")) return false;
  // Only "everything" when no resource narrows the wildcard down.
  return RESOURCES.every((resource) => {
    const grants = role.permissions[resource];
    return grants === undefined || grants.includes("*");
  });
}

export function RoleDialog({
  role,
  readOnly,
  onClose,
  onSaved,
}: {
  role: RoleRow | null;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [everything, setEverything] = useState(() => initEverything(role));
  const [matrix, setMatrix] = useState<Matrix>(() => initMatrix(role));
  const [saving, setSaving] = useState(false);

  function toggleAction(resource: Resource, action: Action, checked: boolean) {
    setMatrix((prev) => {
      const current = prev[resource];
      if (current.includes("*")) return prev; // controlled by the row's "All" toggle
      const next = checked ? [...current, action] : current.filter((a) => a !== action);
      return { ...prev, [resource]: next };
    });
  }

  function toggleRowAll(resource: Resource, checked: boolean) {
    setMatrix((prev) => ({ ...prev, [resource]: checked ? ["*"] : [] }));
  }

  /**
   * Core's rolePermissionsSchema (zod record over enum keys) requires every
   * key to be present, so always send the full map — "*" included. Explicit
   * per-resource entries also keep hasPermission lookups exact.
   */
  function buildPermissions(): RolePermissions {
    const permissions: RolePermissions = {};
    if (everything) {
      permissions["*"] = ["*"];
      for (const resource of RESOURCES) permissions[resource] = ["*"];
      return permissions;
    }
    permissions["*"] = [];
    for (const resource of RESOURCES) {
      const grants = matrix[resource];
      permissions[resource] = grants.includes("*") ? ["*"] : [...grants];
    }
    return permissions;
  }

  async function save() {
    const trimmed = name.trim();
    if (!/^[a-z0-9_]{2,50}$/.test(trimmed)) {
      toast.error("Role name must be 2–50 characters of lowercase letters, numbers or underscores");
      return;
    }
    setSaving(true);
    try {
      const body = { name: trimmed, permissions: buildPermissions() };
      if (role) {
        await apiFetch(`/api/admin/roles/${role.id}`, { method: "PATCH", body });
        toast.success("Role updated");
      } else {
        await apiFetch("/api/admin/roles", { method: "POST", body });
        toast.success("Role created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {role
              ? `${readOnly ? "View" : "Edit"} role: ${formatRoleName(role.name)}`
              : "New role"}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "This role is read-only. Built-in roles can't be changed."
              : "Pick what this role can do per resource, or grant everything."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. support, catalog_editor"
              disabled={readOnly}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="role-everything">Everything</Label>
              <p className="text-sm text-muted-foreground">
                Full access to every resource and action, current and future.
              </p>
            </div>
            <Switch
              id="role-everything"
              checked={everything}
              onCheckedChange={setEverything}
              disabled={readOnly}
            />
          </div>
          <div className="max-h-[45vh] overflow-x-auto overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead className="text-center">All</TableHead>
                  {ACTIONS.map((action) => (
                    <TableHead key={action} className="text-center capitalize">
                      {action}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {RESOURCES.map((resource) => {
                  const grants = matrix[resource];
                  const rowAll = everything || grants.includes("*");
                  return (
                    <TableRow key={resource}>
                      <TableCell className="font-medium">
                        {formatRoleName(resource)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          aria-label={`All actions on ${formatRoleName(resource)}`}
                          checked={rowAll}
                          disabled={readOnly || everything}
                          onCheckedChange={(v) => toggleRowAll(resource, v === true)}
                        />
                      </TableCell>
                      {ACTIONS.map((action) => (
                        <TableCell key={action} className="text-center">
                          <Checkbox
                            aria-label={`${action} on ${formatRoleName(resource)}`}
                            checked={rowAll || grants.includes(action)}
                            disabled={readOnly || rowAll}
                            onCheckedChange={(v) => toggleAction(resource, action, v === true)}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {readOnly ? null : (
            <Button onClick={save} disabled={saving}>
              {role ? "Save changes" : "Create role"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
