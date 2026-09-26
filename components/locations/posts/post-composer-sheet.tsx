"use client"

import { PencilIcon, Plus } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { PostPreview } from "@/components/locations/posts/post-preview"
import { Button } from "@/components/ui/button"
import { ToggleChip } from "@/components/ui/chip"
import {
  Field,
  FieldCounter,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
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
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { createPost, updatePost, type Post } from "@/lib/api/location-posts"
import {
  DAYS_OF_WEEK,
  LOCAL_POST_ACTION_TYPES,
  type DayOfWeek,
  type LocalPostActionType,
  type LocalPostTopicType,
} from "@/lib/contracts/location-posts"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import {
  localPostFormSchema,
  type LocalPostFormValues,
} from "@/lib/locations/forms/local-post"
import { POST_ACTION_LABEL } from "@/lib/locations/post-display"
import {
  DEFAULT_TIMEZONE,
  NO_RECURRENCE,
  WEEKDAY_SHORT,
  describeRecurrence,
  googleRecurrence,
  monthlyOptions,
  recurrenceFields,
  weekdayOf,
  type MonthlyRepeat,
  type PostRepeat,
  type RecurrenceFields,
} from "@/lib/locations/post-recurrence"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

const TOPICS: ReadonlyArray<{ value: LocalPostTopicType; label: string }> = [
  { value: "STANDARD", label: "Update" },
  { value: "EVENT", label: "Event" },
  { value: "OFFER", label: "Offer" },
]

const REPEATS: ReadonlyArray<{ value: PostRepeat; label: string }> = [
  { value: "none", label: "Doesn’t repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
]

/** The summary limit the posts route parses with (`localPostInputSchema`). */
const SUMMARY_MAX = 1500

type Values = {
  topicType: LocalPostTopicType
  summary: string
  eventTitle: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  couponCode: string
  redeemUrl: string
  terms: string
  action: LocalPostActionType | ""
  actionUrl: string
} & RecurrenceFields

const EMPTY: Values = {
  topicType: "STANDARD",
  summary: "",
  eventTitle: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  couponCode: "",
  redeemUrl: "",
  terms: "",
  action: "",
  actionUrl: "",
  ...NO_RECURRENCE,
}

type Errors = Partial<
  Record<
    "summary" | "eventTitle" | "dates" | "repeat" | "redeemUrl" | "actionUrl",
    string
  >
>

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const pad = (value: unknown) =>
  typeof value === "number" ? String(value).padStart(2, "0") : ""

/** Google's `{ year, month, day }` → `2026-10-01`, or "" when incomplete. */
function formDate(value: unknown): string {
  const date = record(value)
  if (!date || !date.year || !date.month || !date.day) return ""
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

/** Google's `{ hours, minutes }` → `20:30`, or "" when absent. */
function formTime(value: unknown): string {
  const time = record(value)
  if (!time) return ""
  return `${pad(time.hours ?? 0)}:${pad(time.minutes ?? 0)}`
}

/** A saved post back into the composer's fields, for editing and previews. */
export function postFormValues(
  post: Post,
  timeZone: string = DEFAULT_TIMEZONE
): Values {
  const event = record(post.event)
  const schedule = record(event?.schedule)
  const offer = record(post.offer)
  const cta = record(post.callToAction)
  const action = LOCAL_POST_ACTION_TYPES.find(
    (type) => type === cta?.actionType
  )
  const text = (value: unknown) => (typeof value === "string" ? value : "")
  return {
    topicType: post.topicType,
    summary: post.summary,
    eventTitle: text(event?.title),
    startDate: formDate(schedule?.startDate),
    startTime: formTime(schedule?.startTime),
    endDate: formDate(schedule?.endDate),
    endTime: formTime(schedule?.endTime),
    couponCode: text(offer?.couponCode),
    redeemUrl: text(offer?.redeemOnlineUrl),
    terms: text(offer?.termsConditions),
    action: action ?? "",
    actionUrl: text(cta?.url),
    ...recurrenceFields(event, timeZone),
  }
}

/** The photos a saved post already carries, kept as they are on an edit. */
function keptMedia(post: Post | undefined): Array<{ sourceUrl: string }> {
  if (!post || !Array.isArray(post.media)) return []
  return post.media.flatMap((entry) => {
    const url = record(entry)?.sourceUrl
    return typeof url === "string" ? [{ sourceUrl: url }] : []
  })
}

/** `2026-10-01` → Google's `{ year, month, day }`. */
function googleDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return { year, month, day }
}

/** `20:30` → Google's `{ hours, minutes }`. */
function googleTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number)
  return { hours, minutes }
}

function validate(values: Values): Errors {
  const errors: Errors = {}
  const event = values.topicType !== "STANDARD"
  if (values.summary.trim().length > SUMMARY_MAX)
    errors.summary = `Google allows ${SUMMARY_MAX.toLocaleString("en-GB")} characters. Remove ${(values.summary.trim().length - SUMMARY_MAX).toLocaleString("en-GB")}.`
  if (event && !values.eventTitle.trim())
    errors.eventTitle = `Give the ${values.topicType === "OFFER" ? "offer" : "event"} a title.`
  if (event && (values.startDate || values.endDate)) {
    if (!values.startDate || !values.endDate)
      errors.dates = "Choose both a start date and an end date."
    else {
      const start = `${values.startDate}T${values.startTime || "00:00"}`
      const end = `${values.endDate}T${values.endTime || "23:59"}`
      if (end < start) errors.dates = "The end is before the start."
    }
  }
  if (event && values.repeat !== "none") {
    if (!values.startDate || !values.endDate)
      errors.repeat = "A repeating post needs its first start and end dates."
    else if (values.seriesEnd && values.seriesEnd < values.startDate)
      errors.repeat = "The last repeat is before the first one."
  }
  if (
    values.topicType === "OFFER" &&
    values.redeemUrl.trim() &&
    !isHttpUrl(values.redeemUrl.trim())
  )
    errors.redeemUrl = "Enter a full link, starting https://."
  if (values.action && values.action !== "CALL") {
    if (!values.actionUrl.trim())
      errors.actionUrl = "Add the link the button opens."
    else if (!isHttpUrl(values.actionUrl.trim()))
      errors.actionUrl = "Enter a full link, starting https://."
  }
  return errors
}

/** The form values → the posts route's body, in Google's LocalPost shape. */
function toCandidate(
  values: Values,
  timeZone: string,
  post?: Post
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    topicType: values.topicType,
    summary: values.summary,
    media: keptMedia(post),
  }
  if (post) candidate.languageCode = post.languageCode
  if (values.topicType !== "STANDARD") {
    const event: Record<string, unknown> = { title: values.eventTitle.trim() }
    if (values.startDate && values.endDate) {
      const schedule: Record<string, unknown> = {
        startDate: googleDate(values.startDate),
        endDate: googleDate(values.endDate),
      }
      if (values.startTime) schedule.startTime = googleTime(values.startTime)
      if (values.endTime) schedule.endTime = googleTime(values.endTime)
      event.schedule = schedule
    }
    const recurrence = googleRecurrence(values, values.startDate, timeZone)
    if (recurrence) event.recurrenceInfo = recurrence
    candidate.event = event
  }
  if (values.topicType === "OFFER") {
    const offer: Record<string, string> = {}
    if (values.couponCode.trim()) offer.couponCode = values.couponCode.trim()
    if (values.redeemUrl.trim()) offer.redeemOnlineUrl = values.redeemUrl.trim()
    if (values.terms.trim()) offer.termsConditions = values.terms.trim()
    candidate.offer = offer
  }
  if (values.action) {
    candidate.callToAction =
      values.action === "CALL"
        ? { actionType: "CALL" }
        : { actionType: values.action, url: values.actionUrl.trim() }
  }
  return candidate
}

/**
 * Writing a post, with the result visible while you write it (reference
 * `#composer`): the type as a segmented control, the event or offer title
 * and dates, the text with its counter, an optional button, and a preview
 * beside the fields on a wide sheet (below them on a phone).
 *
 * It saves a draft only. Nothing reaches Google until the post is published
 * from the list, where the repo's approval rules decide whether that is a
 * publish or a request for approval.
 *
 * With `post` it edits that draft (or failed post) instead: the fields start
 * from the saved post, the trigger is a small Edit button, and saving
 * updates it in place (a failed post goes back to being a draft).
 */
export function PostComposerSheet({
  locationId,
  disabledReason,
  post,
  timezone = DEFAULT_TIMEZONE,
}: {
  locationId: string
  disabledReason: string | null
  /** The saved draft or failed post to edit. Omit to write a new one. */
  post?: Post
  /** The listing's IANA timezone: a repeat's last day ends at its midnight. */
  timezone?: string
}) {
  const editing = Boolean(post)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Values>(() =>
    post ? postFormValues(post, timezone) : EMPTY
  )
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLDivElement | null>(null)
  const pausedId = useId()
  const typeLabelId = useId()
  const datesId = useId()
  const repeatId = useId()
  const weekdaysLabelId = useId()

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const isDirty = post
    ? JSON.stringify(values) !== JSON.stringify(postFormValues(post, timezone))
    : (Object.keys(EMPTY) as Array<keyof Values>).some((key) => {
        if (key === "topicType") return false
        const value = values[key]
        return typeof value === "string"
          ? value.trim() !== EMPTY[key]
          : JSON.stringify(value) !== JSON.stringify(EMPTY[key])
      })
  useDirtyGuard({
    key: post
      ? `location-posts-edit-${locationId}-${post.id}`
      : `location-posts-composer-${locationId}`,
    isDirty,
    snapshot: () => JSON.stringify(values),
  })

  function changeOpen(next: boolean) {
    // Each edit starts from the post as it is saved now, not from whatever
    // was typed and cancelled last time.
    if (next && post) {
      setValues(postFormValues(post, timezone))
      setErrors({})
      setServerError(null)
    }
    setOpen(next)
  }

  // After a failed save, move focus to the first field that needs fixing.
  useEffect(() => {
    if (attempt === 0) return
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus()
  }, [attempt])

  const create = useResourceMutation({
    mutationFn: async (input: LocalPostFormValues): Promise<unknown> =>
      post
        ? updatePost(locationId, post.id, input)
        : createPost(locationId, input),
    invalidate: [queryKeys.locationPosts(locationId)],
    successToast: post
      ? "Draft updated. Google is not affected."
      : "Draft saved. Google is not affected.",
    errorContext: "post",
    onError: (_error, message) => setServerError(message),
    onSuccess: () => {
      if (!post) setValues(EMPTY)
      setErrors({})
      setServerError(null)
      setOpen(false)
    },
  })

  const disabled = Boolean(disabledReason)
  const event = values.topicType !== "STANDARD"
  const offer = values.topicType === "OFFER"
  const summaryLength = values.summary.length
  const monthly = monthlyOptions(values.startDate)
  const recurrenceText =
    event && values.startDate
      ? describeRecurrence(values, values.startDate)
      : ""

  function changeRepeat(next: PostRepeat) {
    setValues((current) => ({
      ...current,
      repeat: next,
      // Start a weekly repeat on the first run's own weekday, which is what
      // Google does with no days chosen, so the chips show the truth.
      weekdays:
        next === "weekly" && current.weekdays.length === 0
          ? [weekdayOf(current.startDate)].filter(
              (day): day is DayOfWeek => day !== null
            )
          : current.weekdays,
    }))
  }

  function toggleWeekday(day: DayOfWeek) {
    setValues((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((entry) => entry !== day)
        : [...current.weekdays, day],
    }))
  }

  function submit() {
    const found = validate(values)
    setErrors(found)
    setAttempt((count) => count + 1)
    if (Object.keys(found).length > 0) return
    const parsed = localPostFormSchema.safeParse(
      toCandidate(values, timezone, post)
    )
    if (!parsed.success) {
      setServerError(
        parsed.error.issues[0]?.message ?? "Please complete the post."
      )
      return
    }
    setServerError(null)
    create.mutate(parsed.data)
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
      {disabled && !editing ? (
        <span
          id={pausedId}
          className="max-w-[30ch] text-caption text-warning-ink"
        >
          Paused: publishing to Google is switched off
        </span>
      ) : null}
      <Sheet open={open} onOpenChange={changeOpen}>
        {editing ? (
          <SheetTrigger
            render={<Button size="sm" variant="ghost" disabled={disabled} />}
          >
            <PencilIcon aria-hidden />
            Edit
          </SheetTrigger>
        ) : (
          <SheetTrigger
            render={
              <Button
                disabled={disabled}
                aria-describedby={disabled ? pausedId : undefined}
              />
            }
          >
            <Plus aria-hidden />
            New post
          </SheetTrigger>
        )}
        <SheetContent side="right" size="wide">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit post" : "New post"}</SheetTitle>
            <SheetDescription>
              {post?.status === "failed"
                ? "Saving turns it back into a draft. Nothing reaches Google until you publish it from the list."
                : "Saved as a draft. Nothing reaches Google until you publish it from the list."}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="@container/composer">
            <div className="grid grid-cols-1 items-start gap-6 @[760px]/composer:grid-cols-[minmax(0,1fr)_300px]">
              <div ref={formRef} className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <span
                    id={typeLabelId}
                    className="text-ui font-semibold text-ink"
                  >
                    Type
                  </span>
                  <SegmentedControl
                    aria-labelledby={typeLabelId}
                    value={values.topicType}
                    onValueChange={(next) =>
                      set("topicType", next as LocalPostTopicType)
                    }
                    className="self-start"
                  >
                    {TOPICS.map((topic) => (
                      <SegmentedControlItem
                        key={topic.value}
                        value={topic.value}
                      >
                        {topic.label}
                      </SegmentedControlItem>
                    ))}
                  </SegmentedControl>
                </div>

                {event ? (
                  <Field error={errors.eventTitle}>
                    <FieldLabel>
                      {offer ? "Offer title" : "Event title"}
                    </FieldLabel>
                    <Input
                      value={values.eventTitle}
                      onChange={(e) => set("eventTitle", e.target.value)}
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <FieldError>{errors.eventTitle}</FieldError>
                  </Field>
                ) : null}

                {event ? (
                  <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                    <legend className="mb-1.5 text-ui font-semibold text-ink">
                      When it runs{" "}
                      <span className="font-normal text-ink-muted">
                        (optional for a draft)
                      </span>
                    </legend>
                    <div className="grid grid-cols-1 gap-3 @[440px]/composer:grid-cols-2">
                      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                        <Field>
                          <FieldLabel>Starts</FieldLabel>
                          <Input
                            type="date"
                            value={values.startDate}
                            onChange={(e) => set("startDate", e.target.value)}
                            disabled={disabled}
                            aria-invalid={errors.dates ? true : undefined}
                            aria-describedby={datesId}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>
                            <span className="sr-only">Start </span>Time
                          </FieldLabel>
                          <Input
                            type="time"
                            value={values.startTime}
                            onChange={(e) => set("startTime", e.target.value)}
                            disabled={disabled}
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                        <Field>
                          <FieldLabel>Ends</FieldLabel>
                          <Input
                            type="date"
                            value={values.endDate}
                            min={values.startDate || undefined}
                            onChange={(e) => set("endDate", e.target.value)}
                            disabled={disabled}
                            aria-invalid={errors.dates ? true : undefined}
                            aria-describedby={datesId}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>
                            <span className="sr-only">End </span>Time
                          </FieldLabel>
                          <Input
                            type="time"
                            value={values.endTime}
                            onChange={(e) => set("endTime", e.target.value)}
                            disabled={disabled}
                          />
                        </Field>
                      </div>
                    </div>
                    {errors.dates ? (
                      <p
                        id={datesId}
                        role="alert"
                        className="text-caption font-medium text-danger-ink"
                      >
                        {errors.dates}
                      </p>
                    ) : (
                      <p id={datesId} className="text-caption text-ink-muted">
                        Times are the listing’s local time. Without a time, the
                        post runs all day.
                      </p>
                    )}
                  </fieldset>
                ) : null}

                {event ? (
                  <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
                    <legend className="sr-only">Repeat</legend>
                    <div className="grid grid-cols-1 gap-3 @[440px]/composer:grid-cols-2">
                      <Field>
                        <FieldLabel>Repeats</FieldLabel>
                        <Select
                          value={values.repeat}
                          onValueChange={(next) =>
                            changeRepeat(next as PostRepeat)
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger
                            className="w-full"
                            aria-invalid={errors.repeat ? true : undefined}
                            aria-describedby={repeatId}
                          >
                            <SelectValue>
                              {(value: string | null) =>
                                REPEATS.find((entry) => entry.value === value)
                                  ?.label ?? "Doesn’t repeat"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {REPEATS.map((entry) => (
                              <SelectItem key={entry.value} value={entry.value}>
                                {entry.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      {values.repeat !== "none" ? (
                        <Field>
                          <FieldLabel optional>Last repeat</FieldLabel>
                          <Input
                            type="date"
                            value={values.seriesEnd}
                            min={values.startDate || undefined}
                            onChange={(e) => set("seriesEnd", e.target.value)}
                            disabled={disabled}
                            aria-invalid={errors.repeat ? true : undefined}
                            aria-describedby={repeatId}
                          />
                        </Field>
                      ) : null}
                    </div>
                    {values.repeat === "weekly" ? (
                      <div className="flex flex-col gap-1.5">
                        <span
                          id={weekdaysLabelId}
                          className="text-ui font-semibold text-ink"
                        >
                          On
                        </span>
                        <div
                          role="group"
                          aria-labelledby={weekdaysLabelId}
                          className="flex flex-wrap gap-2"
                        >
                          {DAYS_OF_WEEK.map((day) => (
                            <ToggleChip
                              key={day}
                              pressed={values.weekdays.includes(day)}
                              onClick={() => toggleWeekday(day)}
                              disabled={disabled}
                            >
                              {WEEKDAY_SHORT[day]}
                            </ToggleChip>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {values.repeat === "monthly" ? (
                      <Field>
                        <FieldLabel>Each month</FieldLabel>
                        <Select
                          value={
                            monthly.some(
                              (entry) => entry.value === values.monthly
                            )
                              ? values.monthly
                              : "date"
                          }
                          onValueChange={(next) =>
                            set("monthly", next as MonthlyRepeat)
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(value: string | null) =>
                                monthly.find((entry) => entry.value === value)
                                  ?.label ?? monthly[0].label
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {monthly.map((entry) => (
                              <SelectItem key={entry.value} value={entry.value}>
                                {entry.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    ) : null}
                    {errors.repeat ? (
                      <p
                        id={repeatId}
                        role="alert"
                        className="text-caption font-medium text-danger-ink"
                      >
                        {errors.repeat}
                      </p>
                    ) : values.repeat !== "none" ? (
                      <p id={repeatId} className="text-caption text-ink-muted">
                        {recurrenceText ||
                          "Set the start date to see when it repeats."}
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}

                {offer ? (
                  <div className="grid grid-cols-1 gap-3 @[440px]/composer:grid-cols-2">
                    <Field>
                      <FieldLabel optional>Voucher code</FieldLabel>
                      <Input
                        value={values.couponCode}
                        onChange={(e) => set("couponCode", e.target.value)}
                        disabled={disabled}
                        maxLength={100}
                        autoComplete="off"
                      />
                    </Field>
                    <Field error={errors.redeemUrl}>
                      <FieldLabel optional>Redeem online link</FieldLabel>
                      <Input
                        type="url"
                        inputMode="url"
                        placeholder="https://"
                        value={values.redeemUrl}
                        onChange={(e) => set("redeemUrl", e.target.value)}
                        disabled={disabled}
                      />
                      <FieldError>{errors.redeemUrl}</FieldError>
                    </Field>
                    <Field className="@[440px]/composer:col-span-2">
                      <FieldLabel optional>Terms</FieldLabel>
                      <Input
                        value={values.terms}
                        onChange={(e) => set("terms", e.target.value)}
                        disabled={disabled}
                      />
                    </Field>
                  </div>
                ) : null}

                <Field error={errors.summary}>
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel>Summary</FieldLabel>
                    <FieldCounter over={summaryLength > SUMMARY_MAX}>
                      {summaryLength.toLocaleString("en-GB")} /{" "}
                      {SUMMARY_MAX.toLocaleString("en-GB")}
                    </FieldCounter>
                  </div>
                  <Textarea
                    value={values.summary}
                    onChange={(e) => set("summary", e.target.value)}
                    rows={6}
                    disabled={disabled}
                    aria-label="Post summary"
                  />
                  <FieldError>{errors.summary}</FieldError>
                </Field>

                <div className="grid grid-cols-1 gap-3 @[440px]/composer:grid-cols-2">
                  <Field>
                    <FieldLabel optional>Button</FieldLabel>
                    <Select
                      value={values.action || "NONE"}
                      onValueChange={(next) =>
                        set(
                          "action",
                          next === "NONE" ? "" : (next as LocalPostActionType)
                        )
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(value: string | null) =>
                            value && value !== "NONE"
                              ? POST_ACTION_LABEL[value as LocalPostActionType]
                              : "No button"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">No button</SelectItem>
                        {LOCAL_POST_ACTION_TYPES.map((action) => (
                          <SelectItem key={action} value={action}>
                            {POST_ACTION_LABEL[action]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {values.action && values.action !== "CALL" ? (
                    <Field error={errors.actionUrl}>
                      <FieldLabel>Button link</FieldLabel>
                      <Input
                        type="url"
                        inputMode="url"
                        placeholder="https://"
                        value={values.actionUrl}
                        onChange={(e) => set("actionUrl", e.target.value)}
                        disabled={disabled}
                      />
                      <FieldError>{errors.actionUrl}</FieldError>
                    </Field>
                  ) : values.action === "CALL" ? (
                    <p className="self-end pb-2 text-caption text-ink-muted">
                      Call now uses the listing’s phone number on Google.
                    </p>
                  ) : null}
                </div>

                {serverError ? (
                  <p role="alert" className="text-ui text-danger-ink">
                    {serverError}
                  </p>
                ) : null}
                {disabledReason ? (
                  <p role="note" className="text-caption text-ink-muted">
                    {disabledReason}
                  </p>
                ) : null}
              </div>

              <aside
                aria-label="Preview"
                className="flex min-w-0 flex-col gap-2 @[760px]/composer:sticky @[760px]/composer:top-0"
              >
                <PostPreview
                  topicType={values.topicType}
                  summary={values.summary}
                  eventTitle={values.eventTitle}
                  schedule={
                    event && values.startDate && values.endDate
                      ? { ...values }
                      : null
                  }
                  actionLabel={
                    values.action ? POST_ACTION_LABEL[values.action] : ""
                  }
                  recurrence={recurrenceText}
                />
                <span className="text-caption text-ink-muted">
                  An illustration. Google decides the final layout.
                </span>
              </aside>
            </div>
          </SheetBody>

          <SheetFooter className="sm:items-center">
            <span className="hidden text-caption text-ink-muted sm:mr-auto sm:block">
              Posts publish when you press Publish; scheduling isn’t available.
            </span>
            <Button variant="ghost" onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={disabled || !isDirty}
              pending={create.isPending}
              pendingLabel="Saving…"
            >
              {editing ? "Save changes" : "Save draft"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
