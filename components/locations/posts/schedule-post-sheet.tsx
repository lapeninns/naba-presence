"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarClock } from "lucide-react"
import { useId, useImperativeHandle, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  OptionRow,
  OptionRowGroup,
  OptionSeparator,
} from "@/components/ui/option-row"
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
  SheetBack,
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
  formatUtcOffset,
  planOnceSlot,
  resolveLocalSlot,
  scheduleRuleSchema,
  slotProblemMessage,
  type ScheduleRule,
} from "@/lib/domain/publication-schedule"
import {
  PRESET_TIME,
  formatWallDay,
  presetDates,
  type SchedulePreset,
} from "@/components/locations/posts/schedule-dates"
import { usableSuggestion } from "@/lib/locations/schedule-display"
import { queryKeys } from "@/lib/queries/keys"
import { COMMON_TIMEZONES, timezoneLabel } from "@/lib/settings/timezones"
import { cn } from "@/lib/utils"

type Frequency = ScheduleRule["frequency"]
/** Which preset row is chosen; "custom" is a date and time of one's own. */
type When = SchedulePreset | "custom"
/** The inset sheet's pages: the preset rows, and the pushed full form. */
type Page = "presets" | "custom"
const TITLE = "Schedule publication"
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Read only from the open handler, never during render. */
function currentTime() {
  return Date.now()
}

function initial(
  existing: PublicationSchedule | undefined,
  openedAt: number,
  recurring: boolean,
  zone: string,
  suggested?: { startDate: string; localTime: string }
) {
  const rule = existing?.rule
  const tomorrow = new Date(openedAt + 86_400_000).toISOString().slice(0, 10)
  const hint = usableSuggestion(suggested, zone, openedAt)
  return {
    // Without the repeating feature, a repeating schedule can only be
    // changed into a single publication.
    frequency: (recurring ? (rule?.frequency ?? "once") : "once") as Frequency,
    startDate: rule?.startDate ?? hint?.startDate ?? tomorrow,
    localTime: rule?.localTime ?? hint?.localTime ?? "09:00",
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
    /** A one-time slot's chosen UTC offset, for a time that happens twice. */
    offsetMinutes: existing?.offsetMinutes ?? null,
  }
}

/**
 * Prepares a publication schedule for one post, or a new revision of an
 * existing schedule. The preview is the exact expansion the approver will
 * see; submitting saves it for approval and publishes nothing.
 *
 * One-time publication is the only frequency offered unless the
 * organisation has repeating schedules switched on (`recurring`).
 * `suggested` pre-fills a new schedule's date and time (an old per-post
 * time under review); `newTime` titles the sheet for a missed slot.
 *
 * A new one-time schedule (no `existing`, `suggested`, `newTime` or
 * repeating option) opens as an inset sheet on preset rows (Notion Mail's
 * "Schedule send"): "Tomorrow morning" and "Next Monday", each at 09:00 in
 * the venue's zone and shown resolved with that zone, and "Pick a date and
 * time", which pushes the full form inside the sheet (Back returns). A
 * preset only fills the form's date and time: the same validation,
 * expansion preview and single "Submit schedule for approval" follow, and
 * nothing publishes. Every other case opens the full form directly.
 */
export function SchedulePostSheet({
  locationId,
  post,
  timezone,
  existing,
  trigger,
  openRef,
  recurring = false,
  suggested,
  newTime = false,
}: {
  locationId: string
  post: { id: string; topicType: string; summary: string }
  timezone: string
  existing?: PublicationSchedule
  trigger?: (open: () => void) => React.ReactNode
  /**
   * Opened from somewhere else (a post's "More actions" menu): no trigger is
   * drawn and `open()` is handed back instead.
   */
  openRef?: React.Ref<{ open: () => void }>
  recurring?: boolean
  suggested?: { startDate: string; localTime: string }
  newTime?: boolean
}) {
  const [open, setOpen] = useState(false)
  // Captured when the sheet opens, so rendering stays pure.
  const [openedAt, setOpenedAt] = useState(0)
  const [zone, setZone] = useState(existing?.timezone ?? timezone)
  const [form, setForm] = useState(() =>
    initial(existing, 0, recurring, zone, suggested)
  )
  const [failure, setFailure] = useState<string | null>(null)
  const offerPresets = !existing && !recurring && !newTime && !suggested
  const [when, setWhen] = useState<When>("tomorrow")
  const [page, setPage] = useState<Page>("presets")
  // Read from the moment the sheet opened, in the venue's zone.
  const presets =
    offerPresets && openedAt ? presetDates(openedAt, timezone) : null
  // Any change to the opening values: a swipe or tap outside then asks
  // before throwing the schedule away.
  const [touched, setTouched] = useState(false)
  const client = useQueryClient()
  const id = useId()
  const dated = post.topicType === "EVENT" || post.topicType === "OFFER"
  const set = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K]
  ) => {
    setTouched(true)
    setForm((current) => ({ ...current, [key]: value }))
  }

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
  // One-time slots are strict (P08-R2): a time the clocks skip is refused
  // and a time that happens twice needs its UTC offset chosen.
  const slot =
    parsed.success && parsed.data.frequency === "once"
      ? resolveLocalSlot(parsed.data.startDate, parsed.data.localTime, zone)
      : null
  const offsetMinutes =
    slot?.kind === "ambiguous" &&
    slot.choices.some((choice) => choice.offsetMinutes === form.offsetMinutes)
      ? form.offsetMinutes
      : null
  const once =
    parsed.success && parsed.data.frequency === "once"
      ? planOnceSlot(parsed.data, zone, offsetMinutes, new Date(openedAt))
      : null
  const expansion = !parsed.success
    ? null
    : once
      ? {
          occurrences: once.ok ? [once.occurrence] : [],
          skippedDates: [],
          truncated: false,
        }
      : expandSchedule(parsed.data, zone)
  const future =
    expansion?.occurrences.filter(
      (occurrence) => Date.parse(occurrence.intendedAt) > openedAt
    ) ?? []
  const problem = !parsed.success
    ? (parsed.error.issues[0]?.message ?? "Check the schedule.")
    : offsets && !offsets.success
      ? (offsets.error.issues[0]?.message ?? "Check the event dates.")
      : once && !once.ok
        ? slotProblemMessage(once.problem)
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
            offsetMinutes,
          })
        : createPostSchedule(locationId, {
            postId: post.id,
            rule,
            timezone: zone,
            eventOffsets,
            offsetMinutes,
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
      // Scheduling a post closes the review of any old time it carried.
      void client.invalidateQueries({
        queryKey: queryKeys.legacyPostSchedules(locationId),
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
    // The form opens on its usual default (the date 24 hours on, at 09:00)
    // in the zone last chosen here, never reset to the venue's.
    const start = initial(existing, at, recurring, zone, suggested)
    setForm(start)
    if (offerPresets) {
      // A preset row is chosen only when it is exactly that default.
      const dates = presetDates(at, timezone)
      const match =
        zone === timezone && start.localTime === PRESET_TIME
          ? (["tomorrow", "monday"] as const).find(
              (preset) => dates[preset] === start.startDate
            )
          : undefined
      setWhen(match ?? "custom")
      setPage("presets")
    }
    setTouched(false)
    setOpen(true)
  }
  /** A preset fills the form's date and time, and nothing else. */
  function choose(next: SchedulePreset) {
    setWhen(next)
    if (!presets) return
    setTouched(true)
    setZone(timezone)
    setForm((current) => ({
      ...current,
      startDate: presets[next],
      localTime: PRESET_TIME,
      offsetMinutes: null,
    }))
  }
  /** "Thu 15 Oct, 09:00 · venue time (Europe/London)", or why it can't be. */
  function presetLine(date: string) {
    const plan = planOnceSlot(
      { startDate: date, localTime: PRESET_TIME },
      timezone,
      null,
      new Date(openedAt)
    )
    const line = `${formatWallDay(date)}, ${PRESET_TIME} · venue time (${timezone})`
    return plan.ok ? line : `${line}. ${slotProblemMessage(plan.problem)}`
  }
  /** The custom row's sub-label: the date and time chosen, once there is one. */
  const customLine =
    when === "custom" && parsed.success
      ? `${formatWallDay(parsed.data.startDate)}, ${parsed.data.localTime} · ${timezoneLabel(zone)}`
      : "Choose the day, the time and the timezone."
  const onPresets = offerPresets && page === "presets"
  const showForm = !offerPresets || page === "custom"
  useImperativeHandle(openRef, () => ({ open: show }))

  return (
    <>
      {openRef ? null : trigger ? (
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
      <Sheet
        open={open}
        onOpenChange={setOpen}
        dirty={touched && !save.isPending}
        discardPrompt={{
          title: "Discard this schedule?",
          description:
            "The schedule hasn’t been submitted. Nothing is published or sent for approval.",
          confirmLabel: "Discard schedule",
        }}
      >
        <SheetContent
          side="right"
          // The presets are a short choice list: an inset sheet on a phone,
          // a centred dialog from `sm`. The full form keeps the wide sheet.
          variant={offerPresets ? "inset" : "edge"}
          size={offerPresets ? "default" : "wide"}
          className="flex flex-col gap-0"
        >
          <SheetHeader
            page={offerPresets ? page : undefined}
            back={
              offerPresets && page === "custom" ? (
                <SheetBack to={TITLE} onClick={() => setPage("presets")} />
              ) : undefined
            }
          >
            <SheetTitle>
              {newTime
                ? "Choose a new publication time"
                : existing
                  ? "Change publication schedule"
                  : offerPresets && page === "custom"
                    ? "Pick a date and time"
                    : TITLE}
            </SheetTitle>
            <SheetDescription>
              When NabaPresence publishes this post, separate from any repeat in
              the event itself. It needs approval before anything is published
              {existing ? ", and changing it needs a fresh approval" : ""}.
            </SheetDescription>
          </SheetHeader>
          <SheetBody
            className={cn(
              "flex flex-col",
              offerPresets ? "gap-3" : "gap-5",
              // The pushed form keeps its fields off the inset card's edge.
              offerPresets && page === "custom" && "px-4"
            )}
          >
            {recurring ? (
              <SegmentedControl
                semantics="radio"
                value={form.frequency}
                onValueChange={(value) => set("frequency", value as Frequency)}
                aria-label="How often"
              >
                <SegmentedControlItem value="once">Once</SegmentedControlItem>
                <SegmentedControlItem value="daily">Daily</SegmentedControlItem>
                <SegmentedControlItem value="weekly">
                  Weekly
                </SegmentedControlItem>
                <SegmentedControlItem value="monthly">
                  Monthly
                </SegmentedControlItem>
              </SegmentedControl>
            ) : null}
            {onPresets && presets ? (
              <div className="flex flex-col gap-1">
                <OptionRowGroup label="When to publish">
                  <OptionRow
                    indicator="radio"
                    selected={when === "tomorrow"}
                    label="Tomorrow morning"
                    description={presetLine(presets.tomorrow)}
                    onClick={() => choose("tomorrow")}
                  />
                  <OptionRow
                    indicator="radio"
                    selected={when === "monday"}
                    label="Next Monday"
                    description={presetLine(presets.monday)}
                    onClick={() => choose("monday")}
                  />
                </OptionRowGroup>
                <OptionSeparator />
                {/* Pushes the full form, prefilled with what is chosen. */}
                <OptionRow
                  indicator="chevron"
                  label="Pick a date and time"
                  description={customLine}
                  onClick={() => {
                    setWhen("custom")
                    setPage("custom")
                  }}
                />
              </div>
            ) : null}
            {showForm ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>
                      {form.frequency === "once" ? "Date" : "Starting"}
                    </FieldLabel>
                    <Input
                      type="date"
                      value={form.startDate}
                      onChange={(event) => set("startDate", event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Local time</FieldLabel>
                    <Input
                      type="time"
                      value={form.localTime}
                      onChange={(event) => set("localTime", event.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>Timezone</FieldLabel>
                  <Select
                    value={zone}
                    onValueChange={(value) => {
                      if (!value) return
                      setTouched(true)
                      setZone(value)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(value: string | null) =>
                          value ? timezoneLabel(value) : ""
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent title="Timezone">
                      {zones.map((option) => (
                        <SelectItem key={option} value={option}>
                          {timezoneLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </>
            ) : null}
            {slot?.kind === "ambiguous" ? (
              <div className="flex flex-col gap-1.5">
                <span id={`${id}-offset`} className="text-ui text-ink">
                  Which {form.localTime}
                </span>
                <SegmentedControl
                  semantics="radio"
                  value={offsetMinutes === null ? "" : String(offsetMinutes)}
                  onValueChange={(value) =>
                    set("offsetMinutes", value === "" ? null : Number(value))
                  }
                  aria-labelledby={`${id}-offset`}
                >
                  {slot.choices.map((choice, index) => (
                    <SegmentedControlItem
                      key={choice.offsetMinutes}
                      value={String(choice.offsetMinutes)}
                    >
                      {index === 0 ? "First" : "Second"} (
                      {formatUtcOffset(choice.offsetMinutes)})
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </div>
            ) : null}
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
              <Field className="max-w-40">
                <FieldLabel>Day of the month</FieldLabel>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  value={form.dayOfMonth}
                  onChange={(event) =>
                    set("dayOfMonth", Number(event.target.value))
                  }
                />
              </Field>
            ) : null}
            {form.frequency !== "once" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-ui text-ink">Ends</legend>
                <SegmentedControl
                  semantics="radio"
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
                  <Field className="max-w-40">
                    <FieldLabel>Times</FieldLabel>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={366}
                      value={form.count}
                      onChange={(event) =>
                        set("count", Number(event.target.value))
                      }
                    />
                  </Field>
                ) : (
                  <Field className="max-w-56">
                    <FieldLabel>Last date</FieldLabel>
                    <Input
                      type="date"
                      value={form.endDate}
                      onChange={(event) => set("endDate", event.target.value)}
                    />
                  </Field>
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
                  <Field>
                    <FieldLabel>Starts after (days)</FieldLabel>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={365}
                      value={form.startDays}
                      onChange={(event) =>
                        set("startDays", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Ends after (days)</FieldLabel>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={365}
                      value={form.endDays}
                      onChange={(event) =>
                        set("endDays", Number(event.target.value))
                      }
                    />
                  </Field>
                </div>
              </fieldset>
            ) : null}
            <section
              aria-labelledby={`${id}-preview`}
              className={cn(
                "flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface-alt p-3",
                // On the preset rows the preview lines up with their text.
                onPresets && "mx-1"
              )}
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
                    {describeScheduleRule(
                      parsed.data,
                      zone,
                      once?.ok ? once.offsetMinutes : null
                    )}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {future.length}{" "}
                    {future.length === 1 ? "publication" : "publications"} from
                    now
                    {expansion.skippedDates.length
                      ? ` · skipped months: ${expansion.skippedDates.join(", ")}`
                      : ""}
                    . Publishing starts at that time; if it cannot start within
                    5 minutes, the time is missed and nothing publishes late.
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
            <Button
              block={offerPresets}
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
