"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { GroupedList } from "@/components/ui/grouped-list"
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
 * The people who may edit this listing on Google, as a list of rows (one
 * card of rows, like an account list): a neutral initials avatar, the Google
 * account, its role in words with whether they have access yet, and the
 * row's actions at the trailing edge. On a phone the actions drop onto
 * their own line under the account instead of squeezing it.
 *
 * Row regions (leading / title / subtitle / trailing) match the coming
 * `ListRow` primitive, so swapping it in is mechanical.
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
    return (
      <Card size="sm">
        <CardContent className="text-ui text-ink-muted">
          Google listed no one here.
        </CardContent>
      </Card>
    )
  return (
    <GroupedList aria-label={caption}>
      {admins.map((admin, index) => {
        const person = admin.admin ?? admin.name ?? "Unnamed Google account"
        const actions = renderActions?.(admin)
        return (
          <li
            key={admin.name ?? index}
            data-slot="admin-row"
            className="flex min-h-(--np-row-h) min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-(--np-card-pad) py-3 first:border-t-0"
          >
            {/* Leading: the person, never a status colour (D9). */}
            <Avatar aria-hidden>
              <AvatarFallback>{initials(person)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
              <span className="text-body font-medium wrap-anywhere text-ink">
                {person}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-secondary">
                <span>
                  {admin.role
                    ? adminRoleLabel(admin.role)
                    : "Role not reported by Google"}
                </span>
                {admin.pendingInvitation ? (
                  <StatusPill tone="pending">Invitation pending</StatusPill>
                ) : (
                  <StatusPill tone="healthy">Has access</StatusPill>
                )}
              </span>
            </div>
            {actions ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-11">
                {actions}
              </div>
            ) : null}
          </li>
        )
      })}
    </GroupedList>
  )
}
