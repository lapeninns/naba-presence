"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Empty } from "@/components/ui/empty"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { StatusPill } from "@/components/ui/status-pill"
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
 * The people who may edit this listing on Google, as `ListRow`s in one card
 * (like an account list): a neutral initials avatar (D9), the Google
 * account, its role in words with whether they have access yet, and the
 * row's own controls on the line under it. The rows are `interactive={false}`
 * because each carries its own buttons. The account wraps rather than
 * truncating, so two similar addresses are never cut to the same text.
 */
export function AdminsList({
  admins,
  renderActions,
  caption = "People with access on Google",
}: {
  admins: AdminRow[]
  renderActions?: (admin: AdminRow) => React.ReactNode
  caption?: string
}) {
  if (admins.length === 0)
    return <Empty size="sm" framed title="Google listed no one here." />
  return (
    <div className="rounded-(--np-radius-card) border border-line bg-surface">
      <ListRows aria-label={caption}>
        {admins.map((admin, index) => {
          const person = admin.admin ?? admin.name ?? "Unnamed Google account"
          const actions = renderActions?.(admin)
          return (
            <ListRow
              key={admin.name ?? index}
              interactive={false}
              emphasis="neutral"
              leading={
                <Avatar size="list" aria-hidden>
                  <AvatarFallback>{initials(person)}</AvatarFallback>
                </Avatar>
              }
              title={
                <span className="block wrap-anywhere whitespace-normal">
                  {person}
                </span>
              }
              subtitle={
                <span className="block whitespace-normal">
                  {admin.role
                    ? adminRoleLabel(admin.role)
                    : "Role not reported by Google"}
                </span>
              }
              trailing={
                admin.pendingInvitation ? (
                  <StatusPill tone="pending">Invitation pending</StatusPill>
                ) : (
                  <StatusPill tone="healthy">Has access</StatusPill>
                )
              }
              tags={actions}
            />
          )
        })}
      </ListRows>
    </div>
  )
}
