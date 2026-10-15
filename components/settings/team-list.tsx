import { ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonList } from "@/components/ui/skeleton"
import { roleLabel } from "@/lib/settings/forms/invitation"
import type { MemberRole } from "@/lib/api/members"

/**
 * The Team tables in a narrow column (a tablet beside the rail) read as a Notion Mail list (REFERENCE-BRIEF
 * §4.3 ListRow): below md the card edge goes and the rows sit flat on the
 * canvas, each row's hairline starts at the text column, and the detail
 * lines (access, publishing, status) line up under the name instead of
 * under the avatar. Desk keeps the bordered table. These only add classes
 * to the responsive `Table`; its record-card markup (data-priority,
 * data-span, the actions cell) is unchanged.
 */
export const TEAM_LIST_CONTAINER_CLASS =
  "max-md:rounded-none max-md:border-0 max-md:bg-transparent"

/**
 * The text column starts past the 32px avatar and its 10px gap
 * (`ps-10.5`). The row's own border is replaced by a hairline drawn from
 * that column (`start-11.5` with the row's `px-1`) to the edge, and the last
 * row has none. Team rows are never `data-interactive`, so `::after` is free.
 */
export const TEAM_LIST_TABLE_CLASS = [
  "@max-3xl/table:[&_tbody>tr]:border-0 @max-3xl/table:[&_tbody>tr]:px-1",
  "@max-3xl/table:[&_tbody>tr:not(:last-child)]:after:absolute @max-3xl/table:[&_tbody>tr:not(:last-child)]:after:start-11.5 @max-3xl/table:[&_tbody>tr:not(:last-child)]:after:end-0 @max-3xl/table:[&_tbody>tr:not(:last-child)]:after:bottom-0 @max-3xl/table:[&_tbody>tr:not(:last-child)]:after:h-px @max-3xl/table:[&_tbody>tr:not(:last-child)]:after:bg-line @max-3xl/table:[&_tbody>tr:not(:last-child)]:after:content-['']",
  "@max-3xl/table:[&_tbody>tr>td:not([data-priority=primary]):not([data-priority=trailing]):not([data-actions])]:ps-10.5",
].join(" ")

/**
 * The role as a sentence-case chip ("Admin"), a neutral fill pill: role is
 * metadata, not a status, so it carries no status hue (D3).
 */
export function RoleChip({ role }: { role: MemberRole }) {
  return (
    <Badge
      variant="secondary"
      shape="pill"
      className="h-6 px-2.5 text-ui font-medium"
    >
      {roleLabel(role)}
    </Badge>
  )
}

/**
 * A member's role where it can be changed (SET-10): the same chip, as a
 * button that opens Change role in one tap. Where it can't, the plain chip;
 * the member sheet and the row menu say why.
 */
export function RoleControl({
  role,
  name,
  reason,
  disabled,
  onChangeRole,
}: {
  role: MemberRole
  name: string
  reason: string | null
  disabled?: boolean
  onChangeRole: () => void
}) {
  if (reason !== null) return <RoleChip role={role} />
  const label = roleLabel(role)
  return (
    <Button
      variant="secondary"
      size="sm"
      pill
      aria-haspopup="dialog"
      // The visible role starts the name (WCAG 2.5.3); the rest says whose.
      aria-label={`${label}: change ${name}’s role`}
      disabled={disabled}
      onClick={onChangeRole}
      className="font-medium"
    >
      {label}
      <ChevronDown aria-hidden />
    </Button>
  )
}

/**
 * Members while they load (SET-09), the one skeleton for the route's
 * loading.tsx and the list's own pending state: below md, rows the height
 * of a member `ListRow` (avatar, name, email, the role chip and its line);
 * from md, the table's rows. `label` makes it the live region that says
 * what is loading; leave it out where the page already says so.
 */
export function MembersSkeleton({
  rows = 3,
  label,
}: {
  rows?: number
  label?: string
}) {
  return (
    <div aria-busy="true" data-slot="members-skeleton">
      {label ? (
        <span className="sr-only" role="status">
          {label}
        </span>
      ) : null}
      <div aria-hidden="true" className="-mx-5 flex flex-col md:hidden">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex gap-3 px-5 pt-(--np-row-mail-py) pb-(--np-row-mail-py)"
          >
            <Skeleton className="size-(--np-avatar-list) shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3.5 w-3/4" />
              <div className="flex items-center gap-2 pt-1.5">
                <Skeleton className="h-(--np-control-h-sm) w-20 rounded-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <SkeletonList rows={rows} className="max-md:hidden" />
    </div>
  )
}
