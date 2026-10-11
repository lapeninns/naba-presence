import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type {
  ReportCompleteness,
  ReportMissingReason,
} from "@/lib/contracts/analytics"
import { formatDate } from "@/lib/format"

const MISSING_LABEL: Record<ReportMissingReason, string> = {
  pending: "Not fetched from Google yet",
  unavailable: "Could not be refreshed",
  no_data: "Google has reported nothing",
}

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** A day (presence, Google's own dates) or a `YYYY-MM` month (keywords). */
function formatThrough(value: string) {
  return value.length === 7
    ? MONTH.format(new Date(`${value}-01T00:00:00Z`))
    : formatDate(value, "UTC")
}

/**
 * A report that does not cover every location in scope says so: how many it
 * shows, which are missing and why, and the oldest date every covered
 * location is complete through. Missing locations add nothing to the totals,
 * which are never padded with zeros for them. Renders nothing for a complete
 * report, or for a server that predates the completeness field.
 */
export function PartialCoverageAlert({
  completeness,
  nouns = { one: "location", many: "locations" },
}: {
  completeness: ReportCompleteness | null | undefined
  nouns?: { one: string; many: string }
}) {
  if (!completeness || completeness.state !== "partial") return null
  const noun = (count: number) => (count === 1 ? nouns.one : nouns.many)
  const groups = (Object.keys(MISSING_LABEL) as ReportMissingReason[]).flatMap(
    (reason) => {
      const names = completeness.missing
        .filter((location) => location.reason === reason)
        .map((location) => location.name)
      return names.length ? [{ reason, names }] : []
    }
  )
  const behind = completeness.refreshFailed.map((location) => location.name)
  return (
    <Alert variant="warning" data-slot="partial-coverage">
      <AlertTitle>
        {completeness.missing.length
          ? `Showing ${completeness.covered} of ${completeness.expected} ${noun(completeness.expected)}`
          : `Some ${nouns.many} could not be refreshed`}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 pl-4.5">
          {groups.map((group) => (
            <li key={group.reason}>
              {MISSING_LABEL[group.reason]}: {group.names.join(", ")}
            </li>
          ))}
          {behind.length ? (
            <li>
              Latest refresh failed, so figures may stop early:{" "}
              {behind.join(", ")}
            </li>
          ) : null}
          {completeness.missing.length ? (
            <li>
              Totals include only the {noun(completeness.covered)} shown; a
              missing {nouns.one} is not counted as zero.
            </li>
          ) : null}
          {completeness.completeThrough ? (
            <li>
              {`Complete for every ${nouns.one} shown through ${formatThrough(completeness.completeThrough)}.`}
            </li>
          ) : null}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
