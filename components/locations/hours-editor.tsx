"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { DAY_LABELS } from "@/lib/locations/forms/hours"
import type { NormalizedHours } from "@/lib/api/location-hours"

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
  const [specialKeys, setSpecialKeys] = useState<readonly number[]>(() => value.special.map((_, i) => i))
  if (specialKeys.length !== value.special.length) {
    setSpecialKeys(value.special.map((_, i) => i))
  }
  function addSpecial() {
    setSpecialKeys((keys) => [...keys, (keys.length ? Math.max(...keys) : -1) + 1])
    setSpecial([...value.special, { effectiveDate: "", isClosed: true, opensAt: null, closesAt: null }])
  }
  function removeSpecial(index: number) {
    setSpecialKeys((keys) => keys.filter((_, i) => i !== index))
    setSpecial(value.special.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-ui font-semibold">Regular hours</h2>
        <ul className="flex flex-col gap-2">
          {value.regular.map((day, index) => (
            <li key={day.dayOfWeek} className="flex flex-wrap items-center gap-3 rounded-(--nr-radius-control) border border-border p-3">
              <span className="w-24 font-medium">{DAY_LABELS[day.dayOfWeek]}</span>
              <label className="flex items-center gap-2 text-ui">
                <Checkbox
                  checked={day.isClosed}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    setRegular(index, checked === true ? { ...day, isClosed: true, periods: [] } : { ...day, isClosed: false, periods: [{ opensAt: "09:00", closesAt: "17:00" }] })
                  }
                  aria-label={`${DAY_LABELS[day.dayOfWeek]} closed`}
                />
                Closed
              </label>
              {!day.isClosed
                ? day.periods.map((period, periodIndex) => (
                    <span key={periodIndex} className="flex items-center gap-2">
                      <Input
                        type="time"
                        aria-label={`${DAY_LABELS[day.dayOfWeek]} opens`}
                        value={period.opensAt}
                        disabled={disabled}
                        onChange={(event) =>
                          setRegular(index, { ...day, periods: day.periods.map((p, pi) => (pi === periodIndex ? { ...p, opensAt: event.target.value } : p)) })
                        }
                        className="w-28"
                      />
                      <span aria-hidden>–</span>
                      <Input
                        type="time"
                        aria-label={`${DAY_LABELS[day.dayOfWeek]} closes`}
                        value={period.closesAt}
                        disabled={disabled}
                        onChange={(event) =>
                          setRegular(index, { ...day, periods: day.periods.map((p, pi) => (pi === periodIndex ? { ...p, closesAt: event.target.value } : p)) })
                        }
                        className="w-28"
                      />
                      {!disabled ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove a period for ${DAY_LABELS[day.dayOfWeek]}`}
                          onClick={() => setRegular(index, { ...day, periods: day.periods.filter((_, pi) => pi !== periodIndex) })}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </span>
                  ))
                : null}
              {!day.isClosed && !disabled && day.periods.length < 3 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRegular(index, { ...day, periods: [...day.periods, { opensAt: "09:00", closesAt: "17:00" }] })}>
                  Add hours
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-ui font-semibold">Special hours</h2>
        <ul className="flex flex-col gap-2">
          {value.special.map((entry, index) => (
            <li key={specialKeys[index]} className="flex flex-wrap items-center gap-3 rounded-(--nr-radius-control) border border-border p-3">
              <Input
                type="date"
                aria-label={`Special date ${index + 1}`}
                value={entry.effectiveDate}
                disabled={disabled}
                onChange={(event) => setSpecial(value.special.map((s, i) => (i === index ? { ...s, effectiveDate: event.target.value } : s)))}
                className="w-40"
              />
              <label className="flex items-center gap-2 text-ui">
                <Checkbox
                  checked={entry.isClosed}
                  disabled={disabled}
                  aria-label={`Special date ${index + 1} closed`}
                  onCheckedChange={(checked) =>
                    setSpecial(value.special.map((s, i) => (i === index ? (checked === true ? { ...s, isClosed: true, opensAt: null, closesAt: null } : { ...s, isClosed: false, opensAt: "09:00", closesAt: "17:00" }) : s)))
                  }
                />
                Closed
              </label>
              {!entry.isClosed ? (
                <>
                  <Input type="time" aria-label={`Special date ${index + 1} opens`} value={entry.opensAt ?? ""} disabled={disabled} onChange={(event) => setSpecial(value.special.map((s, i) => (i === index ? { ...s, opensAt: event.target.value } : s)))} className="w-28" />
                  <span aria-hidden>–</span>
                  <Input type="time" aria-label={`Special date ${index + 1} closes`} value={entry.closesAt ?? ""} disabled={disabled} onChange={(event) => setSpecial(value.special.map((s, i) => (i === index ? { ...s, closesAt: event.target.value } : s)))} className="w-28" />
                </>
              ) : null}
              {!disabled ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeSpecial(index)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!disabled ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={addSpecial}>
            Add a special day
          </Button>
        ) : null}
      </section>
    </div>
  )
}
