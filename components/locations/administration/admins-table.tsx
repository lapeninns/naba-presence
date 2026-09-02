"use client"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { adminRoleLabel } from "@/lib/locations/console-labels"

export type AdminRow = { name?: string; admin?: string; role?: string; pendingInvitation?: boolean }

export function AdminsTable({
  admins, invitations, renderActions,
}: {
  admins: AdminRow[]
  invitations: Array<{ name?: string; role?: string; targetType?: string }>
  renderActions?: (admin: AdminRow) => React.ReactNode
}) {
  return (
    <Table className="min-w-[520px]">
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          {renderActions ? <TableHead>Actions</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {admins.map((admin, index) => (
          <TableRow key={admin.name ?? index}>
            <TableCell className="font-medium">{admin.admin ?? admin.name ?? "—"}</TableCell>
            <TableCell>{admin.role ? adminRoleLabel(admin.role) : "—"}</TableCell>
            <TableCell><Badge variant="secondary">Active</Badge></TableCell>
            {renderActions ? <TableCell>{renderActions(admin)}</TableCell> : null}
          </TableRow>
        ))}
        {invitations.map((invitation, index) => (
          <TableRow key={invitation.name ?? `inv-${index}`}>
            <TableCell className="font-medium">{invitation.name ?? "—"}</TableCell>
            <TableCell>{invitation.role ? adminRoleLabel(invitation.role) : "—"}</TableCell>
            <TableCell><Badge variant="info">Invited</Badge></TableCell>
            {renderActions ? <TableCell /> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
