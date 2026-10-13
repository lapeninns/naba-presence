"use client"

import { CalendarPlus, CircleAlert, Copy, Plus, Trash2, X } from "lucide-react"
import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset"
import { Input } from "@/components/ui/input"
import { SectionHeader } from "@/components/ui/section-header"
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
import { Switch } from "@/components/ui/switch"
import { TimeField } from "@/components/ui/time-field"
import type { NormalizedHours } from "@/lib/api/location-hours"
import {
  WEEK_ORDER,
  canSplit,
  closingDayOptions,
  dayOf,
  describeSpecialEntry,
  formatSpecialDate,
  hoursFieldId as baseHoursFieldId,
  sameDay,
  withSplitPeriod,
} from "@/lib/editors/hours-presentation"
import { DAY_LABELS } from "@/lib/locations/forms/hours"
import { describeDay, serviceWeek } from "@/lib/locations/hours-diff"
import { cn } from "@/lib/utils"

type Day = NormalizedHours["regular"][number]

/** Today as YYYY-MM-DD in the browser's own calendar, for "past" marks. */
function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Special days in date order, as indexes into the unsorted list (field ids
 * and validation messages are keyed by that index). Rows still being given
 * a date stay at the end, in the order they were added.
 */
function specialOrder(special: NormalizedHours["special"]): number[] {
  return special
    .map((entry, index) => ({ date: entry.effectiveDate, index }))
    .sort((a, b) => {
      if (!a.date || !b.date)
        return !a.date && !b.date ? a.index - b.index : a.date ? -1 : 1
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index
    })
    .map(({ index }) => index)
}

/** The reference `.changed-mark`: an info-ink word, never colour alone. */
function ChangedMark() {
  return (
    <span className="text-caption font-semibold text-info-ink">Changed</span>
  )
}

/**
 * Which day an opening period closes on. The pop-up button (a bottom action
 * sheet on a phone) rather than a native select with copied chrome. `null`
 * is "not chosen yet": an overnight period with no stored closing day, which
 * the validator asks about instead of guessing.
 */
function ClosingDaySelect({
  id,
  label,
  dayOfWeek,
  value,
  onValueChange,
  invalid,
  describedBy,
  disabled,
}: {
  id: string
  label: string
  dayOfWeek: number
  value: string | null
  onValueChange: (closeDayOfWeek: number) => void
  invalid: boolean
  describedBy?: string
  disabled: boolean
}) {
  const options = closingDayOptions(dayOfWeek)
  return (
    <Select<string>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(Number(next))
      }}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="max-w-full min-w-44"
      >
        <SelectValue placeholder="Choose closing day" />
      </SelectTrigger>
      <SelectContent title="Closes on">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FieldProblem({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p
      id={id}
      className="flex basis-full items-start gap-1.5 text-caption text-danger-ink"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  )
}

/**
 * The weekly schedule and its special days (reference listing-hours).
 *
 * Regular hours are one bordered card with a row per day, Monday first. On a
 * wide container a row is a grid — day, open switch, periods, "Copy to…";
 * under 700px of its own width it becomes a per-day block with the switch
 * beside the day name and the periods underneath, so nothing squeezes on a
 * phone. A day that differs from Google carries a "Changed" word and an
 * info-coloured inset edge.
 *
 * Special days are cards with a calendar badge, the date, a Closed / Custom
 * hours choice and the times.
 *
 * `errors` maps field ids (see `hoursFieldId`) to messages; each message is
 * drawn under its field and wired with `aria-describedby`/`aria-invalid`, and
 * the tab lists the same messages in a validation summary that links here.
 */
export function HoursEditor({
  value,
  onChange,
  disabled,
  google,
  errors = {},
  supportedHoursTypes = [],
  scheduleName = "Regular hours",
  serviceId,
  weeklyOnly = false,
}: {
  value: NormalizedHours
  onChange: (next: NormalizedHours) => void
  disabled: boolean
  /** What Google holds, for the per-day "Changed" marks. */
  google?: NormalizedHours
  errors?: Record<string, string>
  supportedHoursTypes?: ReadonlyArray<{
    hoursTypeId: string
    displayName: string
  }>
  scheduleName?: string
  serviceId?: string
  weeklyOnly?: boolean
}) {
  const fieldId = (id: string) =>
    serviceId ? `service-${encodeURIComponent(serviceId)}-${id}` : id
  const hoursFieldId = {
    ...baseHoursFieldId,
    dayOpen: (day: number) => fieldId(baseHoursFieldId.dayOpen(day)),
    opens: (day: number, index: number) =>
      fieldId(baseHoursFieldId.opens(day, index)),
    closes: (day: number, index: number) =>
      fieldId(baseHoursFieldId.closes(day, index)),
    ends: (day: number, index: number) =>
      fieldId(baseHoursFieldId.ends(day, index)),
  }
  const [addType, setAddType] = useState("")
  // Services Google supports here that have no schedule yet.
  const addableTypes = supportedHoursTypes.filter(
    (type) =>
      !value.moreHours.some((entry) => entry.hoursTypeId === type.hoursTypeId)
  )
  const [removeType, setRemoveType] = useState<string | null>(null)
  const headingId = useId()
  const specialHeadingId = useId()
  const [copyFrom, setCopyFrom] = useState<number | null>(null)
  // The periods a day had when it was switched off, so switching it back on
  // brings them back instead of resetting to 09:00–17:00.
  const [closedPeriods, setClosedPeriods] = useState<
    Record<number, Day["periods"]>
  >({})
  const today = localToday()

  function setDay(next: Day) {
    const regular = value.regular.map((day) =>
      day.dayOfWeek === next.dayOfWeek ? next : day
    )
    onChange({ ...value, regular })
  }
  function setSpecial(next: NormalizedHours["special"]) {
    onChange({ ...value, special: next })
  }

  // Special-hours entries carry no stable id in the wire model, and two rows
  // can legitimately share an effectiveDate while being typed, so keying by
  // date collides (a React duplicate-key warning, and focus jumping to an
  // unrelated row on add/remove). A synthetic client-side key per row
  // instance is assigned when a row is added and dropped when it is
  // removed; it resyncs 1:1 if `value.special` is replaced from outside.
  const [specialKeys, setSpecialKeys] = useState<readonly number[]>(() =>
    value.special.map((_, i) => i)
  )
  if (specialKeys.length !== value.special.length) {
    setSpecialKeys(value.special.map((_, i) => i))
  }
  function addSpecial() {
    setSpecialKeys((keys) => [
      ...keys,
      (keys.length ? Math.max(...keys) : -1) + 1,
    ])
    setSpecial([
      ...value.special,
      { effectiveDate: "", isClosed: true, opensAt: null, closesAt: null },
    ])
  }
  function removeSpecial(index: number) {
    setSpecialKeys((keys) => keys.filter((_, i) => i !== index))
    setSpecial(value.special.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
        <SectionHeader
          id={headingId}
          title={scheduleName}
          description="Use 24-hour times. Choose the closing day explicitly for overnight hours; 24:00 means midnight at the end of that day."
        />
        <ul className="@container/week divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
          {WEEK_ORDER.map((dayOfWeek) => {
            const day = dayOf(value, dayOfWeek)
            const label = serviceId
              ? `${scheduleName} ${DAY_LABELS[dayOfWeek]}`
              : DAY_LABELS[dayOfWeek]
            const changed = google
              ? !sameDay(day, dayOf(google, dayOfWeek))
              : false
            const dayError = errors[hoursFieldId.dayOpen(dayOfWeek)]
            return (
              <li
                key={dayOfWeek}
                data-day={dayOfWeek}
                data-changed={changed || undefined}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-4 py-3",
                  "@[700px]/week:grid-cols-[auto_auto_minmax(0,1fr)_auto]",
                  changed && "bg-fill"
                )}
              >
                <span className="flex min-h-(--np-control-h) flex-col justify-center @[700px]/week:w-28">
                  <span className="text-body font-semibold text-ink">
                    {label}
                  </span>
                  {changed ? <ChangedMark /> : null}
                </span>

                <span className="flex min-h-(--np-control-h) items-center gap-2 justify-self-end @[700px]/week:w-32 @[700px]/week:justify-self-start">
                  <Switch
                    id={hoursFieldId.dayOpen(dayOfWeek)}
                    checked={!day.isClosed}
                    disabled={disabled}
                    aria-label={`${label} open`}
                    aria-invalid={dayError ? true : undefined}
                    aria-describedby={
                      dayError
                        ? `${hoursFieldId.dayOpen(dayOfWeek)}-error`
                        : undefined
                    }
                    onCheckedChange={(open) => {
                      if (open) {
                        const remembered = closedPeriods[dayOfWeek]
                        setDay({
                          ...day,
                          isClosed: false,
                          periods:
                            remembered && remembered.length > 0
                              ? remembered.map((p) => ({ ...p }))
                              : [
                                  {
                                    opensAt: "09:00",
                                    closesAt: "17:00",
                                    closeDayOfWeek: dayOfWeek,
                                  },
                                ],
                        })
                      } else {
                        if (day.periods.length > 0)
                          setClosedPeriods((all) => ({
                            ...all,
                            [dayOfWeek]: day.periods,
                          }))
                        setDay({ ...day, isClosed: true, periods: [] })
                      }
                    }}
                  />
                  <span aria-hidden className="w-13 text-ui text-ink-muted">
                    {day.isClosed ? "Closed" : "Open"}
                  </span>
                </span>

                <div className="col-span-2 flex min-w-0 flex-col gap-2 @[700px]/week:col-span-1">
                  {day.isClosed ? (
                    <span className="flex min-h-(--np-control-h) items-center text-ui text-ink-muted">
                      Closed all day
                    </span>
                  ) : (
                    day.periods.map((period, index) => {
                      const opensId = hoursFieldId.opens(dayOfWeek, index)
                      const message =
                        errors[opensId] ??
                        errors[hoursFieldId.ends(dayOfWeek, index)]
                      const errorId = `${opensId}-error`
                      return (
                        <div
                          key={index}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <TimeField
                            id={opensId}
                            aria-label={`${label} period ${index + 1} opens`}
                            aria-invalid={message ? true : undefined}
                            aria-describedby={message ? errorId : undefined}
                            value={period.opensAt}
                            disabled={disabled}
                            onValueChange={(opensAt) =>
                              setDay({
                                ...day,
                                periods: day.periods.map((p, pi) =>
                                  pi === index ? { ...p, opensAt } : p
                                ),
                              })
                            }
                          />
                          <span aria-hidden className="text-ink-muted">
                            –
                          </span>
                          <TimeField
                            id={hoursFieldId.closes(dayOfWeek, index)}
                            aria-label={`${label} period ${index + 1} closes`}
                            aria-invalid={message ? true : undefined}
                            aria-describedby={message ? errorId : undefined}
                            value={period.closesAt}
                            disabled={disabled}
                            onValueChange={(closesAt) =>
                              setDay({
                                ...day,
                                periods: day.periods.map((p, pi) =>
                                  pi === index ? { ...p, closesAt } : p
                                ),
                              })
                            }
                          />
                          <ClosingDaySelect
                            id={hoursFieldId.ends(dayOfWeek, index)}
                            label={`${label} period ${index + 1} closing day`}
                            dayOfWeek={dayOfWeek}
                            invalid={Boolean(message)}
                            describedBy={message ? errorId : undefined}
                            disabled={disabled}
                            value={
                              period.closeDayOfWeek === undefined &&
                              period.closesAt <= period.opensAt
                                ? null
                                : String(period.closeDayOfWeek ?? dayOfWeek)
                            }
                            onValueChange={(closeDayOfWeek) =>
                              setDay({
                                ...day,
                                periods: day.periods.map((p, pi) =>
                                  pi === index ? { ...p, closeDayOfWeek } : p
                                ),
                              })
                            }
                          />
                          {!disabled && day.periods.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${label} period ${index + 1}`}
                              onClick={() =>
                                setDay({
                                  ...day,
                                  periods: day.periods.filter(
                                    (_, pi) => pi !== index
                                  ),
                                })
                              }
                            >
                              <X aria-hidden />
                            </Button>
                          ) : null}
                          <FieldProblem id={errorId} message={message} />
                        </div>
                      )
                    })
                  )}
                  <FieldProblem
                    id={`${hoursFieldId.dayOpen(dayOfWeek)}-error`}
                    message={dayError}
                  />
                  {!disabled &&
                  !day.isClosed &&
                  canSplit(day.periods, dayOfWeek) ? (
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ml-2.5"
                        onClick={() =>
                          setDay({
                            ...day,
                            periods: withSplitPeriod(day.periods, dayOfWeek),
                          })
                        }
                      >
                        <Plus aria-hidden />
                        Add split period
                      </Button>
                    </div>
                  ) : null}
                </div>

                {!disabled ? (
                  <div className="col-span-2 flex items-center @[700px]/week:col-span-1 @[700px]/week:min-h-(--np-control-h) @[700px]/week:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2.5 @[700px]/week:ml-0"
                      aria-label={`Copy ${label}’s hours to other days`}
                      onClick={() => setCopyFrom(dayOfWeek)}
                    >
                      <Copy aria-hidden />
                      Copy to…
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      {!weeklyOnly ? (
        <section aria-label="Service hours" className="flex flex-col gap-4">
          <SectionHeader
            title="Service hours"
            description="Separate schedules for the services this listing supports. Special dates below apply to the venue, not individual services."
          />
          {value.moreHours.length === 0 ? (
            <p className="text-ui text-ink-muted">
              No service schedules are saved.
            </p>
          ) : null}
          {value.moreHours.map((entry) => {
            const metadata = supportedHoursTypes.find(
              (type) => type.hoursTypeId === entry.hoursTypeId
            )
            const observed = google?.moreHours.find(
              (other) => other.hoursTypeId === entry.hoursTypeId
            )
            return (
              <div key={entry.hoursTypeId} className="flex flex-col gap-2">
                <HoursEditor
                  value={{
                    regular: serviceWeek(entry),
                    special: [],
                    moreHours: [],
                  }}
                  google={
                    observed
                      ? {
                          regular: serviceWeek(observed),
                          special: [],
                          moreHours: [],
                        }
                      : undefined
                  }
                  onChange={(next) =>
                    onChange({
                      ...value,
                      moreHours: value.moreHours.map((other) =>
                        other.hoursTypeId === entry.hoursTypeId
                          ? {
                              ...other,
                              periods: next.regular.flatMap((day) =>
                                day.periods.map((period) => ({
                                  ...period,
                                  dayOfWeek: day.dayOfWeek,
                                }))
                              ),
                            }
                          : other
                      ),
                    })
                  }
                  disabled={disabled || !metadata}
                  errors={errors}
                  weeklyOnly
                  serviceId={entry.hoursTypeId}
                  scheduleName={metadata?.displayName ?? entry.hoursTypeId}
                />
                <p className="text-caption text-ink-muted">
                  {entry.hoursTypeId}
                  {metadata
                    ? ""
                    : " · Google has not confirmed this service type. Its saved schedule is preserved and shown read-only."}
                </p>
                {!disabled && metadata ? (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoveType(entry.hoursTypeId)}
                    >
                      <Trash2 aria-hidden />
                      Remove {metadata.displayName} schedule
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
          {!disabled && addableTypes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select<string>
                value={addType || null}
                onValueChange={(next) => setAddType(next ?? "")}
                items={addableTypes.map((type) => ({
                  value: type.hoursTypeId,
                  label: type.displayName,
                }))}
              >
                <SelectTrigger
                  aria-label="Service schedule to add"
                  className="max-w-full min-w-48"
                >
                  <SelectValue placeholder="Choose a service" />
                </SelectTrigger>
                <SelectContent title="Service schedule to add">
                  {addableTypes.map((type) => (
                    <SelectItem key={type.hoursTypeId} value={type.hoursTypeId}>
                      {type.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!addType}
                onClick={() => {
                  if (
                    !supportedHoursTypes.some(
                      (type) => type.hoursTypeId === addType
                    )
                  )
                    return
                  onChange({
                    ...value,
                    moreHours: [
                      ...value.moreHours,
                      { hoursTypeId: addType, periods: [] },
                    ].sort((left, right) =>
                      left.hoursTypeId.localeCompare(right.hoursTypeId)
                    ),
                  })
                  setAddType("")
                }}
              >
                <Plus aria-hidden />
                Add service schedule
              </Button>
            </div>
          ) : null}
          <Dialog
            open={removeType !== null}
            onOpenChange={(open) => !open && setRemoveType(null)}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove service schedule?</DialogTitle>
                <DialogDescription>
                  Remove{" "}
                  {supportedHoursTypes.find(
                    (type) => type.hoursTypeId === removeType
                  )?.displayName ?? removeType}{" "}
                  from this draft. Review and publish to remove it from Google.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRemoveType(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onChange({
                      ...value,
                      moreHours: value.moreHours.filter(
                        (entry) => entry.hoursTypeId !== removeType
                      ),
                    })
                    setRemoveType(null)
                  }}
                >
                  Remove schedule from draft
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      ) : null}

      {!weeklyOnly ? (
        <section
          aria-labelledby={specialHeadingId}
          className="@container/special flex flex-col gap-2.5"
        >
          <SectionHeader
            id={specialHeadingId}
            title="Special hours"
            description="Bank holidays, Christmas and one-off closures. These override the regular week on that date."
          />
          {value.special.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {specialOrder(value.special).map((index) => {
                const entry = value.special[index]!
                const dateId = hoursFieldId.specialDate(index)
                const opensId = hoursFieldId.specialOpens(index)
                const closesId = hoursFieldId.specialCloses(index)
                const message =
                  errors[dateId] ??
                  errors[closesId] ??
                  errors[opensId] ??
                  errors[hoursFieldId.specialEnd(index)]
                const past = Boolean(
                  entry.effectiveDate && entry.effectiveDate < today
                )
                const errorId = `special-${index}-error`
                const googleEntry = google?.special.find(
                  (other) => other.effectiveDate === entry.effectiveDate
                )
                const changed = google
                  ? !googleEntry ||
                    describeSpecialEntry(googleEntry) !==
                      describeSpecialEntry(entry)
                  : false
                const date = entry.effectiveDate
                  ? new Date(`${entry.effectiveDate}T12:00:00`)
                  : null
                const validDate = date && !Number.isNaN(date.getTime())
                return (
                  <li
                    key={specialKeys[index]}
                    data-past={past || undefined}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3 @[520px]/special:grid-cols-[auto_minmax(0,1fr)_auto]"
                  >
                    <span
                      aria-hidden
                      className="w-14 overflow-hidden rounded-(--np-radius-control) border border-line bg-surface text-center"
                    >
                      <span className="block bg-fill py-0.5 font-mono text-caption tracking-wide text-ink-secondary uppercase">
                        {validDate
                          ? date.toLocaleDateString("en-GB", { month: "short" })
                          : "Date"}
                      </span>
                      <span
                        className={cn(
                          "block py-0.5 font-mono text-section font-semibold tabular-nums",
                          !validDate && "text-ink-muted"
                        )}
                      >
                        {validDate ? date.getDate() : "–"}
                      </span>
                    </span>

                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Input
                          id={dateId}
                          type="date"
                          aria-label={`Special date ${index + 1}`}
                          aria-invalid={errors[dateId] ? true : undefined}
                          aria-describedby={message ? errorId : undefined}
                          value={entry.effectiveDate}
                          disabled={disabled}
                          onChange={(event) =>
                            setSpecial(
                              value.special.map((s, i) =>
                                i === index
                                  ? {
                                      ...s,
                                      effectiveDate: event.target.value,
                                      ...(s.endDate === s.effectiveDate
                                        ? { endDate: event.target.value }
                                        : {}),
                                    }
                                  : s
                              )
                            )
                          }
                          className="w-42 tabular-nums"
                        />
                        <SegmentedControl
                          semantics="radio"
                          fill={false}
                          aria-label={`Special date ${index + 1} hours`}
                          value={entry.isClosed ? "closed" : "custom"}
                          disabled={disabled}
                          onValueChange={(mode) =>
                            setSpecial(
                              value.special.map((s, i) =>
                                i !== index
                                  ? s
                                  : mode === "closed"
                                    ? {
                                        ...s,
                                        isClosed: true,
                                        opensAt: null,
                                        closesAt: null,
                                      }
                                    : {
                                        ...s,
                                        isClosed: false,
                                        endDate: s.endDate ?? s.effectiveDate,
                                        opensAt: s.opensAt ?? "09:00",
                                        closesAt: s.closesAt ?? "17:00",
                                      }
                              )
                            )
                          }
                        >
                          <SegmentedControlItem value="closed">
                            Closed
                          </SegmentedControlItem>
                          <SegmentedControlItem value="custom">
                            Custom hours
                          </SegmentedControlItem>
                        </SegmentedControl>
                        {changed ? <ChangedMark /> : null}
                        {past ? (
                          <span className="rounded-(--np-radius-tag) bg-fill px-1.5 text-caption font-semibold text-ink-secondary">
                            Past
                          </span>
                        ) : null}
                      </div>

                      {!entry.isClosed ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <TimeField
                            id={opensId}
                            aria-label={`Special date ${index + 1} opens`}
                            aria-invalid={errors[opensId] ? true : undefined}
                            aria-describedby={message ? errorId : undefined}
                            value={entry.opensAt ?? ""}
                            disabled={disabled}
                            onValueChange={(opensAt) =>
                              setSpecial(
                                value.special.map((s, i) =>
                                  i === index ? { ...s, opensAt } : s
                                )
                              )
                            }
                          />
                          <span aria-hidden className="text-ink-muted">
                            –
                          </span>
                          <TimeField
                            id={closesId}
                            aria-label={`Special date ${index + 1} closes`}
                            aria-invalid={
                              errors[closesId] || errors[opensId]
                                ? true
                                : undefined
                            }
                            aria-describedby={message ? errorId : undefined}
                            value={entry.closesAt ?? ""}
                            disabled={disabled}
                            onValueChange={(closesAt) =>
                              setSpecial(
                                value.special.map((s, i) =>
                                  i === index ? { ...s, closesAt } : s
                                )
                              )
                            }
                          />
                          <Input
                            id={hoursFieldId.specialEnd(index)}
                            type="date"
                            aria-label={`Special date ${index + 1} closing date`}
                            aria-invalid={
                              errors[hoursFieldId.specialEnd(index)]
                                ? true
                                : undefined
                            }
                            aria-describedby={message ? errorId : undefined}
                            value={entry.endDate ?? entry.effectiveDate}
                            disabled={disabled}
                            className="w-42 tabular-nums"
                            onChange={(event) =>
                              setSpecial(
                                value.special.map((s, i) =>
                                  i === index
                                    ? { ...s, endDate: event.target.value }
                                    : s
                                )
                              )
                            }
                          />
                        </div>
                      ) : null}

                      <span className="text-caption text-ink-muted">
                        {entry.effectiveDate
                          ? `${formatSpecialDate(entry.effectiveDate)}${entry.isClosed ? " · closed all day" : ""}${past ? " · already passed, so customers no longer see it" : ""}`
                          : "Choose the date this applies to."}
                      </span>
                      <FieldProblem id={errorId} message={message} />
                    </div>

                    {!disabled ? (
                      <div className="col-span-2 @[520px]/special:col-span-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2.5 @[520px]/special:ml-0"
                          onClick={() => removeSpecial(index)}
                        >
                          <Trash2 aria-hidden />
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-(--np-radius-card) border border-line bg-surface-alt px-4 py-3 text-caption text-ink-muted">
              No special days yet. Holidays and one-off closures go here.
            </p>
          )}
          {!disabled ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addSpecial}
              >
                <CalendarPlus aria-hidden />
                Add a special day
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <CopyDaysDialog
        from={copyFrom}
        value={value}
        onClose={() => setCopyFrom(null)}
        onApply={(targets) => {
          if (copyFrom === null) return
          const source = dayOf(value, copyFrom)
          onChange({
            ...value,
            regular: value.regular.map((day) =>
              targets.includes(day.dayOfWeek)
                ? {
                    dayOfWeek: day.dayOfWeek,
                    isClosed: source.isClosed,
                    periods: source.periods.map((p) => ({
                      ...p,
                      ...(p.closeDayOfWeek === undefined
                        ? {}
                        : {
                            closeDayOfWeek:
                              (day.dayOfWeek +
                                ((p.closeDayOfWeek - source.dayOfWeek + 7) %
                                  7)) %
                              7,
                          }),
                    })),
                  }
                : day
            ),
          })
          setCopyFrom(null)
        }}
      />
    </div>
  )
}

const QUICK_PICKS: { label: string; days: readonly number[] }[] = [
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekend", days: [6, 0] },
  { label: "Every day", days: WEEK_ORDER },
]

/** Copy one day's hours onto others. Local only: nothing reaches Google. */
function CopyDaysDialog({
  from,
  value,
  onClose,
  onApply,
}: {
  from: number | null
  value: NormalizedHours
  onClose: () => void
  onApply: (targets: number[]) => void
}) {
  const [picked, setPicked] = useState<number[]>([])
  const [shownFor, setShownFor] = useState<number | null>(from)
  if (from !== shownFor) {
    setShownFor(from)
    setPicked([])
  }
  const open = from !== null
  const label = from !== null ? DAY_LABELS[from] : ""
  const others = WEEK_ORDER.filter((day) => day !== from)

  return (
    // A sheet on a phone (the Dialog default). Ticked days are input, so a
    // stray swipe or scrim tap asks before throwing them away.
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      dirty={picked.length > 0}
      discardPrompt={{
        title: "Stop copying?",
        description: "No days are changed.",
        confirmLabel: "Stop copying",
        cancelLabel: "Keep choosing",
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy {label}’s hours</DialogTitle>
          <DialogDescription>
            {from !== null ? describeDay(dayOf(value, from)) : ""}. Choose the
            days that should match.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PICKS.map((pick) => (
              <Button
                key={pick.label}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPicked(pick.days.filter((day) => day !== from))
                }
              >
                {pick.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPicked([])}
            >
              Clear
            </Button>
          </div>
          <Fieldset>
            <FieldsetLegend>Copy to</FieldsetLegend>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {others.map((day) => (
                <Checkbox
                  key={day}
                  checked={picked.includes(day)}
                  onCheckedChange={(checked) =>
                    setPicked((current) =>
                      checked
                        ? [...current, day]
                        : current.filter((other) => other !== day)
                    )
                  }
                  label={DAY_LABELS[day]}
                  description={`Now: ${describeDay(dayOf(value, day))}`}
                  labelClassName="text-ui"
                />
              ))}
            </div>
          </Fieldset>
          <p className="text-caption text-ink-muted">
            This replaces the hours on the days you tick. Nothing reaches Google
            until you publish.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={picked.length === 0}
            onClick={() => onApply(picked)}
          >
            {picked.length === 0
              ? "Copy"
              : `Copy to ${picked.length} ${picked.length === 1 ? "day" : "days"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
