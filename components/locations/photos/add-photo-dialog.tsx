"use client"

import {
  CameraIcon,
  CircleAlertIcon,
  ImagesIcon,
  LinkIcon,
  RotateCcwIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { GateNote } from "@/components/locations/publish-gate"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { FileCard, formatFileSize } from "@/components/ui/file-card"
import { Input } from "@/components/ui/input"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { answerOutcome, describeOutcome } from "@/lib/editors/outcome"
import {
  ApiClientError,
  isMfaStepUpError,
  MFA_STEP_UP_EVENT,
  type MfaStepUpEventDetail,
} from "@/lib/api/client"
import {
  createMediaFromUrl,
  uploadMediaFile,
  type MediaCategory,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MIN_PHOTO_UPLOAD_BYTES,
} from "@/lib/contracts/location-media"
import { MFA_ENROLLMENT_REQUIRED } from "@/lib/contracts/wire-codes"
import {
  describeActionError,
  isUnconfirmedFailure,
} from "@/lib/errors/action-errors"
import { humaniseCategory } from "@/lib/locations/media-labels"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { cn } from "@/lib/utils"

const ACCEPTED_TYPES = ["image/jpeg", "image/png"]
const MB = 1024 * 1024

type UploadStatus =
  "invalid" | "ready" | "uploading" | "sent" | "done" | "unconfirmed" | "failed"

type UploadEntry = {
  key: string
  /** Sent as Idempotency-Key; kept after a lost response so a retry cannot upload twice. */
  intent: string
  /**
   * The category a kept intent was sent with. A retry resends it, so the
   * same intent always carries the same request, whatever the picker says
   * now.
   */
  sentCategory?: MediaCategory
  file: File
  status: UploadStatus
  progress: number
  error?: string
  code?: string
  /** An object URL for the thumbnail; revoked when the entry goes. */
  previewUrl?: string
}

/** The rules the upload route enforces, stated once for picker and drop. */
function checkFile(file: File): string | undefined {
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name))
    return "HEIC photos aren’t supported. Choose a JPEG or PNG, or set the camera to save JPEG (on an iPhone: Settings › Camera › Formats › Most Compatible)."
  if (!ACCEPTED_TYPES.includes(file.type))
    return `This file type isn’t supported (${file.type || "unknown type"}). Choose a JPEG or PNG.`
  if (file.size > MAX_MEDIA_UPLOAD_BYTES)
    return `Too large at ${formatFileSize(file.size)}. Uploads can be up to ${MAX_MEDIA_UPLOAD_BYTES / MB} MB.`
  if (file.size < MIN_PHOTO_UPLOAD_BYTES)
    return `Too small at ${formatFileSize(file.size)}. Google needs photos of at least ${MIN_PHOTO_UPLOAD_BYTES / 1024} KB.`
  return undefined
}

/**
 * Refusals that would answer every file the same way: the run stops at the
 * first and says it once. Each is the route's or the write gate's answer
 * before anything is claimed, so nothing of this file went to Google.
 */
const RUN_REFUSALS = new Set([
  "listing_change_upload_unsupported",
  "media_paused",
  "publish_not_allowed",
])

function runRefusal(error: unknown): string | null {
  if (isMfaStepUpError(error))
    return error.code === MFA_ENROLLMENT_REQUIRED
      ? "Uploads need two-step verification. Set it up, then tap Upload again. The photos marked Ready weren’t sent to Google."
      : "Confirm it’s you with your two-step code, then tap Upload again. The photos marked Ready weren’t sent to Google."
  if (!(error instanceof ApiClientError) || !RUN_REFUSALS.has(error.code))
    return null
  if (error.code === "listing_change_upload_unsupported")
    return "Uploads can’t be sent for approval yet, so the photos marked Ready weren’t sent to Google. Import the photo from a public link instead."
  return `${describeActionError(error)} The photos marked Ready weren’t sent to Google.`
}

/**
 * Unconfirmed answers a retry must not resend: the server is waiting on a
 * person's verdict, or another create of the same photo is still running
 * (sent again once that lands, it would be a second copy).
 */
const NO_RETRY_CODES = new Set([
  "media_needs_resolution",
  "media_create_in_progress",
])

/** "1 sent · 2 ready · 1 not confirmed", leaving out the parts that are zero. */
function summaryParts(counts: {
  done: number
  ready: number
  unsure: number
  cannot: number
  uploading: boolean
}): string[] {
  return [
    counts.done > 0 ? `${counts.done} sent` : null,
    counts.ready > 0
      ? `${counts.ready} ${counts.uploading ? "still to send" : "ready"}`
      : null,
    counts.unsure > 0 ? `${counts.unsure} not confirmed` : null,
    counts.cannot > 0 ? `${counts.cannot} can’t upload` : null,
  ].filter((part): part is string => part !== null)
}

function previewFor(file: File): string | undefined {
  if (!ACCEPTED_TYPES.includes(file.type)) return undefined
  if (typeof URL.createObjectURL !== "function") return undefined
  return URL.createObjectURL(file)
}

function revoke(entries: readonly UploadEntry[]) {
  for (const entry of entries)
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
}

const STATUS_PILL: Record<
  UploadStatus,
  { tone: "ok" | "bad" | "info" | "outline"; label: string }
> = {
  invalid: { tone: "bad", label: "Can’t upload" },
  ready: { tone: "outline", label: "Ready" },
  uploading: { tone: "info", label: "Uploading" },
  // The route answered but did not report the write as succeeded (an
  // idempotent replay reports the earlier attempt's own status).
  sent: { tone: "info", label: "Sent to Google" },
  done: { tone: "ok", label: describeOutcome("confirmed_applied").label },
  // The upload got no answer or Google's media needs resolving
  // (errorOutcome `uncertain`): it may exist at Google, so not "Failed".
  unconfirmed: { tone: "info", label: describeOutcome("uncertain").label },
  failed: { tone: "bad", label: describeOutcome("failed").label },
}

/**
 * "Add photos" (reference `#upload`): pick a Google category, then take a
 * photo with the camera, choose JPEG/PNG files from the library (or, at a
 * desk, drop them), or import one photo from a public URL. The chosen files
 * list in the same sheet under the category, and one primary, "Upload N
 * photos", sends them.
 *
 * Each file is checked against the upload route's own rules before it can
 * be sent, and each upload is its own request, so one refusal from Google
 * leaves the others alone and names its own reason and code. Only real
 * outcomes are shown: "On Google" is the route reporting the write as
 * succeeded.
 *
 * A file that failed or was not confirmed offers Try again. A failure
 * already freed a new intent; an unconfirmed upload resends its kept one
 * (and its category), so the server answers from the first attempt's
 * receipt rather than adding the photo twice. A refusal that would answer
 * every file alike (two-step verification due, approvals, paused, no
 * permission) stops the run and is said once. When nothing is left to send
 * the primary becomes Done, in place, so focus stays on it.
 */
export function AddPhotoDialog({
  open,
  onOpenChange,
  locationId,
  categories,
  writeReason,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  locationId: string
  categories: readonly MediaCategory[]
  writeReason: string | null
  /** Called after a successful add, to re-read the library from Google. */
  onAdded: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const cameraRef = useRef<HTMLInputElement | null>(null)
  const toasts = useToastManager()
  const hintId = useId()
  const [category, setCategory] = useState<MediaCategory>(
    categories.includes("ADDITIONAL")
      ? "ADDITIONAL"
      : (categories[0] as MediaCategory)
  )
  const [url, setUrl] = useState("")
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Why the last run stopped early, said once above the files.
  const [stopped, setStopped] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const urlErrorId = useId()
  const disabled = Boolean(writeReason)

  // Thumbnails are object URLs: release every one still held on unmount.
  const held = useRef<UploadEntry[]>([])
  useEffect(() => {
    held.current = entries
  }, [entries])
  useEffect(() => () => revoke(held.current), [])

  const addUrl = useResourceMutation<MediaMutationResult>({
    mutationFn: (_: void, intent) =>
      createMediaFromUrl(
        locationId,
        {
          mediaFormat: "PHOTO",
          category,
          sourceUrl: url,
        },
        { intentId: intent.intentId }
      ),
    intentKey: () => [category, url],
    invalidate: onAdded,
    // Beside the field as well as in the toast, which a phone may draw
    // over the footer.
    onError: (_error, message) => setUrlError(message),
    successToast: (result) => {
      const outcome = answerOutcome(result)
      return {
        outcome,
        title:
          outcome === "confirmed_applied"
            ? "Photo added on Google"
            : "Photo sent to Google",
      }
    },
    onSuccess: () => {
      setUrl("")
      onOpenChange(false)
    },
    onParked: () => {
      setUrl("")
      onOpenChange(false)
    },
  })

  const ready = entries.filter((entry) => entry.status === "ready")
  const done = entries.filter(
    (entry) => entry.status === "done" || entry.status === "sent"
  ).length
  const cannot = entries.filter(
    (entry) => entry.status === "invalid" || entry.status === "failed"
  ).length
  const unsure = entries.filter(
    (entry) => entry.status === "unconfirmed"
  ).length
  const summary = summaryParts({
    done,
    ready: ready.length,
    unsure,
    cannot,
    uploading,
  })
  // Something went through an upload and nothing is left to send: the run
  // is over, and the one primary says so rather than going dead.
  const finished =
    !uploading &&
    ready.length === 0 &&
    url.trim().length === 0 &&
    entries.some(
      (entry) => entry.status !== "invalid" && entry.status !== "ready"
    )

  function patch(key: string, next: Partial<UploadEntry>) {
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key ? { ...entry, ...next } : entry
      )
    )
  }

  function acceptFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const added = Array.from(list).map((file, index) => {
      const error = checkFile(file)
      return {
        key: `${Date.now()}-${index}-${file.name}`,
        intent: crypto.randomUUID(),
        file,
        status: error ? "invalid" : "ready",
        progress: 0,
        error,
        previewUrl: previewFor(file),
      } satisfies UploadEntry
    })
    setEntries((current) => [...current, ...added])
  }

  async function upload(list: readonly UploadEntry[]) {
    setUploading(true)
    setStopped(null)
    let succeeded = 0
    let failed = 0
    let unconfirmed = 0
    let stop: string | null = null
    for (const entry of list) {
      const sendCategory = entry.sentCategory ?? category
      patch(entry.key, {
        status: "uploading",
        progress: 0,
        error: undefined,
        code: undefined,
      })
      const form = new FormData()
      form.set("file", entry.file)
      form.set("mediaFormat", "PHOTO")
      form.set("category", sendCategory)
      try {
        const result = await uploadMediaFile(
          locationId,
          form,
          (fraction) => patch(entry.key, { progress: fraction }),
          { intentId: entry.intent }
        )
        succeeded += 1
        patch(entry.key, {
          status:
            answerOutcome(result) === "confirmed_applied" ? "done" : "sent",
          progress: 1,
          sentCategory: undefined,
        })
      } catch (error) {
        stop = runRefusal(error)
        if (stop) {
          // Refused before anything was claimed: the file goes back to how
          // it was, intent and all, and the rest are not sent.
          if (isMfaStepUpError(error) && typeof window !== "undefined")
            window.dispatchEvent(
              new CustomEvent<MfaStepUpEventDetail>(MFA_STEP_UP_EVENT, {
                detail: { code: error.code as MfaStepUpEventDetail["code"] },
              })
            )
          patch(entry.key, {
            status: entry.status,
            progress: 0,
            error: entry.error,
            code: entry.code,
          })
          break
        }
        const maybeSent = isUnconfirmedFailure(error)
        if (maybeSent) unconfirmed += 1
        else failed += 1
        patch(entry.key, {
          // An unconfirmed upload keeps its token (and the category it was
          // sent with) so a retry finds the first upload; a definite answer
          // frees the next attempt to be a new upload.
          ...(maybeSent
            ? { sentCategory: sendCategory }
            : { intent: crypto.randomUUID(), sentCategory: undefined }),
          status: maybeSent ? "unconfirmed" : "failed",
          error: describeActionError(error),
          code: error instanceof ApiClientError ? error.code : undefined,
        })
      }
    }
    setUploading(false)
    setStopped(stop)
    // Re-read after anything that may have landed: an unconfirmed upload
    // shows up on the page as one to resolve, or as the photo itself.
    if (succeeded + unconfirmed > 0) onAdded()
    if (fileRef.current) fileRef.current.value = ""
    if (cameraRef.current) cameraRef.current.value = ""
    // A run stopped before sending anything has said why above the files.
    if (stop && succeeded + failed + unconfirmed === 0) return
    toasts.add({
      title:
        succeeded > 0
          ? `${succeeded} ${succeeded === 1 ? "photo" : "photos"} sent to Google`
          : unconfirmed > 0
            ? `Google hasn’t confirmed ${unconfirmed === 1 ? "this photo" : `${unconfirmed} photos`}`
            : "No photos were uploaded",
      description:
        failed + unconfirmed > 0 || stop
          ? [
              failed > 0 ? `${failed} failed.` : null,
              unconfirmed > 0 ? `${unconfirmed} not confirmed.` : null,
              stop ? "The rest weren’t sent." : null,
              failed + unconfirmed > 0
                ? "The reason is beside each one."
                : null,
            ]
              .filter(Boolean)
              .join(" ")
          : undefined,
      type:
        failed > 0 ? "error" : unconfirmed > 0 || stop ? "warning" : "success",
    })
  }

  function close() {
    revoke(entries)
    setEntries([])
    setUrl("")
    setUrlError(null)
    setStopped(null)
    onOpenChange(false)
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled || uploading) return
    acceptFiles(event.dataTransfer.files)
  }

  const pickDisabled = disabled || uploading

  return (
    <Dialog
      open={open}
      // Chosen files or a typed link would be lost to a stray swipe or tap
      // outside, so those ask first. Mid-upload nothing may close it: the
      // uploads run on, and the result belongs on screen.
      dirty={!uploading && (ready.length > 0 || url.trim().length > 0)}
      discardPrompt={{
        title: "Discard these photos?",
        description:
          "The photos you chose haven’t been uploaded. Nothing has been sent to Google.",
        confirmLabel: "Discard photos",
      }}
      onOpenChange={(next, details) => {
        if (!next && uploading) {
          details.cancel()
          return
        }
        if (!next) {
          close()
          return
        }
        onOpenChange(next)
      }}
    >
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Add photos</DialogTitle>
          <DialogDescription>
            Photos go to Google when you tap Upload.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <Field>
            <FieldLabel>Google photo category</FieldLabel>
            <Select
              value={category}
              onValueChange={(next) => setCategory(next as MediaCategory)}
              disabled={pickDisabled}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue>
                  {(value: string | null) => humaniseCategory(value ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent title="Google photo category">
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {humaniseCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Every photo in this upload goes into this category.
            </FieldDescription>
          </Field>

          {/* Two explicit ways in, both buttons: the camera (a phone
                  opens it straight away; `capture` is ignored at a desk, so
                  the button only shows on touch) and the photo library or
                  file picker. Dropping files is a desk extra, never the only
                  way in (WCAG 2.5.7). */}
          <div
            data-dragging={dragging || undefined}
            onDragOver={(event) => {
              event.preventDefault()
              if (!pickDisabled && !dragging) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center gap-3 rounded-lg border-[1.5px] border-dashed border-line-strong bg-surface-alt px-4 py-5 text-center transition-colors duration-(--np-duration-fast)",
              "data-[dragging]:border-primary data-[dragging]:bg-accent-tint"
            )}
          >
            <input
              ref={cameraRef}
              type="file"
              hidden
              aria-label="Take a photo with the camera"
              accept={ACCEPTED_TYPES.join(",")}
              capture="environment"
              onChange={(event) => {
                acceptFiles(event.target.files)
                event.target.value = ""
              }}
              disabled={pickDisabled}
            />
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              aria-label="Direct file upload"
              accept={ACCEPTED_TYPES.join(",")}
              onChange={(event) => {
                acceptFiles(event.target.files)
                event.target.value = ""
              }}
              disabled={pickDisabled}
            />
            {/* Notion Mail's attachment picker: one option row per
                    way in, each a plain button (no checked state), the
                    camera first where there is one. */}
            <OptionRowGroup
              type="multiple"
              label="Ways to add photos"
              className="w-full sm:max-w-xs"
            >
              <OptionRow
                className="hidden bg-surface pointer-coarse:flex"
                icon={<CameraIcon />}
                label="Take photo"
                onClick={() => cameraRef.current?.click()}
                disabled={pickDisabled}
                aria-describedby={hintId}
              />
              <OptionRow
                className="bg-surface"
                icon={<ImagesIcon />}
                label="Choose from library"
                onClick={() => fileRef.current?.click()}
                disabled={pickDisabled}
                aria-describedby={hintId}
              />
            </OptionRowGroup>
            <p className="hidden text-ui text-ink-muted hover-fine:block">
              or drop photos here
            </p>
            <p id={hintId} className="text-caption text-ink-muted">
              JPEG or PNG only (not HEIC), from {MIN_PHOTO_UPLOAD_BYTES / 1024}{" "}
              KB up to {MAX_MEDIA_UPLOAD_BYTES / MB} MB each.
            </p>
          </div>

          {/* One polite summary instead of a live list: a live <ul> read
                  out every progress tick of every file. */}
          <p className="sr-only" aria-live="polite">
            {entries.length > 0
              ? uploading
                ? `Uploading. ${summary.join(", ")}${summary.length > 0 ? "." : ""}`
                : `${summary.join(", ")}.`
              : ""}
          </p>

          {stopped ? (
            <Alert variant="warning">
              <AlertDescription>{stopped}</AlertDescription>
            </Alert>
          ) : null}

          {/* Notion Mail's attachment cards: stacked full width on a
                  phone, two to a row in the wide dialog at the desk. */}
          {entries.length > 0 ? (
            <ul
              aria-label="Files to upload"
              className="grid gap-2 sm:grid-cols-2"
            >
              {entries.map((entry) => {
                const pill = STATUS_PILL[entry.status]
                const removable =
                  !uploading &&
                  (entry.status === "ready" ||
                    entry.status === "invalid" ||
                    entry.status === "unconfirmed" ||
                    entry.status === "failed")
                const retryable =
                  !uploading &&
                  !disabled &&
                  (entry.status === "failed" ||
                    (entry.status === "unconfirmed" &&
                      !NO_RETRY_CODES.has(entry.code ?? "")))
                const needsVerdict =
                  entry.status === "unconfirmed" &&
                  entry.code === "media_needs_resolution"
                return (
                  <FileCard
                    key={entry.key}
                    name={entry.file.name}
                    previewUrl={entry.previewUrl}
                    meta={
                      <>
                        <span className="tabular-nums">
                          {formatFileSize(entry.file.size)}
                        </span>
                        <StatusPill tone={pill.tone}>
                          {entry.status === "uploading"
                            ? `${pill.label} ${Math.round(entry.progress * 100)}%`
                            : pill.label}
                        </StatusPill>
                      </>
                    }
                    trailing={
                      removable ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          // Taking a sent photo off this list undoes nothing
                          // on Google.
                          aria-label={
                            entry.status === "unconfirmed"
                              ? `Remove ${entry.file.name} from this list`
                              : `Remove ${entry.file.name}`
                          }
                          onClick={() => {
                            revoke([entry])
                            setEntries((current) =>
                              current.filter((row) => row.key !== entry.key)
                            )
                          }}
                        >
                          <XIcon aria-hidden />
                        </Button>
                      ) : null
                    }
                  >
                    {entry.status === "uploading" ? (
                      <Progress
                        value={Math.round(entry.progress * 100)}
                        label={`Upload progress for ${entry.file.name}`}
                      />
                    ) : null}
                    {entry.error ? (
                      <p className="flex items-start gap-1.5 text-caption text-danger-ink">
                        <CircleAlertIcon
                          aria-hidden
                          className="mt-px size-3.5 shrink-0"
                        />
                        <span>
                          {entry.error}
                          {entry.code ? (
                            <span className="ml-1 font-mono text-ink-muted">
                              {entry.code}
                            </span>
                          ) : null}
                        </span>
                      </p>
                    ) : null}
                    {needsVerdict ? (
                      <p className="text-caption text-ink-muted">
                        Close this, then use “It is on Google” or “It is not on
                        Google” on the photos page.
                      </p>
                    ) : null}
                    {retryable ? (
                      <div>
                        <Button
                          variant="secondary"
                          size="sm"
                          // The visible words first (label in name), then
                          // which file.
                          aria-label={`Try again to upload ${entry.file.name}`}
                          onClick={() => void upload([entry])}
                        >
                          <RotateCcwIcon aria-hidden />
                          Try again
                        </Button>
                      </div>
                    ) : null}
                  </FileCard>
                )
              })}
            </ul>
          ) : null}

          <Card size="sm">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-fill text-ink-muted">
                  <LinkIcon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-ui font-semibold text-ink">
                    Or import one photo from a link
                  </p>
                  <p className="text-caption text-ink-muted">
                    Google fetches it, so the link must be public.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value)
                    setUrlError(null)
                  }}
                  placeholder="https://example.com/photo.jpg"
                  inputMode="url"
                  type="url"
                  aria-label="Photo URL"
                  aria-invalid={urlError ? true : undefined}
                  aria-describedby={urlError ? urlErrorId : undefined}
                  disabled={pickDisabled}
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={() => addUrl.mutate()}
                  pending={addUrl.isPending}
                  pendingLabel="Adding…"
                  disabled={pickDisabled || url.trim().length === 0}
                >
                  Add from URL
                </Button>
              </div>
              {urlError ? (
                <p id={urlErrorId} className="text-caption text-danger-ink">
                  {urlError}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <GateNote reason={writeReason} />
        <DialogFooter className="sm:items-center">
          {uploading ? (
            // The dialog cannot close mid-upload; this says so before × is
            // tried.
            <span className="text-caption text-ink-muted sm:mr-auto">
              Keep this open until the uploads finish.
            </span>
          ) : entries.length > 0 ? (
            <span className="text-caption text-ink-muted tabular-nums sm:mr-auto">
              {summary.join(" · ")}
            </span>
          ) : null}
          {/* One button whatever it says, so focus stays on it when the
              run ends and it turns into Done. */}
          <Button
            variant={finished ? "secondary" : "default"}
            onClick={finished ? close : () => void upload(ready)}
            pending={uploading}
            pendingLabel="Uploading…"
            disabled={!finished && (disabled || ready.length === 0)}
          >
            {finished ? null : <UploadIcon aria-hidden />}
            {finished
              ? "Done"
              : ready.length > 0
                ? `Upload ${ready.length} ${ready.length === 1 ? "photo" : "photos"}`
                : "Upload photos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
