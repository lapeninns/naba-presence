import { Badge } from "@/components/ui/badge"
import { roleLabel } from "@/lib/settings/forms/invitation"
import type { MemberRole } from "@/lib/api/members"

/**
 * The Team tables on a phone read as a Notion Mail list (REFERENCE-BRIEF
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
