"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarClock } from "lucide-react"
import { useId, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ApiClientError } from "@/lib/api/client"
import {
  createPostSchedule,
  revisePostSchedule,
} from "@/lib/api/publication-schedules"
import type { PublicationSchedule } from "@/lib/contracts/publication-schedules"
import {
  clockChangeNote,
  describeScheduleRule,
  eventOffsetsSchema,
  expandSchedule,
  scheduleRuleSchema,
  type ScheduleRule,
} from "@/lib/domain/publication-schedule"
import { queryKeys } from "@/lib/queries/keys"
import { COMMON_TIMEZONES, timezoneLabel } from "@/lib/settings/timezones"

type Frequency = ScheduleRule["frequency"]
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Read only from the open handler, never during render. */
function currentTime() {
  return Date.now()
}

function initial(existing: PublicationSchedule | undefined, openedAt: number) {
  const rule = existing?.rule
  const tomorrow = new Date(openedAt + 86_400_000).toISOString().slice(0, 10)
  return {
    frequency: (rule?.frequency ?? "once") as Frequency,
    startDate: rule?.startDate ?? tomorrow,
    localTime: rule?.localTime ?? "09:00",
    weekdays: rule?.frequency === "weekly" ? rule.weekdays : [1],
    dayOfMonth: rule?.frequency === "monthly" ? rule.dayOfMonth : 1,
    endType: (rule && rule.frequency !== "once" ? rule.end.type : "count") as
      "count" | "date",
    count:
      rule && rule.frequency !== "once" && rule.end.type === "count"
        ? rule.end.count
        : 4,
    endDate:
      rule && rule.frequency !== "once" && rule.end.type === "date"
        ? rule.end.date
        : tomorrow,
    startDays: existing?.eventOffsets?.startDays ?? 0,
    endDays: existing?.eventOffsets?.endDays ?? 0,
  }
}

/**
 * Prepares a publication schedule for one post, or a new revision of an
 * existing schedule. The preview is the exact expansion the approver will
 * see; submitting saves it for approval and publishes nothing.
 */
export function SchedulePostSheet({
  locationId,
  post,
  timezone,
  existing,
  trigger,
}: {
  locationId: string
  post: { id: string; topicType: string; summary: string }
  timezone: string
  existing?: PublicationSchedule
  trigger?: (open: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  // Captured when the sheet opens, so rendering stays pure.
  const [openedAt, setOpenedAt] = useState(0)
  const [form, setForm] = useState(() => initial(existing, 0))
  const [zone, setZone] = useState(existing?.timezone ?? timezone)
  const [failure, setFailure] = useState<string | null>(null)
  const client = useQueryClient()
  const id = useId()
  const dated = post.topicType === "EVENT" || post.topicType === "OFFER"
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const parsed = useMemo(() => {
    const end =
      form.endType === "count"
        ? { type: "count" as const, count: form.count }
        : { type: "date" as const, date: form.endDate }
    const raw =
      form.frequency === "once"
        ? {
            frequency: "once",
            startDate: form.startDate,
            localTime: form.localTime,
          }
        : form.frequency === "daily"
          ? {
              frequency: "daily",
              startDate: form.startDate,
              localTime: form.localTime,
              end,
            }
          : form.frequency === "weekly"
            ? {
                frequency: "weekly",
                startDate: form.startDate,
                localTime: form.localTime,
                end,
                weekdays: form.weekdays,
              }
            : {
                frequency: "monthly",
                startDate: form.startDate,
                localTime: form.localTime,
                end,
                dayOfMonth: form.dayOfMonth,
              }
    return scheduleRuleSchema.safeParse(raw)
  }, [form])
  const offsets =
    dated && form.frequency !== "once"
      ? eventOffsetsSchema.safeParse({
          startDays: form.startDays,
          endDays: form.endDays,
        })
      : null
  const expansion = parsed.success ? expandSchedule(parsed.data, zone) : null
  const future =
    expansion?.occurrences.filter(
      (occurrence) => Date.parse(occurrence.intendedAt) > openedAt
    ) ?? []
  const problem = !parsed.success
    ? (parsed.error.issues[0]?.message ?? "Check the schedule.")
    : offsets && !offsets.success
      ? (offsets.error.issues[0]?.message ?? "Check the event dates.")
      : future.length === 0
        ? "Every time in this schedule has already passed."
        : null

  const save = useMutation({
    mutationFn: () => {
      const rule = scheduleRuleSchema.parse(parsed.success ? parsed.data : null)
      const eventOffsets = offsets?.success ? offsets.data : null
      return existing
        ? revisePostSchedule(locationId, existing.id, {
            rule,
            timezone: zone,
            eventOffsets,
          })
        : createPostSchedule(locationId, {
            postId: post.id,
            rule,
            timezone: zone,
            eventOffsets,
          })
    },
    onSuccess: () => {
      setFailure(null)
      setOpen(false)
      void client.invalidateQueries({
        queryKey: queryKeys.postSchedules(locationId),
      })
      void client.invalidateQueries({
        queryKey: queryKeys.scheduleOccurrencesAll,
      })
    },
    onError: (error) =>
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "The schedule could not be saved. Try again."
      ),
  })
  const zones = [...new Set([zone, timezone, ...COMMON_TIMEZONES])]
  function show() {
    const at = currentTime()
    setOpenedAt(at)
    setForm(initial(existing, at))
    setOpen(true)
  }

  return (
    <>
      {trigger ? (
        trigger(show)
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={show}
          aria-label={`Schedule publication: ${post.summary.slice(0, 60) || "post"}`}
        >
          <CalendarClock aria-hidden /> Schedule
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" size="wide" className="flex flex-col gap-0">
          <SheetHeader>
            <SheetTitle>
              {existing
                ? "Change publication schedule"
                : "Schedule publication"}
            </SheetTitle>
            <SheetDescription>
              When NabaPresence publishes this post, separate from any repeat in
              the event itself. It needs approval before anything is published
              {existing ? ", and changing it needs a fresh approval" : ""}.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-5">
            <SegmentedControl
              value={form.frequency}
              onValueChange={(value) => set("frequency", value as Frequency)}
              aria-label="How often"
            >
              <SegmentedControlItem value="once">Once</SegmentedControlItem>
              <SegmentedControlItem value="daily">Daily</SegmentedControlItem>
              <SegmentedControlItem value="weekly">Weekly</SegmentedControlItem>
              <SegmentedControlItem value="monthly">
                Monthly
              </SegmentedControlItem>
            </SegmentedControl>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-ui text-ink">
                {form.frequency === "once" ? "Date" : "Starting"}
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => set("startDate", event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-ui text-ink">
                Local time
                <Input
                  type="time"
                  value={form.localTime}
                  onChange={(event) => set("localTime", event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1.5">
              <span id={`${id}-zone`} className="text-ui text-ink">
                Timezone
              </span>
              <Select
                value={zone}
                onValueChange={(value) => value && setZone(value)}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby={`${id}-zone`}
                >
                  <SelectValue>
                    {(value: string | null) =>
                      value ? timezoneLabel(value) : ""
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {zones.map((option) => (
                    <SelectItem key={option} value={option}>
                      {timezoneLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.frequency === "weekly" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-ui text-ink">On</legend>
                <div className="flex flex-wrap gap-3">
                  {WEEKDAYS.map((label, index) => (
                    <Checkbox
                      key={label}
                      label={label}
                      checked={form.weekdays.includes(index + 1)}
                      onCheckedChange={(checked) =>
                        set(
                          "weekdays",
                          checked
                            ? [...form.weekdays, index + 1].sort()
                            : form.weekdays.filter((day) => day !== index + 1)
                        )
                      }
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}
            {form.frequency === "monthly" ? (
              <label className="flex max-w-40 flex-col gap-1.5 text-ui text-ink">
                Day of the month
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.dayOfMonth}
                  onChange={(event) =>
                    set("dayOfMonth", Number(event.target.value))
                  }
                />
              </label>
            ) : null}
            {form.frequency !== "once" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-ui text-ink">Ends</legend>
                <SegmentedControl
                  value={form.endType}
                  onValueChange={(value) =>
                    set("endType", value as "count" | "date")
                  }
                  aria-label="Ends after"
                >
                  <SegmentedControlItem value="count">
                    After a number of times
                  </SegmentedControlItem>
                  <SegmentedControlItem value="date">
                    On a date
                  </SegmentedControlItem>
                </SegmentedControl>
                {form.endType === "count" ? (
                  <label className="flex max-w-40 flex-col gap-1.5 text-ui text-ink">
                    Times
                    <Input
                      type="number"
                      min={1}
                      max={366}
                      value={form.count}
                      onChange={(event) =>
                        set("count", Number(event.target.value))
                      }
                    />
                  </label>
                ) : (
                  <label className="flex max-w-56 flex-col gap-1.5 text-ui text-ink">
                    Last date
                    <Input
                      type="date"
                      value={form.endDate}
                      onChange={(event) => set("endDate", event.target.value)}
                    />
                  </label>
                )}
              </fieldset>
            ) : null}
            {dated && form.frequency !== "once" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-ui text-ink">
                  Event dates for each publication
                </legend>
                <p className="text-caption text-ink-muted">
                  Days after each publication date. These are shown to the
                  approver and frozen with the schedule.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-ui text-ink">
                    Starts after (days)
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      value={form.startDays}
                      onChange={(event) =>
                        set("startDays", Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-ui text-ink">
                    Ends after (days)
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      value={form.endDays}
                      onChange={(event) =>
                        set("endDays", Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </fieldset>
            ) : null}
            <section
              aria-labelledby={`${id}-preview`}
              className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface-alt p-3"
            >
              <h3
                id={`${id}-preview`}
                className="text-ui font-semibold text-ink"
              >
                Preview
              </h3>
              {problem ? (
                <p role="alert" className="text-ui text-danger-ink">
                  {problem}
                </p>
              ) : parsed.success && expansion ? (
                <>
                  <p className="text-ui text-ink">
                    {describeScheduleRule(parsed.data, zone)}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {future.length}{" "}
                    {future.length === 1 ? "publication" : "publications"} from
                    now
                    {expansion.skippedDates.length
                      ? ` · skipped months: ${expansion.skippedDates.join(", ")}`
                      : ""}
                    . A missed time publishes up to 24 hours late at most; an
                    ended event or offer is never published late.
                  </p>
                  <ol className="flex flex-col gap-1 text-ui text-ink-secondary">
                    {future.slice(0, 8).map((occurrence) => (
                      <li key={occurrence.intendedAt} className="tabular-nums">
                        {occurrence.localDate} {occurrence.localTime}
                        {occurrence.adjustment !== "none" ? (
                          <span className="text-caption text-warning-ink">
                            {" "}
                            · {clockChangeNote(occurrence.adjustment)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {future.length > 8 ? (
                      <li className="text-caption text-ink-muted">
                        and {future.length - 8} more
                      </li>
                    ) : null}
                  </ol>
                </>
              ) : null}
            </section>
            {failure ? (
              <p role="alert" className="text-ui text-danger-ink">
                {failure}
              </p>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(problem)}
              pending={save.isPending}
              onClick={() => save.mutate()}
            >
              {existing
                ? "Submit changed schedule for approval"
                : "Submit schedule for approval"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
