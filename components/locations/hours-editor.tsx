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
import { Input } from "@/components/ui/input"
import { SectionHeader } from "@/components/ui/section-header"
import {
  segmentedItemClassName,
  segmentedThumbClassName,
  segmentedTrackClassName,
} from "@/components/ui/segmented-control"
import { Switch } from "@/components/ui/switch"
import type { NormalizedHours } from "@/lib/api/location-hours"
import {
  WEEK_ORDER,
  canSplit,
  dayOf,
  describeSpecialEntry,
  formatSpecialDate,
  hoursFieldId,
  sameDay,
  withSplitPeriod,
} from "@/lib/editors/hours-presentation"
import { DAY_LABELS } from "@/lib/locations/forms/hours"
import { describeDay } from "@/lib/locations/hours-diff"
import { cn } from "@/lib/utils"

type Day = NormalizedHours["regular"][number]

/** Time fields share one slot width with tabular figures, so a column lines up. */
const TIME_CLASS = "w-29 tabular-nums"

/** The reference `.changed-mark`: an info-ink word, never colour alone. */
function ChangedMark() {
  return (
    <span className="text-caption font-semibold text-info-ink">Changed</span>
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
}: {
  value: NormalizedHours
  onChange: (next: NormalizedHours) => void
  disabled: boolean
  /** What Google holds, for the per-day "Changed" marks. */
  google?: NormalizedHours
  errors?: Record<string, string>
}) {
  const headingId = useId()
  const specialHeadingId = useId()
  const [copyFrom, setCopyFrom] = useState<number | null>(null)

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
          title="Regular hours"
          description="Up to three periods a day, for a split between lunch and evening."
        />
        <ul className="@container/week divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
          {WEEK_ORDER.map((dayOfWeek) => {
            const day = dayOf(value, dayOfWeek)
            const label = DAY_LABELS[dayOfWeek]
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
                  "@[700px]/week:grid-cols-[7rem_8rem_minmax(0,1fr)_auto]",
                  changed && "shadow-[inset_3px_0_0_var(--np-info-solid)]"
                )}
              >
                <span className="flex min-h-(--np-control-h) flex-col justify-center">
                  <span className="text-body font-semibold text-ink">
                    {label}
                  </span>
                  {changed ? <ChangedMark /> : null}
                </span>

                <span className="flex min-h-(--np-control-h) items-center gap-2 justify-self-end @[700px]/week:justify-self-start">
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
                    onCheckedChange={(open) =>
                      setDay(
                        open
                          ? {
                              ...day,
                              isClosed: false,
                              periods: [
                                { opensAt: "09:00", closesAt: "17:00" },
                              ],
                            }
                          : { ...day, isClosed: true, periods: [] }
                      )
                    }
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
                      const message = errors[opensId]
                      const errorId = `${opensId}-error`
                      return (
                        <div
                          key={index}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <Input
                            id={opensId}
                            type="time"
                            aria-label={`${label} period ${index + 1} opens`}
                            aria-invalid={message ? true : undefined}
                            aria-describedby={message ? errorId : undefined}
                            value={period.opensAt}
                            disabled={disabled}
                            onChange={(event) =>
                              setDay({
                                ...day,
                                periods: day.periods.map((p, pi) =>
                                  pi === index
                                    ? { ...p, opensAt: event.target.value }
                                    : p
                                ),
                              })
                            }
                            className={TIME_CLASS}
                          />
                          <span aria-hidden className="text-ink-muted">
                            –
                          </span>
                          <Input
                            id={hoursFieldId.closes(dayOfWeek, index)}
                            type="time"
                            aria-label={`${label} period ${index + 1} closes`}
                            aria-invalid={message ? true : undefined}
                            aria-describedby={message ? errorId : undefined}
                            value={period.closesAt}
                            disabled={disabled}
                            onChange={(event) =>
                              setDay({
                                ...day,
                                periods: day.periods.map((p, pi) =>
                                  pi === index
                                    ? { ...p, closesAt: event.target.value }
                                    : p
                                ),
                              })
                            }
                            className={TIME_CLASS}
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
                  {!disabled && !day.isClosed && canSplit(day.periods) ? (
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ml-2.5"
                        onClick={() =>
                          setDay({
                            ...day,
                            periods: withSplitPeriod(day.periods),
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
            {value.special.map((entry, index) => {
              const dateId = hoursFieldId.specialDate(index)
              const opensId = hoursFieldId.specialOpens(index)
              const message = errors[dateId] ?? errors[opensId]
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
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3 @[520px]/special:grid-cols-[3.5rem_minmax(0,1fr)_auto]"
                >
                  <span
                    aria-hidden
                    className="w-14 overflow-hidden rounded-[10px] border border-line bg-surface text-center"
                  >
                    <span className="block bg-fill py-0.5 font-mono text-[10.5px] tracking-[0.06em] text-ink-secondary uppercase">
                      {validDate
                        ? date.toLocaleDateString("en-GB", { month: "short" })
                        : "Date"}
                    </span>
                    <span
                      className={cn(
                        "block font-mono text-[20px] leading-[30px] font-semibold tabular-nums",
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
                                ? { ...s, effectiveDate: event.target.value }
                                : s
                            )
                          )
                        }
                        className="w-42 tabular-nums"
                      />
                      <div
                        role="group"
                        aria-label={`Special date ${index + 1} hours`}
                        className={cn(segmentedTrackClassName, "w-auto")}
                      >
                        {(["closed", "custom"] as const).map((mode) => {
                          const pressed =
                            mode === "closed" ? entry.isClosed : !entry.isClosed
                          return (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={pressed}
                              disabled={disabled}
                              className={cn(
                                segmentedItemClassName,
                                "flex-none disabled:opacity-50",
                                pressed && segmentedThumbClassName
                              )}
                              onClick={() =>
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
                                            opensAt: s.opensAt ?? "09:00",
                                            closesAt: s.closesAt ?? "17:00",
                                          }
                                  )
                                )
                              }
                            >
                              {mode === "closed" ? "Closed" : "Custom hours"}
                            </button>
                          )
                        })}
                      </div>
                      {changed ? <ChangedMark /> : null}
                    </div>

                    {!entry.isClosed ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id={opensId}
                          type="time"
                          aria-label={`Special date ${index + 1} opens`}
                          aria-invalid={errors[opensId] ? true : undefined}
                          aria-describedby={message ? errorId : undefined}
                          value={entry.opensAt ?? ""}
                          disabled={disabled}
                          onChange={(event) =>
                            setSpecial(
                              value.special.map((s, i) =>
                                i === index
                                  ? { ...s, opensAt: event.target.value }
                                  : s
                              )
                            )
                          }
                          className={TIME_CLASS}
                        />
                        <span aria-hidden className="text-ink-muted">
                          –
                        </span>
                        <Input
                          type="time"
                          aria-label={`Special date ${index + 1} closes`}
                          value={entry.closesAt ?? ""}
                          disabled={disabled}
                          onChange={(event) =>
                            setSpecial(
                              value.special.map((s, i) =>
                                i === index
                                  ? { ...s, closesAt: event.target.value }
                                  : s
                              )
                            )
                          }
                          className={TIME_CLASS}
                        />
                      </div>
                    ) : null}

                    <span className="text-caption text-ink-muted">
                      {entry.effectiveDate
                        ? `${formatSpecialDate(entry.effectiveDate)}${entry.isClosed ? " · closed all day" : ""}`
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
                    periods: source.periods.map((p) => ({ ...p })),
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
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
          <fieldset className="grid gap-2.5 sm:grid-cols-2">
            <legend className="mb-2 text-ui font-semibold text-ink">
              Copy to
            </legend>
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
          </fieldset>
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
