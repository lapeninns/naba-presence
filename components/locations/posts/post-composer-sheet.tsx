"use client"

import {
  ChevronDownIcon,
  ImageIcon,
  PencilIcon,
  Plus,
  UploadIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react"

import { DraftNotices } from "@/components/editors/draft-notices"
import { PostPhotoPicker } from "@/components/locations/posts/post-photo-picker"
import { PostPreview } from "@/components/locations/posts/post-preview"
import {
  postPublishGate,
  publishToast,
} from "@/components/locations/posts/post-publish"
import {
  postFormValues,
  record,
  type PostFormValues as Values,
} from "@/components/locations/posts/post-form-values"
import { Button } from "@/components/ui/button"
import { FilterChip } from "@/components/ui/chip"
import { FileCard } from "@/components/ui/file-card"
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useOutcomeToast } from "@/components/ui/toast"
import { ApiClientError, isMfaStepUpError } from "@/lib/api/client"
import {
  createPost,
  publishPost,
  updatePost,
  type Post,
} from "@/lib/api/location-posts"
import { MFA_ENROLLMENT_REQUIRED } from "@/lib/contracts/auth"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import {
  DAYS_OF_WEEK,
  LOCAL_POST_ACTION_TYPES,
  type DayOfWeek,
  type LocalPostActionType,
  type LocalPostTopicType,
} from "@/lib/contracts/location-posts"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import {
  describeActionError,
  isUnconfirmedFailure,
} from "@/lib/errors/action-errors"
import {
  localPostFormSchema,
  type LocalPostFormValues,
} from "@/lib/locations/forms/local-post"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { POST_ACTION_LABEL, postImageUrl } from "@/lib/locations/post-display"
import {
  DEFAULT_TIMEZONE,
  NO_RECURRENCE,
  WEEKDAY_SHORT,
  describeRecurrence,
  googleRecurrence,
  monthlyOptions,
  weekdayOf,
  type MonthlyRepeat,
  type PostRepeat,
} from "@/lib/locations/post-recurrence"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { cn } from "@/lib/utils"

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

/**
 * A header field row (the editor's "To / Subject" rows): the label in words
 * at the start, the value after it. Below ~360px of sheet the label stacks
 * above its value rather than squeezing it.
 */
const ROW =
  "flex flex-col gap-1 py-2 @[360px]/composer:flex-row @[360px]/composer:items-center @[360px]/composer:gap-3"
const ROW_LABEL =
  "shrink-0 text-ui font-normal text-ink-muted @[360px]/composer:w-28"
const ROW_VALUE = "flex min-w-0 flex-1 flex-col gap-1"

/** The summary limit the posts route parses with (`localPostInputSchema`). */
const SUMMARY_MAX = 1500

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
  photoUrl: "",
  ...NO_RECURRENCE,
}

/**
 * A new post's untouched form: the type picker alone, or whitespace, is not
 * something to ask about before closing.
 */
function sameNewPost(a: Values, b: Values): boolean {
  return (Object.keys(EMPTY) as Array<keyof Values>).every((key) => {
    if (key === "topicType") return true
    const left = a[key]
    const right = b[key]
    return typeof left === "string" && typeof right === "string"
      ? left.trim() === right.trim()
      : JSON.stringify(left) === JSON.stringify(right)
  })
}

/** A stashed draft back into the fields, or null when its shape is not ours. */
function parseValues(value: unknown): Values | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const stashed = value as Record<string, unknown>
  // A draft stashed before the photo row existed has no `photoUrl`.
  const withPhoto: Record<string, unknown> = { photoUrl: "", ...stashed }
  const fits = (Object.keys(EMPTY) as Array<keyof Values>).every((key) =>
    Array.isArray(EMPTY[key])
      ? Array.isArray(withPhoto[key])
      : typeof withPhoto[key] === typeof EMPTY[key]
  )
  if (!fits) return null
  return Object.fromEntries(
    Object.keys(EMPTY).map((key) => [key, withPhoto[key]])
  ) as Values
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
    // A photo chosen here is the post's photo; none chosen keeps the saved
    // post's own.
    media: values.photoUrl ? [{ sourceUrl: values.photoUrl }] : keptMedia(post),
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

/** A save refused because someone else saved the post after it was opened. */
function isPostChanged(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "post_changed"
}

/**
 * A failed save, in words. A stale edit says what happened and what to do:
 * the refetched post raises the "Load theirs / Keep mine" notice above the
 * fields, and the edits stay where they are.
 */
function saveErrorCopy(error: unknown): string {
  return isPostChanged(error)
    ? "Someone else saved this post while you were editing. Your edits are still here: choose whose version to keep, then save again."
    : describeActionError(error, { context: "post" })
}

/**
 * A publish held for two-step verification. The check runs before the
 * publish itself (the route's `mfa: "step_up"`), so nothing was sent to
 * Google; `saved` says the post was saved first and waits in the list.
 */
function stepUpCopy(error: ApiClientError, saved: boolean): string {
  if (error.code === MFA_ENROLLMENT_REQUIRED)
    return saved
      ? "Publishing needs two-step verification set up first, so nothing was sent to Google. The post is kept in NabaPresence: publish it from the list once it’s set up."
      : "Set up two-step verification, then publish again. Nothing was sent to Google."
  return saved
    ? "Publishing needs you to confirm it’s you first, so nothing was sent to Google. The post is kept in NabaPresence: publish it from the list once you’ve confirmed."
    : "Confirm it’s you, then publish again. Nothing was sent to Google."
}

/**
 * Writing a post, with the result visible while you write it (reference
 * `#composer`): the type as a segmented control, the event or offer title
 * and dates, the text with its counter, an optional button, and a preview
 * beside the fields on a wide sheet (below them on a phone).
 *
 * "Save draft" keeps the post in NabaPresence only. Where the caller says
 * what the person may do (`caps`), the footer's primary is "Publish to
 * Google" (or "Request approval" when they cannot publish), and it is only
 * ever drawn with the consent line beside it saying what goes to Google:
 * there is no separate confirm step, so that line is the consent.
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
  openRef,
  caps,
  writesEnabled = true,
}: {
  locationId: string
  disabledReason: string | null
  /** The saved draft or failed post to edit. Omit to write a new one. */
  post?: Post
  /** The listing's IANA timezone: a repeat's last day ends at its midnight. */
  timezone?: string
  /**
   * Opened from somewhere else (a post's "More actions" menu): the sheet
   * draws no trigger of its own and hands back an `open()` instead.
   */
  openRef?: React.Ref<{ open: () => void }>
  /**
   * The person's capabilities on this listing. Without them the composer
   * only saves drafts; with them it can also publish (or ask for approval).
   */
  caps?: LocationCapabilities
  /** The Google publish pause: off means nothing can be sent. */
  writesEnabled?: boolean
}) {
  const editing = Boolean(post)
  const queryClient = useQueryClient()
  const outcomeToast = useOutcomeToast()
  const [open, setOpen] = useState(false)
  // The fields start from the saved post (or an empty one) and follow it
  // when it changes, without overwriting unsaved edits: a newer save by
  // someone else is offered, as are edits stashed when the page was left.
  const editor = useEditorDraft<Values>({
    initial: post ? postFormValues(post, timezone) : EMPTY,
    revision: post ? post.updatedAt : "new",
    scope: post
      ? {
          resource: "location-post-edit",
          resourceId: `${locationId}/${post.id}`,
          schemaVersion: 1,
        }
      : {
          resource: "location-post-new",
          resourceId: locationId,
          schemaVersion: 1,
        },
    parseStashed: parseValues,
    isEqual: post ? undefined : sameNewPost,
  })
  const values = editor.draft
  const setValues = editor.setDraft
  const isDirty = editor.isDirty
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLDivElement | null>(null)
  const typeLabelId = useId()
  const datesId = useId()
  const repeatId = useId()
  const weekdaysLabelId = useId()
  const mediaLabelId = useId()
  const photoLabelId = useId()
  const previewId = useId()
  const disabledReasonId = useId()
  const saveReasonId = useId()
  const consentId = useId()
  const [photoOpen, setPhotoOpen] = useState(false)
  // The picker reads the listing's photos from Google, so it mounts the
  // first time it is asked for, not with the composer.
  const [photoMounted, setPhotoMounted] = useState(false)
  if (photoOpen && !photoMounted) setPhotoMounted(true)
  // On a phone the preview waits under the fields until asked for.
  const [previewOpen, setPreviewOpen] = useState(true)
  // A saved post's own photos are kept as they are unless one is chosen
  // here, which replaces them; the strip is read-only.
  // Thumbnails follow the list's rule: Google's copy first, http(s) only.
  const thumbnails = (post && Array.isArray(post.media) ? post.media : [])
    .map((entry) => postImageUrl({ media: [entry] }))
    .filter((url): url is string => url !== null)

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  // Closing with unsaved edits asks first (the sheet's own `dirty` guard:
  // Escape, a tap outside, a swipe down, the ✕ and Cancel); discarding puts
  // the fields back to the saved post.
  const discard = () => {
    editor.discard()
    setErrors({})
    setServerError(null)
  }
  useImperativeHandle(openRef, () => ({ open: () => setOpen(true) }), [])

  // After a failed save, move focus to the first field that needs fixing.
  useEffect(() => {
    if (attempt === 0) return
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus()
  }, [attempt])

  // Refetch the list now rather than at its next refetch: after a stale
  // edit, the newer save raises the "Load theirs / Keep mine" notice.
  const refetchPosts = () =>
    void queryClient.invalidateQueries({
      queryKey: queryKeys.locationPosts(locationId),
    })

  const create = useResourceMutation({
    mutationFn: async (input: LocalPostFormValues): Promise<unknown> => {
      if (!post) return createPost(locationId, input)
      const saved = await updatePost(locationId, post.id, input, post.updatedAt)
      // Only a save that went through is this editor's own: a refused one
      // must leave a colleague's newer save to the notice, not follow it
      // silently over the edits.
      editor.expectSave()
      return saved
    },
    invalidate: [queryKeys.locationPosts(locationId)],
    successToast: post
      ? "Draft updated. Google is not affected."
      : "Draft saved. Google is not affected.",
    errorContext: "post",
    errorToast: saveErrorCopy,
    onError: (error, message) => {
      setServerError(message)
      if (isPostChanged(error)) refetchPosts()
    },
    onSuccess: () => {
      // A new post's fields empty for the next one; an edit keeps the saved
      // values until the refetched post (its own save) replaces them.
      if (!post) editor.discard()
      setErrors({})
      setServerError(null)
      setOpen(false)
    },
  })

  // Publish from the composer: save the post, then publish it. A save that
  // went through stays saved if the publish does not, so the person keeps
  // the post and the list offers the retry. (Only the publish step carries
  // the intent; a lost answer to the save itself can leave a second draft,
  // as the plain Save draft can.)
  const savedBeforeFailure = useRef(false)
  const publish = useResourceMutation({
    mutationFn: async (
      input: LocalPostFormValues | null,
      intent
    ): Promise<Awaited<ReturnType<typeof publishPost>>> => {
      let postId = post?.id
      // The revision this person saved, or had on screen for an unchanged
      // draft: publish refuses a post that has moved on since, so what goes
      // to Google is what the consent line above the button covered.
      let revision = post?.contentRevision
      if (input) {
        if (post) {
          const saved = await updatePost(
            locationId,
            post.id,
            input,
            post.updatedAt
          )
          editor.expectSave()
          // A post that was already live is republished by the save itself:
          // its answer is the outcome, and there is nothing left to publish.
          if (!("post" in saved)) return saved
          revision = saved.post.contentRevision
        } else {
          const created = await createPost(locationId, input)
          postId = created.post.id
          revision = created.post.contentRevision
        }
      }
      if (!postId) throw new Error("There is no post to publish.")
      savedBeforeFailure.current = true
      const result = await publishPost(locationId, postId, {
        intentId: intent.intentId,
        expectedRevision: revision,
      })
      savedBeforeFailure.current = false
      return result
    },
    // An unchanged saved draft publishes as it is; anything else is its own
    // action, so an edit never reuses an earlier attempt's intent.
    intentKey: (input) => [post?.id ?? "new", input],
    invalidate: [queryKeys.locationPosts(locationId)],
    errorContext: "post",
    errorToast: (error) => {
      // Held for two-step verification: the person may publish, and nothing
      // went to Google, so "You do not have permission" would be wrong.
      if (isMfaStepUpError(error))
        return stepUpCopy(error, savedBeforeFailure.current)
      // Nothing saved yet: the save's own refusal.
      if (!savedBeforeFailure.current) return saveErrorCopy(error)
      const reason = describeActionError(error, { context: "post" })
      // Only a definite refusal says the post is kept here: after a lost
      // answer Google may hold it, and the message above already says to
      // check the list before changing it.
      return !isUnconfirmedFailure(error)
        ? `${reason} The post is kept in NabaPresence, not lost.`
        : reason
    },
    onSuccess: (result) => {
      if (!post) editor.discard()
      setErrors({})
      setServerError(null)
      setOpen(false)
      outcomeToast.show(publishToast(result))
    },
    onError: (error, message) => {
      if (!savedBeforeFailure.current) {
        setServerError(message)
        if (isPostChanged(error)) refetchPosts()
        return
      }
      // Saved, not published: the draft is in the list with its own retry.
      savedBeforeFailure.current = false
      if (!post) editor.discard()
      setErrors({})
      setServerError(null)
      setOpen(false)
      refetchPosts()
    },
  })

  const gate = caps ? postPublishGate(caps, writesEnabled) : null
  const publishLabel = gate?.requestApproval
    ? "Request approval"
    : post?.status === "failed"
      ? "Retry publish"
      : "Publish to Google"
  // Adding a new photo goes through the library's own flow, which writes to
  // Google; choosing one Google already has does not.
  const addPhotoReason = resourceDisabledReason(caps, "media", writesEnabled)

  const disabled = Boolean(disabledReason)
  // Why Save is off, in words. A disabled composer's reason is the note in
  // the body; otherwise Save waits for a change (the condition on the
  // button below), and the footer says so.
  const saveReason =
    disabled || isDirty
      ? null
      : editing
        ? "No changes to save yet."
        : "Write the post first."
  // The footer note names the button it is about.
  const saveLabel = editing ? "Save changes" : "Save draft"
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

  /** The fields checked and parsed for the route, or null with the reason shown. */
  function parsedInput(needsText: boolean): LocalPostFormValues | null {
    const found = validate(values)
    if (
      needsText &&
      !values.summary.trim() &&
      !values.photoUrl &&
      keptMedia(post).length === 0
    )
      found.summary = "Write something, or add a photo, before publishing."
    setErrors(found)
    setAttempt((count) => count + 1)
    if (Object.keys(found).length > 0) return null
    const parsed = localPostFormSchema.safeParse(
      toCandidate(values, timezone, post)
    )
    if (!parsed.success) {
      setServerError(
        parsed.error.issues[0]?.message ?? "Please complete the post."
      )
      return null
    }
    setServerError(null)
    return parsed.data
  }

  function submit() {
    const input = parsedInput(false)
    if (!input) return
    create.mutate(input)
  }

  function submitPublish() {
    // A saved draft with nothing changed publishes as it is.
    if (post && !isDirty) {
      setServerError(null)
      publish.mutate(null)
      return
    }
    const input = parsedInput(true)
    if (!input) return
    publish.mutate(input)
  }

  // The trigger carries no reason of its own: the list's banner says why
  // composing is off (paused publishing, or a role that can only look), and
  // the reason is repeated inside the sheet.
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      dirty={isDirty}
      onDiscard={discard}
      discardPrompt={{
        title: "Close without saving?",
        confirmLabel: "Close and discard",
        description: editing
          ? "Your edits to this post aren’t saved. Closing throws them away and keeps the saved draft. Google is not affected."
          : "This post isn’t saved. Closing throws it away. Google is not affected.",
      }}
    >
      {openRef ? null : editing ? (
        <SheetTrigger
          render={<Button size="sm" variant="ghost" disabled={disabled} />}
        >
          <PencilIcon aria-hidden />
          Edit
        </SheetTrigger>
      ) : (
        <SheetTrigger render={<Button disabled={disabled} />}>
          <Plus aria-hidden />
          New post
        </SheetTrigger>
      )}
      <SheetContent side="right" size="wide">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit post" : "New post"}</SheetTitle>
        </SheetHeader>

        <SheetBody className="@container/composer">
          <DraftNotices drafts={[editor]} noun="this post" />
          <div className="flex flex-col items-start gap-6 @[760px]/composer:flex-row">
            <div ref={formRef} className="flex w-full min-w-0 flex-1 flex-col">
              {/* Header fields: borderless rows, each with its label in
                  words at the start (stacked above the value when the
                  sheet is narrow), separated by a faint hairline. */}
              <div className="flex flex-col divide-y divide-line-subtle">
                <div className={ROW}>
                  <span id={typeLabelId} className={ROW_LABEL}>
                    Type
                  </span>
                  <div className={ROW_VALUE}>
                    <SegmentedControl
                      semantics="radio"
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
                </div>

                {event ? (
                  <Field error={errors.eventTitle} className={ROW}>
                    <FieldLabel className={ROW_LABEL}>
                      {offer ? "Offer title" : "Event title"}
                    </FieldLabel>
                    <div className={ROW_VALUE}>
                      <Input
                        value={values.eventTitle}
                        onChange={(e) => set("eventTitle", e.target.value)}
                        disabled={disabled}
                        autoComplete="off"
                      />
                      <FieldError>{errors.eventTitle}</FieldError>
                    </div>
                  </Field>
                ) : null}

                {event ? (
                  <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0">
                    <legend className="sr-only">
                      When it runs (optional for a draft)
                    </legend>
                    <div className="flex flex-col divide-y divide-line-subtle">
                      <Field className={ROW}>
                        <FieldLabel className={ROW_LABEL}>Starts</FieldLabel>
                        <div className={cn(ROW_VALUE, "flex-row gap-2")}>
                          <Input
                            type="date"
                            value={values.startDate}
                            onChange={(e) => set("startDate", e.target.value)}
                            disabled={disabled}
                            aria-invalid={errors.dates ? true : undefined}
                            aria-describedby={datesId}
                            className={"flex-[1.3]"}
                          />
                          <Field className="min-w-0 flex-1">
                            <FieldLabel className="sr-only">
                              Start time
                            </FieldLabel>
                            <Input
                              type="time"
                              value={values.startTime}
                              onChange={(e) => set("startTime", e.target.value)}
                              disabled={disabled}
                            />
                          </Field>
                        </div>
                      </Field>
                      <Field className={ROW}>
                        <FieldLabel className={ROW_LABEL}>Ends</FieldLabel>
                        <div className={cn(ROW_VALUE, "flex-row gap-2")}>
                          <Input
                            type="date"
                            value={values.endDate}
                            min={values.startDate || undefined}
                            onChange={(e) => set("endDate", e.target.value)}
                            disabled={disabled}
                            aria-invalid={errors.dates ? true : undefined}
                            aria-describedby={datesId}
                            className={"flex-[1.3]"}
                          />
                          <Field className="min-w-0 flex-1">
                            <FieldLabel className="sr-only">
                              End time
                            </FieldLabel>
                            <Input
                              type="time"
                              value={values.endTime}
                              onChange={(e) => set("endTime", e.target.value)}
                              disabled={disabled}
                            />
                          </Field>
                        </div>
                      </Field>
                    </div>
                    {errors.dates ? (
                      <p
                        id={datesId}
                        role="alert"
                        className="pb-2.5 text-caption font-medium text-danger-ink"
                      >
                        {errors.dates}
                      </p>
                    ) : (
                      <p
                        id={datesId}
                        className="pb-2.5 text-caption text-ink-muted"
                      >
                        Optional for a draft. Times are the listing’s local
                        time. Without a time, the post runs all day.
                      </p>
                    )}
                  </fieldset>
                ) : null}

                {event ? (
                  <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0">
                    <legend className="sr-only">Repeat</legend>
                    <div className="flex flex-col divide-y divide-line-subtle">
                      <Field className={ROW}>
                        <FieldLabel className={ROW_LABEL}>Repeats</FieldLabel>
                        <div className={ROW_VALUE}>
                          <Select
                            value={values.repeat}
                            onValueChange={(next) =>
                              changeRepeat(next as PostRepeat)
                            }
                            disabled={disabled}
                          >
                            <SelectTrigger
                              className={"w-full"}
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
                            <SelectContent title="Repeats">
                              {REPEATS.map((entry) => (
                                <SelectItem
                                  key={entry.value}
                                  value={entry.value}
                                >
                                  {entry.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </Field>
                      {values.repeat !== "none" ? (
                        <Field className={ROW}>
                          <FieldLabel optional className={ROW_LABEL}>
                            Last repeat
                          </FieldLabel>
                          <div className={ROW_VALUE}>
                            <Input
                              type="date"
                              value={values.seriesEnd}
                              min={values.startDate || undefined}
                              onChange={(e) => set("seriesEnd", e.target.value)}
                              disabled={disabled}
                              aria-invalid={errors.repeat ? true : undefined}
                              aria-describedby={repeatId}
                            />
                          </div>
                        </Field>
                      ) : null}
                      {values.repeat === "weekly" ? (
                        <div className={ROW}>
                          <span id={weekdaysLabelId} className={ROW_LABEL}>
                            On
                          </span>
                          <div
                            role="group"
                            aria-labelledby={weekdaysLabelId}
                            className={cn(
                              ROW_VALUE,
                              "flex-row flex-wrap gap-2"
                            )}
                          >
                            {DAYS_OF_WEEK.map((day) => (
                              <FilterChip
                                key={day}
                                pressed={values.weekdays.includes(day)}
                                onClick={() => toggleWeekday(day)}
                                disabled={disabled}
                              >
                                {WEEKDAY_SHORT[day]}
                              </FilterChip>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {values.repeat === "monthly" ? (
                        <Field className={ROW}>
                          <FieldLabel className={ROW_LABEL}>
                            Each month
                          </FieldLabel>
                          <div className={ROW_VALUE}>
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
                              <SelectTrigger className={"w-full"}>
                                <SelectValue>
                                  {(value: string | null) =>
                                    monthly.find(
                                      (entry) => entry.value === value
                                    )?.label ?? monthly[0].label
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent title="Each month">
                                {monthly.map((entry) => (
                                  <SelectItem
                                    key={entry.value}
                                    value={entry.value}
                                  >
                                    {entry.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </Field>
                      ) : null}
                    </div>
                    {errors.repeat ? (
                      <p
                        id={repeatId}
                        role="alert"
                        className="pb-2.5 text-caption font-medium text-danger-ink"
                      >
                        {errors.repeat}
                      </p>
                    ) : values.repeat !== "none" ? (
                      <p
                        id={repeatId}
                        className="pb-2.5 text-caption text-ink-muted"
                      >
                        {recurrenceText ||
                          "Set the start date to see when it repeats."}
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}

                {offer ? (
                  <>
                    <Field className={ROW}>
                      <FieldLabel optional className={ROW_LABEL}>
                        Voucher code
                      </FieldLabel>
                      <div className={ROW_VALUE}>
                        <Input
                          value={values.couponCode}
                          onChange={(e) => set("couponCode", e.target.value)}
                          disabled={disabled}
                          maxLength={100}
                          autoComplete="off"
                        />
                      </div>
                    </Field>
                    <Field error={errors.redeemUrl} className={ROW}>
                      <FieldLabel optional className={ROW_LABEL}>
                        Redeem online link
                      </FieldLabel>
                      <div className={ROW_VALUE}>
                        <Input
                          type="url"
                          inputMode="url"
                          placeholder="https://"
                          value={values.redeemUrl}
                          onChange={(e) => set("redeemUrl", e.target.value)}
                          disabled={disabled}
                        />
                        <FieldError>{errors.redeemUrl}</FieldError>
                      </div>
                    </Field>
                    <Field className={ROW}>
                      <FieldLabel optional className={ROW_LABEL}>
                        Terms
                      </FieldLabel>
                      <div className={ROW_VALUE}>
                        <Input
                          value={values.terms}
                          onChange={(e) => set("terms", e.target.value)}
                          disabled={disabled}
                        />
                      </div>
                    </Field>
                  </>
                ) : null}
              </div>

              {/* One hairline between the header fields and the body. */}
              <Field
                error={errors.summary}
                className="mt-1 gap-1 border-t border-line pt-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <FieldLabel className="font-normal text-ink-muted">
                    Summary
                  </FieldLabel>
                  <FieldCounter
                    over={summaryLength > SUMMARY_MAX}
                    count={summaryLength}
                    max={SUMMARY_MAX}
                  >
                    {summaryLength.toLocaleString("en-GB")} /{" "}
                    {SUMMARY_MAX.toLocaleString("en-GB")}
                  </FieldCounter>
                </div>
                <Textarea
                  value={values.summary}
                  onChange={(e) => set("summary", e.target.value)}
                  autoSize
                  minRows={5}
                  maxRows={16}
                  disabled={disabled}
                  aria-label="Post summary"
                />
                <FieldError>{errors.summary}</FieldError>
              </Field>

              {thumbnails.length > 0 ? (
                <div className="flex flex-col gap-2 border-t border-line-subtle py-3">
                  <span id={mediaLabelId} className="text-ui text-ink-muted">
                    Photos
                  </span>
                  <ul
                    aria-labelledby={mediaLabelId}
                    className="flex gap-2 overflow-x-auto pb-1"
                  >
                    {thumbnails.map((url, index) => (
                      <li
                        key={`${url}-${index}`}
                        className="size-16 shrink-0 overflow-hidden rounded-(--np-radius-control) border border-line bg-fill"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- a remote Google/merchant URL shown as-is */}
                        <img
                          src={url}
                          alt={`Photo ${index + 1} of ${thumbnails.length}`}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      </li>
                    ))}
                  </ul>
                  <span className="text-caption text-ink-muted">
                    {values.photoUrl
                      ? "Replaced by the photo you chose."
                      : "Kept as they are unless you choose another."}
                  </span>
                </div>
              ) : null}

              <div className="flex flex-col divide-y divide-line-subtle border-t border-line-subtle">
                <div className={ROW}>
                  <span id={photoLabelId} className={ROW_LABEL}>
                    Photo
                  </span>
                  <div className={ROW_VALUE}>
                    {values.photoUrl ? (
                      <ul aria-labelledby={photoLabelId}>
                        <FileCard
                          name="Photo for this post"
                          previewUrl={values.photoUrl}
                          state="Goes to Google with the post"
                          onRemove={
                            disabled ? undefined : () => set("photoUrl", "")
                          }
                          removeLabel="Remove the photo"
                        />
                      </ul>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="self-start"
                      onClick={() => setPhotoOpen(true)}
                      disabled={disabled}
                      aria-describedby={photoLabelId}
                    >
                      <ImageIcon aria-hidden />
                      {values.photoUrl || thumbnails.length > 0
                        ? "Change photo"
                        : "Add photo"}
                    </Button>
                  </div>
                </div>
                <Field className={ROW}>
                  <FieldLabel optional className={ROW_LABEL}>
                    Button
                  </FieldLabel>
                  <div className={ROW_VALUE}>
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
                      <SelectTrigger className={"w-full"}>
                        <SelectValue>
                          {(value: string | null) =>
                            value && value !== "NONE"
                              ? POST_ACTION_LABEL[value as LocalPostActionType]
                              : "No button"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent title="Button">
                        <SelectItem value="NONE">No button</SelectItem>
                        {LOCAL_POST_ACTION_TYPES.map((action) => (
                          <SelectItem key={action} value={action}>
                            {POST_ACTION_LABEL[action]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {values.action === "CALL" ? (
                      <p className="text-caption text-ink-muted">
                        Call now uses the listing’s phone number on Google.
                      </p>
                    ) : null}
                  </div>
                </Field>
                {values.action && values.action !== "CALL" ? (
                  <Field error={errors.actionUrl} className={ROW}>
                    <FieldLabel className={ROW_LABEL}>Button link</FieldLabel>
                    <div className={ROW_VALUE}>
                      <Input
                        type="url"
                        inputMode="url"
                        placeholder="https://"
                        value={values.actionUrl}
                        onChange={(e) => set("actionUrl", e.target.value)}
                        disabled={disabled}
                      />
                      <FieldError>{errors.actionUrl}</FieldError>
                    </div>
                  </Field>
                ) : null}
              </div>

              {disabledReason ? (
                <p
                  id={disabledReasonId}
                  role="note"
                  className="pt-3 text-caption text-ink-muted"
                >
                  {disabledReason}
                </p>
              ) : null}
            </div>

            {/* The preview: beside the fields on a wide sheet; on a phone a
                disclosure under them, collapsed until asked for. It stays
                in the page either way, so it always follows the fields. */}
            <div className="flex w-full min-w-0 flex-col gap-2 @[760px]/composer:sticky @[760px]/composer:top-0 @[760px]/composer:w-75 @[760px]/composer:shrink-0">
              <button
                type="button"
                aria-expanded={previewOpen}
                aria-controls={previewId}
                onClick={() => setPreviewOpen((current) => !current)}
                className="flex min-h-(--np-touch) w-full items-center justify-between gap-2 rounded-(--np-radius-control) border-t border-line-subtle text-ui text-ink focus-halo @[760px]/composer:hidden"
              >
                Preview
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    "size-4 text-ink-muted transition-transform motion-reduce:transition-none",
                    previewOpen && "rotate-180"
                  )}
                />
              </button>
              {/* Named once: by the toggle on a phone and by the preview's
                  own caption, not by a landmark as well. */}
              <div
                id={previewId}
                className={cn(
                  "min-w-0 flex-col gap-2 @[760px]/composer:flex",
                  previewOpen ? "flex" : "hidden"
                )}
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
                  imageUrl={
                    values.photoUrl || (post ? postImageUrl(post) : null)
                  }
                />
                <span className="text-caption text-ink-muted">
                  An illustration. Google decides the final layout.
                </span>
              </div>
            </div>
          </div>
        </SheetBody>

        <SheetFooter className="sm:items-center">
          {/* Shown at every width: on a phone it wraps above the buttons. */}
          <div className="flex min-w-0 flex-col gap-1 text-caption text-pretty text-ink-muted sm:mr-auto sm:flex-1">
            {/* A refused save or publish, beside the button that was
                pressed rather than at the end of the fields. */}
            {serverError ? (
              <p role="alert" className="text-ui text-danger-ink">
                {serverError}
              </p>
            ) : null}
            {saveReason ? <p id={saveReasonId}>{saveReason}</p> : null}
            {gate ? (
              // The consent. It is drawn by the same condition as the
              // Publish button below, so the button never appears without it.
              <p
                id={consentId}
                data-slot="publish-consent"
                className="text-ui text-ink"
              >
                {gate.requestApproval
                  ? "Request approval saves this post and asks an approver. Nothing reaches Google until they approve it."
                  : `${publishLabel} sends this ${
                      values.topicType === "OFFER"
                        ? "offer"
                        : values.topicType === "EVENT"
                          ? "event"
                          : "update"
                    }${values.photoUrl || thumbnails.length > 0 ? ", with its photo," : ""} to your Google listing now. Customers see it as soon as Google accepts it.`}
              </p>
            ) : null}
            <p>
              {post?.status === "failed"
                ? `${saveLabel} turns it back into a draft. Nothing reaches Google until you publish it.`
                : `${saveLabel} keeps it here only. Google is not affected.`}
            </p>
          </div>
          <Button
            variant={gate ? "secondary" : "default"}
            onClick={submit}
            disabled={disabled || !isDirty || publish.isPending}
            aria-describedby={
              disabled
                ? disabledReasonId
                : saveReason
                  ? saveReasonId
                  : undefined
            }
            pending={create.isPending}
            pendingLabel="Saving…"
          >
            {saveLabel}
          </Button>
          {gate ? (
            <Button
              onClick={submitPublish}
              disabled={disabled || (!post && !isDirty) || create.isPending}
              disabledReason={gate.reason ?? undefined}
              // The consent first, always; then why it is off, as for Save.
              aria-describedby={[
                consentId,
                disabled
                  ? disabledReasonId
                  : !post && saveReason
                    ? saveReasonId
                    : null,
              ]
                .filter(Boolean)
                .join(" ")}
              pending={publish.isPending}
              pendingLabel={
                gate.requestApproval ? "Requesting…" : "Publishing…"
              }
            >
              {gate.requestApproval ? null : <UploadIcon aria-hidden />}
              {publishLabel}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
      {photoMounted ? (
        <PostPhotoPicker
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          locationId={locationId}
          chosenUrl={values.photoUrl}
          onChoose={(url) => set("photoUrl", url)}
          addReason={addPhotoReason}
        />
      ) : null}
    </Sheet>
  )
}
