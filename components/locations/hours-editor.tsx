"use client"

import { CalendarPlus, CircleAlert, Copy, Plus, Trash2, X } from "lucide-react"
import { useId, useImperativeHandle, useRef, useState, type Ref } from "react"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { ListRow } from "@/components/ui/list-row"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
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
import {
  SettingsGroup,
  SettingsGroupAction,
} from "@/components/ui/settings-row"
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

/**
 * Today as YYYY-MM-DD, for "past" marks: on the listing's clock when its
 * IANA zone is known (a special day ends at the venue's midnight, and the
 * server-rendered editor and the hydrating browser then agree on the date),
 * else in the browser's own calendar.
 */
function localToday(timeZone?: string): string {
  const now = new Date()
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now)
    } catch {
      // An unknown zone falls back to the browser's calendar.
    }
  }
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

/**
 * The "Changed" word on a special-day row, drawn as SettingsRow draws its
 * `changed` word on the day rows: a word, never colour alone.
 */
function ChangedMark() {
  return (
    <span className="shrink-0 text-caption font-medium text-accent-ink">
      Changed
    </span>
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

/** "12:00 – 16:00" or "Closed": a special day's hours as one value. */
function specialSummary(entry: NormalizedHours["special"][number]): string {
  if (entry.isClosed) return "Closed"
  const range = `${entry.opensAt || "--:--"} – ${entry.closesAt || "--:--"}`
  const end = entry.endDate ?? entry.effectiveDate
  return end && end !== entry.effectiveDate
    ? `${range}, closing ${formatSpecialDate(end)}`
    : range
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

/** Waits (a few frames at most) until the element with `id` is in the page. */
function untilMounted(id: string): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0
    const next = (look: () => void) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(look)
        : setTimeout(look, 16)
    const look = () => {
      if (document.getElementById(id) || frames++ > 30) resolve()
      else next(look)
    }
    next(look)
  })
}

/** Which special day (by its index) a field id belongs to, if any. */
function specialIndexOf(fieldId: string): number | null {
  const match = /^special-(\d+)-/.exec(fieldId)
  return match ? Number(match[1]) : null
}

/** A field id as one schedule scopes it (a service's ids carry its type). */
function scopedId(serviceId: string | undefined, id: string): string {
  return serviceId ? `service-${encodeURIComponent(serviceId)}-${id}` : id
}

/** Which weekday a regular-hours field id belongs to, if any. */
function dayIndexOf(fieldId: string, serviceId?: string): number | null {
  const prefix = serviceId ? `service-${encodeURIComponent(serviceId)}-` : ""
  if (!fieldId.startsWith(prefix)) return null
  const match = /^hours-(\d)-/.exec(fieldId.slice(prefix.length))
  return match ? Number(match[1]) : null
}

/** The first problem with any period of a day, shown on the day's row. */
function dayFieldProblem(
  errors: Record<string, string>,
  ids: typeof baseHoursFieldId,
  dayOfWeek: number,
  periods: number
): string | undefined {
  for (let index = 0; index < periods; index++) {
    const message =
      errors[ids.opens(dayOfWeek, index)] ??
      errors[ids.closes(dayOfWeek, index)] ??
      errors[ids.ends(dayOfWeek, index)]
    if (message) return message
  }
  return undefined
}

/**
 * What the hours tab's validation summary calls before it moves focus: a
 * special day's fields live in that day's sheet, so the sheet opens first.
 */
export type HoursEditorHandle = {
  /** Opens whatever holds `fieldId`; resolves once the field is mounted. */
  reveal: (fieldId: string) => Promise<void>
}

/**
 * Phone rows bleed 8px into the page padding so a changed row's tint has
 * room around its words; the desk card puts them back inside its border.
 */
const rowBleedClassName = "-mx-2 w-auto px-2"

/**
 * The weekly schedule and its special days (reference listing-hours).
 *
 * Laid out as settings groups (`SettingsGroup`, a bordered card on the
 * desk): regular hours are one group with one compact row per day, Monday
 * first: the day's name over its hours ("09:00 – 17:00", "Closed"), a
 * "Changed" word and fill tint when it differs from Google, and the open
 * switch beside the row. A row opens that day's sheet, which holds the
 * times, closing day, split period and "Copy to…"; one "Copy Monday to…"
 * action sits at the top of the group. A day's problem shows on its row.
 *
 * Special days are list rows in one group: the date and its hours as a
 * summary ("Thu 25 Dec 2026 · Closed", with "Changed" and "Past" words, and
 * any problem in words under it). A row opens that day's sheet, which holds
 * its fields; edits go straight into the draft, as they always did, so
 * closing the sheet throws nothing away. The validation summary reaches a
 * field in a closed sheet through `reveal` (see `HoursEditorHandle`).
 *
 * `errors` maps field ids (see `hoursFieldId`) to messages; each message is
 * drawn under its field and wired with `aria-describedby`/`aria-invalid`, and
 * the tab lists the same messages in a validation summary that links here.
 */
export function HoursEditor({
  ref,
  value,
  onChange,
  disabled,
  google,
  errors = {},
  supportedHoursTypes = [],
  scheduleName = "Regular hours",
  serviceId,
  weeklyOnly = false,
  timeZone,
  serviceNote,
}: {
  ref?: Ref<HoursEditorHandle>
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
  /** The listing's IANA zone, for which special days have passed. */
  timeZone?: string
  /** A plain-words note about the service options, shown with the services. */
  serviceNote?: string | null
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
  const [addOpen, setAddOpen] = useState(false)
  // Services Google supports here that have no schedule yet.
  const addableTypes = supportedHoursTypes.filter(
    (type) =>
      !value.moreHours.some((entry) => entry.hoursTypeId === type.hoursTypeId)
  )
  const [removeType, setRemoveType] = useState<string | null>(null)
  const headingId = useId()
  const specialHeadingId = useId()
  // A special day's row, by its stable key, for focus to return to.
  const specialRowPrefix = useId()
  const specialRowId = (key: number) => `${specialRowPrefix}special-row-${key}`
  const [copyFrom, setCopyFrom] = useState<number | null>(null)
  // The nested editors of the service schedules, to reveal a field in one.
  const serviceHandles = useRef(new Map<string, HoursEditorHandle>())
  // "Copy to…" from a day's sheet: the copy sheet opens once that sheet has
  // closed, and focus goes back to the day's row when the copy sheet does.
  const [pendingCopy, setPendingCopy] = useState<number | null>(null)
  const [lastCopyDay, setLastCopyDay] = useState<number | null>(null)
  // The periods a day had when it was switched off, so switching it back on
  // brings them back instead of resetting to 09:00–17:00.
  const [closedPeriods, setClosedPeriods] = useState<
    Record<number, Day["periods"]>
  >({})
  const today = localToday(timeZone)
  // The day whose sheet is showing (its times, split periods and Copy to…).
  const [dayKey, setDayKey] = useState<number | null>(null)
  const [dayOpen, setDayOpen] = useState(false)
  const dayRowPrefix = useId()
  const dayRowId = (day: number) => `${dayRowPrefix}day-row-${day}`
  // The field to focus when the day sheet opens (a validation summary link).
  const [dayFocusField, setDayFocusField] = useState<string | null>(null)
  function openDay(day: number, field: string | null = null) {
    setDayFocusField(field)
    setDayKey(day)
    setDayOpen(true)
  }
  function closeDay() {
    setDayOpen(false)
    setDayFocusField(null)
  }
  // Switching a day on brings back the periods it had when it was switched
  // off, or 09:00–17:00 the first time.
  function toggleDay(day: Day, open: boolean) {
    const dayOfWeek = day.dayOfWeek
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
        setClosedPeriods((all) => ({ ...all, [dayOfWeek]: day.periods }))
      setDay({ ...day, isClosed: true, periods: [] })
    }
  }

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

  // The special day whose sheet is showing, by its stable key, so the sheet
  // stays on the same day while a date edit re-sorts the rows behind it.
  const [sheetKey, setSheetKey] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // The field to focus when the sheet opens (a validation summary link).
  const [focusField, setFocusField] = useState<string | null>(null)
  const removedRef = useRef(false)
  const sheetIndex = sheetKey === null ? -1 : specialKeys.indexOf(sheetKey)
  const sheetEntry = sheetIndex >= 0 ? value.special[sheetIndex] : undefined

  function openSpecialSheet(key: number, field: string | null = null) {
    removedRef.current = false
    setFocusField(field)
    setSheetKey(key)
    setSheetOpen(true)
  }
  function closeSpecialSheet() {
    setSheetOpen(false)
    setFocusField(null)
  }

  useImperativeHandle(
    ref,
    () => ({
      reveal(target) {
        // A service schedule is its own editor, with its own day sheets.
        for (const [type, handle] of serviceHandles.current) {
          if (target.startsWith(`service-${encodeURIComponent(type)}-`))
            return handle.reveal(target)
        }
        const day = dayIndexOf(target, serviceId)
        if (day !== null) {
          // The day's switch is on the row itself; every other field is in
          // the day's sheet.
          if (target === scopedId(serviceId, baseHoursFieldId.dayOpen(day))) {
            document.getElementById(target)?.focus()
            return Promise.resolve()
          }
          openDay(day, target)
          return untilMounted(target)
        }
        const index = specialIndexOf(target)
        const key = index === null ? undefined : specialKeys[index]
        if (key === undefined) return Promise.resolve()
        openSpecialSheet(key, target)
        return untilMounted(target)
      },
    }),
    [specialKeys, serviceId]
  )

  function addSpecial() {
    const key = (specialKeys.length ? Math.max(...specialKeys) : -1) + 1
    setSpecialKeys((keys) => [...keys, key])
    setSpecial([
      ...value.special,
      { effectiveDate: "", isClosed: true, opensAt: null, closesAt: null },
    ])
    // A new day is only a row once it has a date: its sheet opens at once.
    openSpecialSheet(key)
  }
  function removeSpecial(index: number) {
    setSpecialKeys((keys) => keys.filter((_, i) => i !== index))
    setSpecial(value.special.filter((_, i) => i !== index))
  }

  function addService(hoursTypeId: string) {
    if (!supportedHoursTypes.some((type) => type.hoursTypeId === hoursTypeId))
      return
    onChange({
      ...value,
      moreHours: [...value.moreHours, { hoursTypeId, periods: [] }].sort(
        (left, right) => left.hoursTypeId.localeCompare(right.hoursTypeId)
      ),
    })
    setAddOpen(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        label={scheduleName}
        headingAs={serviceId ? "h3" : "h2"}
        headingId={headingId}
        action={
          disabled ? undefined : (
            <SettingsGroupAction
              aria-haspopup="dialog"
              onClick={() => setCopyFrom(WEEK_ORDER[0])}
            >
              Copy {serviceId ? `${scheduleName} ` : ""}
              {DAY_LABELS[WEEK_ORDER[0]]} to…
            </SettingsGroupAction>
          )
        }
        card
        className="mt-0"
        listProps={{
          className: "divide-y divide-line-subtle",
        }}
      >
        {WEEK_ORDER.map((dayOfWeek) => {
          const day = dayOf(value, dayOfWeek)
          const label = serviceId
            ? `${scheduleName} ${DAY_LABELS[dayOfWeek]}`
            : DAY_LABELS[dayOfWeek]
          const changed = google
            ? !sameDay(day, dayOf(google, dayOfWeek))
            : false
          const dayError = errors[hoursFieldId.dayOpen(dayOfWeek)]
          const dayProblem =
            dayError ??
            dayFieldProblem(errors, hoursFieldId, dayOfWeek, day.periods.length)
          const rowErrorId = `${hoursFieldId.dayOpen(dayOfWeek)}-error`
          return (
            // The row opens the day's sheet; its switch sits beside the
            // row, not inside it, so each stays one control.
            <li
              key={dayOfWeek}
              data-changed={changed || undefined}
              className={cn(
                "flex items-center gap-1",
                rowBleedClassName,
                "desk:px-2",
                changed && "rounded-(--np-radius-field) bg-fill"
              )}
            >
              <ListRow
                as="div"
                flush
                emphasis="neutral"
                id={dayRowId(dayOfWeek)}
                aria-haspopup="dialog"
                aria-describedby={dayProblem ? rowErrorId : undefined}
                wrapperClassName="min-w-0 flex-1"
                onClick={() => openDay(dayOfWeek)}
                title={label}
                meta={<span className="tabular-nums">{describeDay(day)}</span>}
                trailing={changed ? <ChangedMark /> : undefined}
                footer={
                  dayProblem ? (
                    <FieldProblem id={rowErrorId} message={dayProblem} />
                  ) : undefined
                }
              />
              <Switch
                id={hoursFieldId.dayOpen(dayOfWeek)}
                checked={!day.isClosed}
                disabled={disabled}
                aria-label={`${label} open`}
                aria-invalid={dayError ? true : undefined}
                aria-describedby={dayError ? rowErrorId : undefined}
                onCheckedChange={(open) => toggleDay(day, open)}
              />
            </li>
          )
        })}
      </SettingsGroup>

      {!weeklyOnly ? (
        <SettingsGroup label="Service hours" bodyAs="div" className="mt-0">
          <div className="flex flex-col gap-4">
            {serviceNote ? (
              <p className="text-ui text-ink-secondary">{serviceNote}</p>
            ) : null}
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
                    ref={(handle) => {
                      if (handle)
                        serviceHandles.current.set(entry.hoursTypeId, handle)
                      else serviceHandles.current.delete(entry.hoursTypeId)
                    }}
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
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 grow basis-48 text-caption text-ink-muted">
                      {entry.hoursTypeId}
                      {metadata
                        ? ""
                        : " · Google has not confirmed this service type. Its saved schedule is preserved and shown read-only."}
                    </p>
                    {!disabled && metadata ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-danger-ink"
                        onClick={() => setRemoveType(entry.hoursTypeId)}
                      >
                        <Trash2 aria-hidden />
                        Remove {metadata.displayName} schedule
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
            {!disabled && addableTypes.length > 0 ? (
              <div className="-ml-2.5 flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-accent-ink"
                  aria-haspopup="dialog"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus aria-hidden />
                  Add service schedule
                </Button>
              </div>
            ) : null}
          </div>
          {/* The services Google supports here, as one short choice list:
              choosing one adds its (empty) schedule to the draft. */}
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetContent variant="inset">
              <SheetHeader>
                <SheetTitle>Service schedule to add</SheetTitle>
              </SheetHeader>
              <SheetBody>
                <OptionRowGroup applyOnChoose label="Service schedule to add">
                  {addableTypes.map((type) => (
                    <OptionRow
                      key={type.hoursTypeId}
                      label={type.displayName}
                      onClick={() => addService(type.hoursTypeId)}
                    />
                  ))}
                </OptionRowGroup>
              </SheetBody>
            </SheetContent>
          </Sheet>
          <AlertDialog
            open={removeType !== null}
            onOpenChange={(open) => !open && setRemoveType(null)}
          >
            <AlertDialogContent>
              <AlertDialogTitle>Remove service schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove{" "}
                {supportedHoursTypes.find(
                  (type) => type.hoursTypeId === removeType
                )?.displayName ?? removeType}{" "}
                from this draft. Review and publish to remove it from Google.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="ghost" />}>
                  Cancel
                </AlertDialogClose>
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
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsGroup>
      ) : null}

      {!weeklyOnly ? (
        <SettingsGroup
          label="Special hours"
          headingId={specialHeadingId}
          caption="Holidays and one-off closures. They override the regular week."
          card
          className="mt-0"
        >
          {value.special.length === 0 ? (
            <li className="py-2 text-ui text-ink-muted desk:px-2">
              No special days yet.
            </li>
          ) : null}
          {specialOrder(value.special).map((index) => {
            const entry = value.special[index]!
            const message = specialMessage(errors, hoursFieldId, index)
            const past = Boolean(
              entry.effectiveDate && entry.effectiveDate < today
            )
            const rowErrorId = `special-${index}-row-error`
            const changed = specialChanged(google, entry)
            const key = specialKeys[index]!
            return (
              <ListRow
                key={key}
                id={specialRowId(key)}
                as="li"
                flush
                emphasis="neutral"
                wrapperClassName={cn(
                  "-mx-2 px-2 desk:mx-0",
                  changed && "bg-fill"
                )}
                wrapperProps={{
                  "data-past": past || undefined,
                  "data-changed": changed || undefined,
                }}
                aria-haspopup="dialog"
                aria-describedby={message ? rowErrorId : undefined}
                onClick={() => openSpecialSheet(key)}
                title={
                  entry.effectiveDate
                    ? formatSpecialDate(entry.effectiveDate)
                    : "New special day"
                }
                subtitle={
                  <span className="tabular-nums">{specialSummary(entry)}</span>
                }
                trailing={
                  changed || past ? (
                    <>
                      {changed ? <ChangedMark /> : null}
                      {past ? (
                        <span className="text-caption font-semibold text-ink-secondary">
                          Past
                        </span>
                      ) : null}
                    </>
                  ) : undefined
                }
                preview={specialHint(entry, past) ?? undefined}
                footer={
                  message ? (
                    <FieldProblem id={rowErrorId} message={message} />
                  ) : undefined
                }
              />
            )
          })}
          {!disabled ? (
            <li className="py-1 desk:px-1">
              <div className="-ml-2.5 flex desk:ml-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-accent-ink"
                  aria-haspopup="dialog"
                  onClick={addSpecial}
                >
                  <CalendarPlus aria-hidden />
                  Add a special day
                </Button>
              </div>
            </li>
          ) : null}
        </SettingsGroup>
      ) : null}

      {!weeklyOnly ? (
        <Sheet
          open={sheetOpen && sheetEntry !== undefined}
          onOpenChange={(next) => {
            if (!next) closeSpecialSheet()
          }}
        >
          <SheetContent
            side="bottom"
            className="flex flex-col gap-0"
            initialFocus={() => {
              if (sheetIndex < 0) return true
              const target =
                focusField ??
                (disabled ? null : hoursFieldId.specialDate(sheetIndex))
              return (target && document.getElementById(target)) || true
            }}
            finalFocus={() =>
              // The removed day's row is gone: land on the group's heading.
              // Otherwise return to the day's own row, which for a day just
              // added is not the button that opened the sheet.
              removedRef.current
                ? (document.getElementById(specialHeadingId) ?? true)
                : ((sheetKey === null
                    ? null
                    : document.getElementById(specialRowId(sheetKey))) ?? true)
            }
          >
            {sheetEntry ? (
              <SpecialDaySheet
                index={sheetIndex}
                entry={sheetEntry}
                errors={errors}
                disabled={disabled}
                past={Boolean(
                  sheetEntry.effectiveDate && sheetEntry.effectiveDate < today
                )}
                onChange={(next) =>
                  setSpecial(
                    value.special.map((s, i) => (i === sheetIndex ? next : s))
                  )
                }
                onDone={closeSpecialSheet}
                onRemove={() => {
                  removedRef.current = true
                  closeSpecialSheet()
                  removeSpecial(sheetIndex)
                }}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}

      <Sheet
        open={dayOpen && dayKey !== null}
        onOpenChange={(next) => {
          if (!next) closeDay()
        }}
        onOpenChangeComplete={(open) => {
          if (open || pendingCopy === null) return
          setLastCopyDay(pendingCopy)
          setCopyFrom(pendingCopy)
          setPendingCopy(null)
        }}
      >
        <SheetContent
          side="bottom"
          className="flex flex-col gap-0"
          initialFocus={() => {
            if (dayKey === null) return true
            const target =
              dayFocusField ??
              (disabled ? null : `${hoursFieldId.dayOpen(dayKey)}-sheet`)
            return (target && document.getElementById(target)) || true
          }}
          // Back to the day's own row, which the sheet was opened from.
          finalFocus={() =>
            (dayKey === null
              ? null
              : document.getElementById(dayRowId(dayKey))) ?? true
          }
        >
          {dayKey !== null ? (
            <DaySheet
              day={dayOf(value, dayKey)}
              label={
                serviceId
                  ? `${scheduleName} ${DAY_LABELS[dayKey]}`
                  : DAY_LABELS[dayKey]
              }
              ids={hoursFieldId}
              errors={errors}
              disabled={disabled}
              onChange={setDay}
              onToggle={(open) => toggleDay(dayOf(value, dayKey), open)}
              onCopy={() => {
                // One sheet at a time: the copy sheet opens once this closes.
                setPendingCopy(dayKey)
                closeDay()
              }}
              onDone={closeDay}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <CopyDaysDialog
        from={copyFrom}
        scope={serviceId ? scheduleName : undefined}
        returnFocusId={lastCopyDay === null ? null : dayRowId(lastCopyDay)}
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

/**
 * One weekday in its sheet: open or closed, each period's times and closing
 * day, a split period, and Copy to… Every change goes straight into the
 * draft; Done just closes the sheet.
 */
function DaySheet({
  day,
  label,
  ids,
  errors,
  disabled,
  onChange,
  onToggle,
  onCopy,
  onDone,
}: {
  day: Day
  label: string
  ids: typeof baseHoursFieldId
  errors: Record<string, string>
  disabled: boolean
  onChange: (next: Day) => void
  onToggle: (open: boolean) => void
  onCopy: () => void
  onDone: () => void
}) {
  const dayOfWeek = day.dayOfWeek
  const switchId = `${ids.dayOpen(dayOfWeek)}-sheet`
  const dayError = errors[ids.dayOpen(dayOfWeek)]
  return (
    <>
      <SheetHeader>
        <SheetTitle>{label} hours</SheetTitle>
        <SheetDescription>
          Use 24-hour times. Choose the closing day explicitly for overnight
          hours; 24:00 means midnight at the end of that day.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="gap-4">
        <span className="flex min-h-(--np-control-h) items-center gap-2">
          <Switch
            id={switchId}
            checked={!day.isClosed}
            disabled={disabled}
            aria-label={`${label} open in this sheet`}
            aria-invalid={dayError ? true : undefined}
            aria-describedby={
              dayError ? `${ids.dayOpen(dayOfWeek)}-error-sheet` : undefined
            }
            onCheckedChange={onToggle}
          />
          <span aria-hidden className="text-ui text-ink-muted">
            {day.isClosed ? "Closed all day" : "Open"}
          </span>
        </span>
        {day.isClosed
          ? null
          : day.periods.map((period, index) => {
              const opensId = ids.opens(dayOfWeek, index)
              const message =
                errors[opensId] ??
                errors[ids.closes(dayOfWeek, index)] ??
                errors[ids.ends(dayOfWeek, index)]
              const errorId = `${opensId}-error`
              return (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <TimeField
                    id={opensId}
                    aria-label={`${label} period ${index + 1} opens`}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={message ? errorId : undefined}
                    value={period.opensAt}
                    disabled={disabled}
                    onValueChange={(opensAt) =>
                      onChange({
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
                    id={ids.closes(dayOfWeek, index)}
                    aria-label={`${label} period ${index + 1} closes`}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={message ? errorId : undefined}
                    value={period.closesAt}
                    disabled={disabled}
                    onValueChange={(closesAt) =>
                      onChange({
                        ...day,
                        periods: day.periods.map((p, pi) =>
                          pi === index ? { ...p, closesAt } : p
                        ),
                      })
                    }
                  />
                  <ClosingDaySelect
                    id={ids.ends(dayOfWeek, index)}
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
                      onChange({
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
                        onChange({
                          ...day,
                          periods: day.periods.filter((_, pi) => pi !== index),
                        })
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  ) : null}
                  <FieldProblem id={errorId} message={message} />
                </div>
              )
            })}
        <FieldProblem
          id={`${ids.dayOpen(dayOfWeek)}-error-sheet`}
          message={dayError}
        />
        {!disabled && !day.isClosed && canSplit(day.periods, dayOfWeek) ? (
          <div className="-ml-2.5 flex">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-ink-secondary"
              onClick={() =>
                onChange({
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
      </SheetBody>
      <SheetFooter>
        {!disabled ? (
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            aria-label={`Copy to… (${label}’s hours)`}
            onClick={onCopy}
          >
            <Copy aria-hidden />
            Copy to…
          </Button>
        ) : null}
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </SheetFooter>
    </>
  )
}

type SpecialEntry = NormalizedHours["special"][number]

/** The first problem with a special day, in the order it was always shown. */
function specialMessage(
  errors: Record<string, string>,
  ids: typeof baseHoursFieldId,
  index: number
): string | undefined {
  return (
    errors[ids.specialDate(index)] ??
    errors[ids.specialCloses(index)] ??
    errors[ids.specialOpens(index)] ??
    errors[ids.specialEnd(index)]
  )
}

/** Whether a special day differs from what Google holds for that date. */
function specialChanged(
  google: NormalizedHours | undefined,
  entry: SpecialEntry
): boolean {
  if (!google) return false
  const googleEntry = google.special.find(
    (other) => other.effectiveDate === entry.effectiveDate
  )
  return (
    !googleEntry ||
    describeSpecialEntry(googleEntry) !== describeSpecialEntry(entry)
  )
}

function specialHint(entry: SpecialEntry, past: boolean): string | null {
  if (!entry.effectiveDate) return "Choose the date this applies to."
  return past ? "Already passed, so customers no longer see it." : null
}

/**
 * One special day's fields, in its sheet: the date, Closed or Custom hours
 * (a radio pair), and for custom hours the times and the closing date.
 * Every change goes straight into the draft.
 */
function SpecialDaySheet({
  index,
  entry,
  errors,
  disabled,
  past,
  onChange,
  onDone,
  onRemove,
}: {
  index: number
  entry: SpecialEntry
  errors: Record<string, string>
  disabled: boolean
  past: boolean
  onChange: (next: SpecialEntry) => void
  onDone: () => void
  onRemove: () => void
}) {
  const ids = baseHoursFieldId
  const dateId = ids.specialDate(index)
  const opensId = ids.specialOpens(index)
  const closesId = ids.specialCloses(index)
  const endId = ids.specialEnd(index)
  const message = specialMessage(errors, ids, index)
  const errorId = `special-${index}-error`
  const hint = specialHint(entry, past)
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {entry.effectiveDate
            ? formatSpecialDate(entry.effectiveDate)
            : "New special day"}
        </SheetTitle>
        <SheetDescription>
          These hours override the regular week on this date.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="gap-4">
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
              onChange({
                ...entry,
                effectiveDate: event.target.value,
                ...(entry.endDate === entry.effectiveDate
                  ? { endDate: event.target.value }
                  : {}),
              })
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
              onChange(
                mode === "closed"
                  ? { ...entry, isClosed: true, opensAt: null, closesAt: null }
                  : {
                      ...entry,
                      isClosed: false,
                      endDate: entry.endDate ?? entry.effectiveDate,
                      opensAt: entry.opensAt ?? "09:00",
                      closesAt: entry.closesAt ?? "17:00",
                    }
              )
            }
          >
            <SegmentedControlItem value="closed">Closed</SegmentedControlItem>
            <SegmentedControlItem value="custom">
              Custom hours
            </SegmentedControlItem>
          </SegmentedControl>
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
              onValueChange={(opensAt) => onChange({ ...entry, opensAt })}
            />
            <span aria-hidden className="text-ink-muted">
              –
            </span>
            <TimeField
              id={closesId}
              aria-label={`Special date ${index + 1} closes`}
              aria-invalid={
                errors[closesId] || errors[opensId] ? true : undefined
              }
              aria-describedby={message ? errorId : undefined}
              value={entry.closesAt ?? ""}
              disabled={disabled}
              onValueChange={(closesAt) => onChange({ ...entry, closesAt })}
            />
            <Input
              id={endId}
              type="date"
              aria-label={`Special date ${index + 1} closing date`}
              aria-invalid={errors[endId] ? true : undefined}
              aria-describedby={message ? errorId : undefined}
              value={entry.endDate ?? entry.effectiveDate}
              disabled={disabled}
              className="w-42 tabular-nums"
              onChange={(event) =>
                onChange({ ...entry, endDate: event.target.value })
              }
            />
          </div>
        ) : null}

        {hint ? <p className="text-caption text-ink-muted">{hint}</p> : null}
        <FieldProblem id={errorId} message={message} />
      </SheetBody>
      <SheetFooter>
        {!disabled ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger-ink"
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
            Remove
          </Button>
        ) : null}
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </SheetFooter>
    </>
  )
}

const QUICK_PICKS: { label: string; days: readonly number[] }[] = [
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekend", days: [6, 0] },
  { label: "Every day", days: WEEK_ORDER },
]

/**
 * Copy one day's hours onto others. Local only: nothing reaches Google, and
 * nothing here is validated input. An inset sheet (a centred dialog from
 * `sm`): the quick picks as quiet text actions, then the days as checkbox
 * option rows (the whole row is the target), with Cancel and the one Copy.
 */
function CopyDaysDialog({
  from,
  scope,
  returnFocusId,
  value,
  onClose,
  onApply,
}: {
  from: number | null
  /** The service schedule being copied within, when it is not the venue's. */
  scope?: string
  /** The element to return focus to when the sheet closes. */
  returnFocusId?: string | null
  value: NormalizedHours
  onClose: () => void
  onApply: (targets: number[]) => void
}) {
  const [picked, setPicked] = useState<number[]>([])
  const [shownFor, setShownFor] = useState<number | null>(from)
  const daysLabelId = useId()
  if (from !== shownFor) {
    setShownFor(from)
    setPicked([])
  }
  const open = from !== null
  const label =
    from !== null ? `${scope ? `${scope} ` : ""}${DAY_LABELS[from]}` : ""
  const others = WEEK_ORDER.filter((day) => day !== from)

  return (
    // Ticked days are input, so a stray swipe or scrim tap asks before
    // throwing them away.
    <Sheet
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
      <SheetContent
        variant="inset"
        className="flex flex-col gap-0"
        finalFocus={() =>
          (returnFocusId ? document.getElementById(returnFocusId) : null) ??
          true
        }
      >
        <SheetHeader>
          <SheetTitle>Copy {label}’s hours</SheetTitle>
          <SheetDescription>
            {from !== null ? describeDay(dayOf(value, from)) : ""}. Choose the
            days that should match.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-3">
          <div className="-ml-2.5 flex flex-wrap gap-x-1">
            {QUICK_PICKS.map((pick) => (
              <Button
                key={pick.label}
                type="button"
                variant="ghost"
                size="sm"
                className="text-accent-ink"
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
              className="text-ink-secondary"
              onClick={() => setPicked([])}
            >
              Clear
            </Button>
          </div>
          <p
            id={daysLabelId}
            className="text-caption font-medium text-ink-muted"
          >
            Copy to
          </p>
          <OptionRowGroup
            type="multiple"
            aria-labelledby={daysLabelId}
            className="-mx-3"
          >
            {others.map((day) => (
              <OptionRow
                key={day}
                indicator="checkbox"
                selected={picked.includes(day)}
                label={DAY_LABELS[day]}
                description={`Now: ${describeDay(dayOf(value, day))}`}
                onClick={() =>
                  setPicked((current) =>
                    current.includes(day)
                      ? current.filter((other) => other !== day)
                      : [...current, day]
                  )
                }
              />
            ))}
          </OptionRowGroup>
          <p className="text-caption text-ink-muted">
            This replaces the hours on the days you tick. Nothing reaches Google
            until you publish.
          </p>
        </SheetBody>
        <SheetFooter>
          <Button
            type="button"
            disabled={picked.length === 0}
            onClick={() => onApply(picked)}
          >
            {picked.length === 0
              ? "Copy"
              : `Copy to ${picked.length} ${picked.length === 1 ? "day" : "days"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
