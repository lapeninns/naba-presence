"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { adminRoleLabel } from "@/lib/locations/console-labels"

export type AdminRow = {
  name?: string
  admin?: string
  role?: string
  pendingInvitation?: boolean
}

/** Two letters for the avatar: the start of the local part of an email, or of a name. */
function initials(person: string): string {
  const local = person.split("@")[0] ?? person
  const words = local.split(/[\s._-]+/).filter(Boolean)
  const letters =
    words.length >= 2
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : local.slice(0, 2)
  return letters || "?"
}

/**
 * The people who may edit this listing on Google, as a list: hairline rows,
 * an initials avatar, the role, a state word, and the row's actions at the
 * trailing edge.
 */
export function AdminsTable({
  admins,
  invitations,
  renderActions,
}: {
  admins: AdminRow[]
  invitations: Array<{ name?: string; role?: string; targetType?: string }>
  renderActions?: (admin: AdminRow) => React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-(--np-radius-card) bg-surface">
      <Table className="min-w-[520px]">
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            {renderActions ? (
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {admins.map((admin, index) => {
            const person = admin.admin ?? admin.name ?? "—"
            return (
              <TableRow key={admin.name ?? index}>
                <TableCell className="font-medium text-ink">
                  <span className="flex items-center gap-2.5">
                    <Avatar size="sm">
                      <AvatarFallback>{initials(person)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 truncate">{person}</span>
                  </span>
                </TableCell>
                <TableCell>
                  {admin.role ? adminRoleLabel(admin.role) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">Active</Badge>
                </TableCell>
                {renderActions ? (
                  <TableCell className="text-right">
                    <span className="flex items-center justify-end gap-2">
                      {renderActions(admin)}
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
          {invitations.map((invitation, index) => (
            <TableRow key={invitation.name ?? `inv-${index}`}>
              <TableCell className="font-medium text-ink">
                <span className="flex items-center gap-2.5">
                  <Avatar size="sm">
                    <AvatarFallback>
                      {initials(invitation.name ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 truncate">
                    {invitation.name ?? "—"}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                {invitation.role ? adminRoleLabel(invitation.role) : "—"}
              </TableCell>
              <TableCell>
                <Badge variant="info">Invited</Badge>
              </TableCell>
              {renderActions ? <TableCell /> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
