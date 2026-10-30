"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"

import { CsvDownloadButton } from "@/components/reporting/csv-download-button"
import {
  nullableCell,
  ReportingPanel,
} from "@/components/reporting/reporting-states"
import { ScopeSelect } from "@/components/performance/scope-select"
import {
  ReviewTopicsSparkline,
  sparklineLabel,
} from "@/components/reports/review-topics-sparkline"
import { SectionHeader } from "@/components/ui/section-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiFetch, type RequestOptions } from "@/lib/api/client"
import {
  REVIEW_TOPIC_LABELS,
  REVIEW_TOPICS,
  type ReviewTopic,
} from "@/lib/domain/review-topics"
import {
  reviewTopicReportSchema,
  type ReviewTopicReport,
  type ReviewTopicReportQuery,
} from "@/lib/domain/review-topics-report"
import {
  topicTrendsCsv,
  type TopicLine,
} from "@/lib/domain/review-topics-trends"
import { formatNumber, formatPercent } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { csvFilename } from "@/lib/reporting/csv"
import { cn } from "@/lib/utils"
import { LISTING_TERMS } from "@/lib/workspace/terms"

export function fetchReviewTopicReport(
  params: ReviewTopicReportQuery,
  options?: RequestOptions
) {
  const query = new URLSearchParams()
  if (params.clientId) query.set("client_id", params.clientId)
  if (params.locationId) query.set("location_id", params.locationId)
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/analytics/review-topics${suffix}`, {
    schema: reviewTopicReportSchema,
    ...options,
  })
}

export function useReviewTopicReport(params: ReviewTopicReportQuery) {
  return useQuery({
    queryKey: queryKeys.analytics("review-topics", params),
    queryFn: (ctx) => fetchReviewTopicReport(params, requestOptions(ctx)),
  })
}

const LINK_CLASS =
  "rounded-(--np-radius-tag) break-words underline decoration-line-strong underline-offset-3 focus-halo hover:decoration-current pointer-coarse:inline-flex pointer-coarse:min-h-(--np-touch) pointer-coarse:items-center"

const percent = (value: number | null) =>
  nullableCell(value, (v) => formatPercent(v * 100))

/** Which reviews a figure counts, so its link opens the same ones. */
type Scope = { clientId?: string; locationId?: string; since: string }

/**
 * The inbox on the reviews a figure counts: every queue, the topic, the
 * client or listing in scope, and the trend's first day. (The inbox dates by
 * last update, the report by when the review was written, so an edited old
 * review can still appear.)
 */
function inboxHref(topic: ReviewTopic, scope: Scope) {
  const query = new URLSearchParams({ queue: "all", topic })
  if (scope.clientId) query.set("clientId", scope.clientId)
  if (scope.locationId) query.set("locationId", scope.locationId)
  query.set("dateFrom", `${scope.since}T00:00:00.000Z`)
  return `/inbox?${query}`
}

function reportHref(locationId: string, clientId?: string) {
  const query = new URLSearchParams({ locationId })
  if (clientId) query.set("clientId", clientId)
  return `/reports?${query}`
}

function byMentions(a: TopicLine, b: TopicLine) {
  return b.mentions - a.mentions || a.topic.localeCompare(b.topic)
}

const reviewsWithText = (n: number) =>
  `${formatNumber(n)} ${n === 1 ? "review" : "reviews"} with text`

/**
 * "What guests talk about" on Reports (S3): which topics reviews with text
 * mention, how often, how negatively, and the last 8 weeks of each. One
 * table for the scope the page shows (the group, a client, or one listing),
 * then, when there is more than one listing, a listing-by-listing table for
 * a chosen topic. Rendered only for organisations with the review_topics
 * feature on (app/(dashboard)/reports/page.tsx), and draws nothing for a
 * scope with no listings: the report above already says so.
 */
export function ReviewTopicsPanel({
  clientId,
  locationId,
}: ReviewTopicReportQuery) {
  const report = useReviewTopicReport({ clientId, locationId })
  const headingId = React.useId()
  if (report.isSuccess && report.data.locations.length === 0) return null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <SectionHeader
        as="h2"
        id={headingId}
        title="What guests talk about"
        description="Always the last 8 weeks, whatever the period above"
        actions={
          report.data && report.data.group.classifiedReviews > 0 ? (
            <CsvDownloadButton
              filename={csvFilename("review topics")}
              subject="review topics"
              rows={() => topicTrendsCsv(report.data)}
            />
          ) : null
        }
      />
      {report.isPending ? (
        <ReportingPanel variant="loading" title="Loading review topics…" />
      ) : report.isError ? (
        <ReportingPanel
          variant="error"
          framed
          cause={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <ReviewTopicsBody
          report={report.data}
          scope={{ clientId, locationId, since: report.data.weeks[0] }}
        />
      )}
    </section>
  )
}

function ReviewTopicsBody({
  report,
  scope,
}: {
  report: ReviewTopicReport
  scope: Scope
}) {
  const pending = report.pendingReviews
  if (report.group.classifiedReviews === 0) {
    return (
      <ReportingPanel
        variant="collecting"
        framed
        title="No reviews sorted into topics yet"
        description={
          pending > 0
            ? `${reviewsWithText(pending)} ${pending === 1 ? "is" : "are"} waiting to be sorted. Topics appear here once they are.`
            : "Reviews with text are sorted into topics after they arrive."
        }
      />
    )
  }
  const mentioned = report.group.topics
    .filter((line) => line.mentions > 0)
    .sort(byMentions)
  const unmentioned = report.group.topics.filter((line) => line.mentions === 0)
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <div className="flex flex-col gap-2">
        <p className="text-caption text-ink-muted">
          {`From ${reviewsWithText(report.group.classifiedReviews)}.`}
          {pending > 0
            ? ` ${formatNumber(pending)} more ${pending === 1 ? "is" : "are"} waiting to be sorted.`
            : null}
          {
            " Mentioned in: the share of those reviews that talk about the topic. Negative: the share of those mentions that were negative."
          }
        </p>
        <TopicTable lines={mentioned} scope={scope} />
        {unmentioned.length > 0 ? (
          <p className="text-caption text-ink-muted">
            {`Not mentioned: ${unmentioned
              .map((line) => REVIEW_TOPIC_LABELS[line.topic])
              .join(", ")}.`}
          </p>
        ) : null}
      </div>
      {!scope.locationId && report.locations.length > 1 ? (
        <ListingsByTopic
          report={report}
          scope={scope}
          initialTopic={mentioned[0]?.topic ?? REVIEW_TOPICS[0]}
        />
      ) : null}
    </div>
  )
}

function TopicTable({ lines, scope }: { lines: TopicLine[]; scope: Scope }) {
  return (
    <Table surface responsive>
      <TableHeader>
        <TableRow>
          <TableHead>Topic</TableHead>
          <TableHead numeric>Mentioned in</TableHead>
          <TableHead numeric>Negative</TableHead>
          <TableHead>Last 8 weeks</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <FiguresRow
            key={line.topic}
            line={line}
            name={
              <Link
                href={inboxHref(line.topic, scope)}
                className={LINK_CLASS}
                aria-label={`${REVIEW_TOPIC_LABELS[line.topic]}: open these reviews in the inbox`}
              >
                {REVIEW_TOPIC_LABELS[line.topic]}
              </Link>
            }
          />
        ))}
      </TableBody>
    </Table>
  )
}

function FiguresRow({
  line,
  name,
  mentionsHref,
  mentionsLabel,
}: {
  line: TopicLine
  name: React.ReactNode
  /** Where the mention count leads, when it is a link. */
  mentionsHref?: string
  mentionsLabel?: string
}) {
  const share = percent(line.share)
  const negative = percent(line.negativeShare)
  const shareText = share.isNull
    ? share.text
    : `${share.text} (${formatNumber(line.mentions)})`
  return (
    <TableRow>
      <TableCell priority="primary" className="font-medium text-ink">
        {name}
      </TableCell>
      <TableCell
        numeric
        label="Mentioned in"
        className={cn(share.isNull && "text-ink-muted")}
      >
        {mentionsHref && line.mentions > 0 ? (
          <Link
            href={mentionsHref}
            className={LINK_CLASS}
            aria-label={mentionsLabel}
          >
            {shareText}
          </Link>
        ) : (
          shareText
        )}
      </TableCell>
      <TableCell
        numeric
        label="Negative"
        className={cn(
          negative.isNull && "text-ink-muted",
          !negative.isNull && line.negative > 0 && "text-danger-ink"
        )}
      >
        {negative.text}
      </TableCell>
      <TableCell label="Last 8 weeks">
        {line.mentions > 0 ? (
          <ReviewTopicsSparkline
            weekly={line.weekly}
            weeklyNegative={line.weeklyNegative}
            label={sparklineLabel(line.weekly, line.weeklyNegative)}
          />
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function ListingsByTopic({
  report,
  scope,
  initialTopic,
}: {
  report: ReviewTopicReport
  scope: Scope
  initialTopic: ReviewTopic
}) {
  const [topic, setTopic] = React.useState<ReviewTopic>(initialTopic)
  const headingId = React.useId()
  const label = REVIEW_TOPIC_LABELS[topic]
  const rows = report.locations
    .map((location) => ({
      location,
      line: location.topics.find((line) => line.topic === topic)!,
    }))
    .sort(
      (a, b) =>
        b.line.mentions - a.line.mentions ||
        a.location.name.localeCompare(b.location.name)
    )
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <SectionHeader
        as="h3"
        id={headingId}
        title={`Topic by ${LISTING_TERMS.place}`}
        description="One topic across every listing"
      />
      <ScopeSelect<ReviewTopic>
        label="Topic"
        value={topic}
        onChange={(next) => setTopic(next ?? initialTopic)}
        options={REVIEW_TOPICS.map((id) => ({
          id,
          label: REVIEW_TOPIC_LABELS[id],
        }))}
        className="sm:max-w-xs"
      />
      <Table surface responsive>
        <TableHeader>
          <TableRow>
            <TableHead>{LISTING_TERMS.placeTitle}</TableHead>
            <TableHead numeric>Mentioned in</TableHead>
            <TableHead numeric>Negative</TableHead>
            <TableHead>Last 8 weeks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ location, line }) => (
            <FiguresRow
              key={location.locationId}
              line={line}
              // As in the Reply tab's listing table: the name opens the
              // listing's report, the count opens those reviews.
              name={
                <Link
                  href={reportHref(location.locationId, scope.clientId)}
                  className={LINK_CLASS}
                >
                  {location.name}
                </Link>
              }
              mentionsHref={inboxHref(topic, {
                ...scope,
                locationId: location.locationId,
              })}
              mentionsLabel={`${formatNumber(line.mentions)} ${label.toLowerCase()} mentions at ${location.name}, open in the inbox`}
            />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
