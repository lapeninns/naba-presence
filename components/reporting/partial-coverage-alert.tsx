import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type {
  ReportCompleteness,
  ReportMissingReason,
} from "@/lib/contracts/analytics"
import { formatDate } from "@/lib/format"

const MISSING_LABEL: Record<ReportMissingReason, string> = {
  pending: "Not fetched from Google yet",
  unavailable: "Could not be refreshed",
  no_data: "Google has reported nothing",
  stale: "Google’s latest figures end before this period",
}

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

type Nouns = { one: string; many: string }

const LOCATION_NOUNS: Nouns = { one: "location", many: "locations" }

/**
 * Completeness as the report shows it: the shared client report's DTO
 * carries names only, so ids are optional here.
 */
type Completeness = Omit<ReportCompleteness, "missing" | "refreshFailed"> & {
  missing: Array<{ name: string; reason: ReportMissingReason }>
  refreshFailed: Array<{ name: string }>
}

/** A day (presence, Google's own dates) or a `YYYY-MM` month (keywords). */
function formatThrough(value: string) {
  return value.length === 7
    ? MONTH.format(new Date(`${value}-01T00:00:00Z`))
    : formatDate(value, "UTC")
}

function completeThroughLine(completeness: Completeness, nouns: Nouns) {
  return completeness.completeThrough
    ? `Complete for every ${nouns.one} shown through ${formatThrough(completeness.completeThrough)}.`
    : null
}

/**
 * Which covered locations' latest refresh failed. Rendered inside the
 * "could not be refreshed" alert that already explains why, so the same
 * failure is one warning, not two. Renders nothing when none failed.
 */
export function RefreshFailedNote({
  completeness,
  nouns = LOCATION_NOUNS,
}: {
  completeness: Completeness | null | undefined
  nouns?: Nouns
}) {
  if (!completeness?.refreshFailed.length) return null
  const names = completeness.refreshFailed.map((location) => location.name)
  // With nothing missing, no other banner states the complete-through date.
  const through = completeness.missing.length
    ? null
    : completeThroughLine(completeness, nouns)
  return (
    <p data-slot="refresh-failed" className="mt-1">
      {`Latest refresh failed, so figures may stop early: ${names.join(", ")}.`}
      {through ? ` ${through}` : null}
    </p>
  )
}

/**
 * A report that does not cover every location in scope says so: how many it
 * shows, which are missing and why, and the oldest date every covered
 * location is complete through. Missing locations add nothing to the totals,
 * which are never padded with zeros for them. Shown for a partial report and
 * for one that covers no location at all. `refreshFailedShownElsewhere`
 * leaves covered-but-failed locations to a {@link RefreshFailedNote} in the
 * unavailable-reasons alert. Renders nothing for a complete report, or for a
 * server that predates the completeness field.
 *
 * `compact` (the report tabs) is one line, "Showing 1 of 2 locations", with
 * a Details button that opens the same list in a sheet, so a partial report
 * does not push its first figure down by a screen. The shared client report
 * keeps the list inline.
 */
export function PartialCoverageAlert({
  completeness,
  nouns = LOCATION_NOUNS,
  refreshFailedShownElsewhere = false,
  compact = false,
}: {
  completeness: Completeness | null | undefined
  nouns?: Nouns
  refreshFailedShownElsewhere?: boolean
  compact?: boolean
}) {
  if (!completeness || completeness.state === "complete") return null
  const behind = refreshFailedShownElsewhere
    ? []
    : completeness.refreshFailed.map((location) => location.name)
  if (!completeness.missing.length && !behind.length) return null
  const noun = (count: number) => (count === 1 ? nouns.one : nouns.many)
  const groups = (Object.keys(MISSING_LABEL) as ReportMissingReason[]).flatMap(
    (reason) => {
      const names = completeness.missing
        .filter((location) => location.reason === reason)
        .map((location) => location.name)
      return names.length ? [{ reason, names }] : []
    }
  )
  const through = completeThroughLine(completeness, nouns)
  const title = completeness.missing.length
    ? `Showing ${completeness.covered} of ${completeness.expected} ${noun(completeness.expected)}`
    : `Some ${nouns.many} could not be refreshed`
  const list = (
    <ul className="flex list-disc flex-col gap-1 pl-4.5">
      {groups.map((group) => (
        <li key={group.reason}>
          {MISSING_LABEL[group.reason]}: {group.names.join(", ")}
        </li>
      ))}
      {behind.length ? (
        <li>
          Latest refresh failed, so figures may stop early: {behind.join(", ")}
        </li>
      ) : null}
      {completeness.missing.length ? (
        <li>
          {completeness.covered
            ? `Totals include only the ${noun(completeness.covered)} shown; a missing ${nouns.one} is not counted as zero.`
            : `No ${nouns.one} has figures for this period; none is counted as zero.`}
        </li>
      ) : null}
      {through ? <li>{through}</li> : null}
    </ul>
  )
  if (compact) {
    return (
      <Alert variant="warning" data-slot="partial-coverage">
        <AlertTitle>{title}</AlertTitle>
        <Sheet>
          <AlertAction>
            <SheetTrigger
              render={<Button variant="ghost" size="sm" />}
              aria-label={`Details: ${title}`}
            >
              Details
            </SheetTrigger>
          </AlertAction>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>
                Which {nouns.many} are missing from these figures, and why.
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <div className="text-ui text-ink">{list}</div>
            </SheetBody>
          </SheetContent>
        </Sheet>
      </Alert>
    )
  }
  return (
    <Alert variant="warning" data-slot="partial-coverage">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{list}</AlertDescription>
    </Alert>
  )
}
