"use client"

import type { CSSProperties } from "react"

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
 * small bar per day once anything has been used. Any member can read it.
 * Replies written by hand are free and are not counted here. An unknown
 * allowance is said in words, never shown as zero. The bars are a picture
 * of the busiest day said in words beside them: nothing is only in a hover
 * tooltip, which a phone can't reach.
 */
export function UsageCard() {
  const credits = useAiCredits()
  const daily = useAiCreditsDaily()
  const data = credits.data
  const days = daily.data?.days ?? []
  const peak = Math.max(1, ...days.map((day) => day.credits))
  const busiest = days.reduce<(typeof days)[number] | null>(
    (best, day) =>
      day.credits > 0 && (!best || day.credits > best.credits) ? day : best,
    null
  )
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
            {exhausted ? (
              <p
                data-slot="usage-exhausted"
                className="m-0 text-caption text-danger-ink"
              >
                {describeCreditsLeft(data)}
              </p>
            ) : data.periodEnd ? (
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
          <p role="alert" className="m-0 text-ui text-danger-ink">
            Usage could not be loaded.
          </p>
        )}
        {days.length > 0 && !busiest ? (
          <p data-slot="usage-days-empty" className="m-0 text-ui text-ink-muted">
            No AI-written replies yet {noun}.
          </p>
        ) : null}
        {busiest ? (
          <figure className="m-0 flex flex-col gap-1.5">
            <div
              role="img"
              aria-label={`Credits used per day ${noun}: ${days
                .filter((day) => day.credits > 0)
                .map((day) => `${formatResetDate(day.date)} ${day.credits}`)
                .join(", ")}`}
              data-slot="usage-bars"
              className="flex h-16 items-end gap-0.5"
            >
              {days.map((day) => (
                <span
                  key={day.date}
                  style={
                    {
                      "--bar": `${Math.max(4, (day.credits / peak) * 100)}%`,
                    } as CSSProperties
                  }
                  className={
                    day.credits > 0
                      ? "h-(--bar) min-w-0 flex-1 rounded-sm bg-ink"
                      : "h-(--bar) min-w-0 flex-1 rounded-sm bg-fill"
                  }
                />
              ))}
            </div>
            <figcaption className="text-ui text-ink-muted">
              Busiest day: {formatResetDate(busiest.date)}, {busiest.credits}{" "}
              {busiest.credits === 1 ? "credit" : "credits"}.
            </figcaption>
          </figure>
        ) : null}
      </CardContent>
    </Card>
  )
}
