"use client"

import { ChevronRightIcon } from "lucide-react"

import { ListRow } from "@/components/ui/list-row"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusGlyph } from "@/components/ui/status-glyph"
import { StatusPill } from "@/components/ui/status-pill"
import { useHydrated } from "@/lib/hooks/use-hydrated"
import type { OutboxItem } from "@/lib/outbox/contract"
import { outboxRecoveryVerb, outboxStatus } from "@/lib/outbox/vocabulary"

const TIME_OF_DAY = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/**
 * One Outbox row: what is on its way (or back), where, its state in the
 * shared vocabulary, how long it has been there, and the verb of the screen
 * that acts on it. The whole row is a link to that screen; the Outbox never
 * sends anything itself.
 */
export function OutboxRow({ item }: { item: OutboxItem }) {
  // A retry time is shown in the viewer's own zone, which the server cannot
  // know, so it lands one render after hydration ("Will retry later" first).
  const hydrated = useHydrated()
  const status = outboxStatus(item.state, {
    time:
      hydrated && item.retryAt
        ? TIME_OF_DAY.format(new Date(item.retryAt))
        : undefined,
  })
  const verb = outboxRecoveryVerb(item.kind, item.state)
  const place = [item.locationName, item.clientName].filter(Boolean).join(" · ")

  return (
    <ListRow
      href={item.href}
      emphasis="neutral"
      titleAs="h3"
      wrapperProps={{ "data-state": item.state, "data-kind": item.kind }}
      leading={
        <span
          aria-hidden
          className="flex size-(--np-avatar-list) items-center justify-center rounded-(--np-radius-pill) bg-fill text-ink-secondary"
        >
          <StatusGlyph glyph={status.glyph} className="size-4" />
        </span>
      }
      title={item.title}
      meta={<RelativeTime iso={item.at} casing="sentence" />}
      subtitle={place}
      trailing={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      preview={item.detail ?? undefined}
      tags={
        <span className="inline-flex items-center gap-0.5 text-ui font-medium text-ink">
          {verb}
          <ChevronRightIcon aria-hidden className="size-4" />
        </span>
      }
    />
  )
}
