"use client"

import {
  Activity,
  CheckCircle2,
  FileCheck2,
  Inbox,
  RefreshCw,
  Star,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { type ChartConfig } from "@/components/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { ReviewStatus } from "@/lib/naba-review-data"

export type View =
  "overview" | "reviews" | "analytics" | "connections" | "settings"

export function readControlValue(event: { currentTarget: unknown }) {
  return (event.currentTarget as { value: string }).value
}

export function Stars({
  value,
  compact = false,
}: {
  value: number
  compact?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            compact ? "size-3.5" : "size-4",
            star <= value
              ? "fill-rating text-rating"
              : "text-muted-foreground/35"
          )}
          aria-hidden
        />
      ))}
    </span>
  )
}

export function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "published") {
    return (
      <Badge variant="secondary">
        <CheckCircle2 data-icon="inline-start" />
        Published
      </Badge>
    )
  }
  if (status === "awaiting_approval") {
    return (
      <Badge variant="secondary">
        <FileCheck2 data-icon="inline-start" />
        Awaiting approval
      </Badge>
    )
  }
  if (status === "escalated") {
    return <Badge variant="destructive">Escalated</Badge>
  }
  return (
    <Badge variant="outline">
      <Inbox data-icon="inline-start" />
      Needs reply
    </Badge>
  )
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function LiveDataError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <Activity />
      <AlertTitle>Live data could not be loaded</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>No preview values were substituted.</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function EmptyData({ message }: { message: string }) {
  return (
    <Empty className="min-h-[220px] border-0 p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-base">Nothing to show yet</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string
  value: string
  detail: string
  icon: typeof Star
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardDescription>{title}</CardDescription>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="font-mono text-2xl font-medium tracking-tight">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

export const chartConfig = {
  reviews: {
    label: "Reviews",
    color: "var(--chart-1)",
  },
  replies: {
    label: "Replies",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig
