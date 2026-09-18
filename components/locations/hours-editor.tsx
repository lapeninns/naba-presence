"use client"

import { Plus, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { DAY_LABELS } from "@/lib/locations/forms/hours"
import type { NormalizedHours } from "@/lib/api/location-hours"
import { cn } from "@/lib/utils"

/**
 * Time fields sit in a fixed-width slot with tabular figures so a column of
 * "09:00 – 17:00" lines up down the whole week.
 */
const TIME_CLASS = "w-26 tabular-nums"

/**
 * One row of the schedule: the day (or date) in a fixed column, the on/off
 * switch with its state word, then the periods. Rows sit on a white card and
 * are divided by hairlines, the way a grouped list is. Below `sm` the periods
 * drop under the day so nothing squeezes.
 */
function ScheduleRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <li
      className={cn(
        "grid min-h-(--np-row-h) grid-cols-[minmax(6rem,auto)_auto] items-center gap-x-4 gap-y-2 px-(--np-card-pad) py-2 sm:grid-cols-[6.5rem_auto_1fr]",
        className
      )}
    >
      {children}
    </li>
  )
}

function OpenSwitch({
  open,
  disabled,
  label,
  onChange,
}: {
  open: boolean
  disabled: boolean
  label: string
  onChange: (open: boolean) => void
}) {
  return (
    <span className="flex items-center gap-2">
      <Switch
        checked={open}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onChange}
      />
      <span className="w-12 text-ui text-ink-muted">
        {open ? "Open" : "Closed"}
      </span>
    </span>
  )
}

export function HoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: NormalizedHours
  onChange: (next: NormalizedHours) => void
  disabled: boolean
}) {
  function setRegular(index: number, day: NormalizedHours["regular"][number]) {
    const regular = value.regular.map((d, i) => (i === index ? day : d))
    onChange({ ...value, regular })
  }
  function setSpecial(next: NormalizedHours["special"]) {
    onChange({ ...value, special: next })
  }

  // Special-hours entries carry no stable id in the wire model, and two rows
  // can legitimately share the same effectiveDate through this same UI (e.g.
  // two overrides typed for the same holiday before either is corrected) —
  // so keying by effectiveDate alone collides, which both logs a React
  // duplicate-key warning and can steal focus from an unrelated row on an
  // unrelated add/remove. Track a synthetic, purely client-side key per row
  // instance instead: assigned once when a row is added, dropped when that
  // row is removed, and otherwise stable across edits to the row's own
  // fields, independent of its (possibly duplicate) effectiveDate. State
  // (not a ref) so the resync-on-mismatch below stays inside React's
  // documented "adjust state while rendering" pattern rather than mutating a
  // ref during render. Falls back to a fresh 1:1 assignment if
  // `value.special` is ever replaced wholesale from outside this component
  // (e.g. a different draft loading).
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
    <div className="flex flex-col gap-(--np-gap-section)">
      <section className="flex flex-col gap-2">
        {/* Flush with the panel's edge. The console has two kinds of line
            above a list and they are drawn differently: a grouped-list
            CAPTION (small, grey, `text-caption`) is inset to the card padding
            so it sits over the row content, the way iOS draws one; a section
            HEADING in the title role, like this one, sits flush, the way
            Industry, Visibility on Google and every Home section do. These
            were headings wearing the caption's inset, which left the Hours
            tab the one screen whose titles started on their own margin. */}
        <h3 className="text-title font-semibold text-ink">Regular hours</h3>
        <ul className="divide-y divide-line-subtle rounded-(--np-radius-card) bg-surface">
          {value.regular.map((day, index) => {
            const dayLabel = DAY_LABELS[day.dayOfWeek]
            return (
              <ScheduleRow key={day.dayOfWeek}>
                <span className="text-body font-medium text-ink">
                  {dayLabel}
                </span>
                <OpenSwitch
                  open={!day.isClosed}
                  disabled={disabled}
                  label={`${dayLabel} open`}
                  onChange={(open) =>
                    setRegular(
                      index,
                      open
                        ? {
                            ...day,
                            isClosed: false,
                            periods: [{ opensAt: "09:00", closesAt: "17:00" }],
                          }
                        : { ...day, isClosed: true, periods: [] }
                    )
                  }
                />
                {!day.isClosed ? (
                  <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-1">
                    {day.periods.map((period, periodIndex) => (
                      <span
                        key={periodIndex}
                        className="flex items-center gap-2"
                      >
                        <Input
                          type="time"
                          aria-label={`${dayLabel} opens`}
                          value={period.opensAt}
                          disabled={disabled}
                          onChange={(event) =>
                            setRegular(index, {
                              ...day,
                              periods: day.periods.map((p, pi) =>
                                pi === periodIndex
                                  ? { ...p, opensAt: event.target.value }
                                  : p
                              ),
                            })
                          }
                          className={TIME_CLASS}
                        />
                        <span aria-hidden className="text-ink-faint">
                          –
                        </span>
                        <Input
                          type="time"
                          aria-label={`${dayLabel} closes`}
                          value={period.closesAt}
                          disabled={disabled}
                          onChange={(event) =>
                            setRegular(index, {
                              ...day,
                              periods: day.periods.map((p, pi) =>
                                pi === periodIndex
                                  ? { ...p, closesAt: event.target.value }
                                  : p
                              ),
                            })
                          }
                          className={TIME_CLASS}
                        />
                        {!disabled ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove a period for ${dayLabel}`}
                            onClick={() =>
                              setRegular(index, {
                                ...day,
                                periods: day.periods.filter(
                                  (_, pi) => pi !== periodIndex
                                ),
                              })
                            }
                          >
                            <X strokeWidth={1.75} aria-hidden />
                          </Button>
                        ) : null}
                      </span>
                    ))}
                    {!disabled && day.periods.length < 3 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setRegular(index, {
                            ...day,
                            periods: [
                              ...day.periods,
                              { opensAt: "09:00", closesAt: "17:00" },
                            ],
                          })
                        }
                      >
                        <Plus strokeWidth={1.75} aria-hidden />
                        Add hours
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </ScheduleRow>
            )
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-title font-semibold text-ink">Special hours</h3>
        {value.special.length > 0 ? (
          <ul className="divide-y divide-line-subtle rounded-(--np-radius-card) bg-surface">
            {value.special.map((entry, index) => (
              <ScheduleRow
                key={specialKeys[index]}
                className="sm:grid-cols-[auto_auto_1fr]"
              >
                <Input
                  type="date"
                  aria-label={`Special date ${index + 1}`}
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
                  className="w-40 tabular-nums"
                />
                <OpenSwitch
                  open={!entry.isClosed}
                  disabled={disabled}
                  label={`Special date ${index + 1} open`}
                  onChange={(open) =>
                    setSpecial(
                      value.special.map((s, i) =>
                        i === index
                          ? open
                            ? {
                                ...s,
                                isClosed: false,
                                opensAt: "09:00",
                                closesAt: "17:00",
                              }
                            : {
                                ...s,
                                isClosed: true,
                                opensAt: null,
                                closesAt: null,
                              }
                          : s
                      )
                    )
                  }
                />
                <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-1">
                  {!entry.isClosed ? (
                    <span className="flex items-center gap-2">
                      <Input
                        type="time"
                        aria-label={`Special date ${index + 1} opens`}
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
                      <span aria-hidden className="text-ink-faint">
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
                    </span>
                  ) : null}
                  {!disabled ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="sm:ml-auto"
                      onClick={() => removeSpecial(index)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </span>
              </ScheduleRow>
            ))}
          </ul>
        ) : (
          <p className="text-ui text-ink-muted">
            No special days yet. Holidays and one-off closures go here.
          </p>
        )}
        {!disabled ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={addSpecial}
          >
            <Plus strokeWidth={1.75} aria-hidden />
            Add a special day
          </Button>
        ) : null}
      </section>
    </div>
  )
}
