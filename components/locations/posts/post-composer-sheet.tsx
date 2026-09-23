"use client"

import { Plus } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { PostPreview } from "@/components/locations/posts/post-preview"
import { Button } from "@/components/ui/button"
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
import { createPost } from "@/lib/api/location-posts"
import {
  LOCAL_POST_ACTION_TYPES,
  type LocalPostActionType,
  type LocalPostTopicType,
} from "@/lib/contracts/location-posts"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import {
  localPostFormSchema,
  type LocalPostFormValues,
} from "@/lib/locations/forms/local-post"
import { POST_ACTION_LABEL } from "@/lib/locations/post-display"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

const TOPICS: ReadonlyArray<{ value: LocalPostTopicType; label: string }> = [
  { value: "STANDARD", label: "Update" },
  { value: "EVENT", label: "Event" },
  { value: "OFFER", label: "Offer" },
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
}

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
}

type Errors = Partial<
  Record<"summary" | "eventTitle" | "dates" | "redeemUrl" | "actionUrl", string>
>

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
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
function toCandidate(values: Values): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    topicType: values.topicType,
    summary: values.summary,
    media: [],
  }
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
 */
export function PostComposerSheet({
  locationId,
  disabledReason,
}: {
  locationId: string
  disabledReason: string | null
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Values>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLDivElement | null>(null)
  const pausedId = useId()
  const typeLabelId = useId()
  const datesId = useId()

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const isDirty = (Object.keys(EMPTY) as Array<keyof Values>).some(
    (key) => key !== "topicType" && String(values[key]).trim().length > 0
  )
  useDirtyGuard({
    key: `location-posts-composer-${locationId}`,
    isDirty,
    snapshot: () => JSON.stringify(values),
  })

  // After a failed save, move focus to the first field that needs fixing.
  useEffect(() => {
    if (attempt === 0) return
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus()
  }, [attempt])

  const create = useResourceMutation({
    mutationFn: (input: LocalPostFormValues) => createPost(locationId, input),
    invalidate: [queryKeys.locationPosts(locationId)],
    successToast: "Draft saved. Google is not affected.",
    errorContext: "post",
    onError: (_error, message) => setServerError(message),
    onSuccess: () => {
      setValues(EMPTY)
      setErrors({})
      setServerError(null)
      setOpen(false)
    },
  })

  const disabled = Boolean(disabledReason)
  const event = values.topicType !== "STANDARD"
  const offer = values.topicType === "OFFER"
  const summaryLength = values.summary.length

  function submit() {
    const found = validate(values)
    setErrors(found)
    setAttempt((count) => count + 1)
    if (Object.keys(found).length > 0) return
    const parsed = localPostFormSchema.safeParse(toCandidate(values))
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
      {disabled ? (
        <span
          id={pausedId}
          className="max-w-[30ch] text-caption text-warning-ink"
        >
          Paused: publishing to Google is switched off
        </span>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
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
        <SheetContent side="right" size="wide">
          <SheetHeader>
            <SheetTitle>New post</SheetTitle>
            <SheetDescription>
              Saved as a draft. Nothing reaches Google until you publish it from
              the list.
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
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={disabled || !isDirty}
              pending={create.isPending}
              pendingLabel="Saving…"
            >
              Save draft
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
