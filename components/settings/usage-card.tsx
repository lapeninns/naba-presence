"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  creditPeriodNoun,
  describeCreditsLeft,
  formatResetDate,
} from "@/lib/contracts/ai-credits"
import { useAiCredits, useAiCreditsDaily } from "@/lib/queries/use-ai-credits"

/**
 * The current credit period's AI reply credits (a pilot's calendar month, a
 * trial or a paid period): how many are used, when the period ends, and a
 * small bar per day. Any member can read it. Replies written by hand are
 * free and are not counted here. An unknown allowance is said in words,
 * never shown as zero.
 */
export function UsageCard() {
  const credits = useAiCredits()
  const daily = useAiCreditsDaily()
  const data = credits.data
  const days = daily.data?.days ?? []
  const peak = Math.max(1, ...days.map((day) => day.credits))
  const exhausted = data
    ? data.remaining !== null && data.remaining <= 0
    : false
  const noun = creditPeriodNoun(data?.periodKind ?? null)

  return (
    <Card flush data-slot="usage-card">
      <CardHeader divided>
        <CardTitle as="h2">Usage</CardTitle>
        <CardDescription>
          AI-written replies in the current period. Writing a reply yourself is
          free.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 py-(--np-card-pad)">
        {credits.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : data && data.allowance !== null && data.canUseAi ? (
          <>
            <p className="m-0 text-body text-ink">
              <strong className="font-semibold">
                {data.used} of {data.allowance}
              </strong>{" "}
              credits used {noun}
            </p>
            <Progress
              label={`AI credits used ${noun}`}
              value={data.used}
              max={Math.max(1, data.allowance)}
              tone={exhausted ? "bad" : "default"}
            />
            {data.periodEnd ? (
              <p className="m-0 text-caption text-ink-muted">
                Credits reset on {formatResetDate(data.periodEnd)}.
              </p>
            ) : null}
          </>
        ) : data ? (
          <p data-slot="usage-unavailable" className="m-0 text-body text-ink">
            {describeCreditsLeft(data)}
          </p>
        ) : (
          <p role="alert" className="m-0 text-caption text-danger-ink">
            Usage could not be loaded.
          </p>
        )}
        {days.length > 0 ? (
          <div
            role="img"
            aria-label={`Credits used per day ${noun}: ${
              days
                .filter((day) => day.credits > 0)
                .map((day) => `${day.date} ${day.credits}`)
                .join(", ") || "none yet"
            }`}
            data-slot="usage-bars"
            className="flex h-16 items-end gap-0.5"
          >
            {days.map((day) => (
              <span
                key={day.date}
                title={`${day.date}: ${day.credits}`}
                style={{
                  height: `${Math.max(4, (day.credits / peak) * 100)}%`,
                }}
                className={
                  day.credits > 0
                    ? "min-w-0 flex-1 rounded-sm bg-ink"
                    : "min-w-0 flex-1 rounded-sm bg-fill"
                }
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
