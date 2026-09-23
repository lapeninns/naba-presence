"use client"

import { CircleAlertIcon, LinkIcon, UploadIcon, XIcon } from "lucide-react"
import { useId, useRef, useState } from "react"

import { UploadDialog } from "@/components/locations/photos/upload-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import { ApiClientError } from "@/lib/api/client"
import {
  createMediaFromUrl,
  uploadMediaFile,
  type MediaCategory,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/contracts/location-media"
import { describeActionError } from "@/lib/errors/action-errors"
import { humaniseCategory } from "@/lib/locations/media-labels"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { cn } from "@/lib/utils"

const ACCEPTED_TYPES = ["image/jpeg", "image/png"]
const MB = 1024 * 1024

type UploadStatus =
  "invalid" | "ready" | "uploading" | "sent" | "done" | "failed"

type UploadEntry = {
  key: string
  file: File
  status: UploadStatus
  progress: number
  error?: string
  code?: string
}

function formatSize(bytes: number) {
  return bytes >= MB
    ? `${(bytes / MB).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The two rules the upload route enforces, stated once for picker and drop. */
function checkFile(file: File): string | undefined {
  if (!ACCEPTED_TYPES.includes(file.type))
    return `This file type isn’t supported (${file.type || "unknown type"}). Choose a JPG or PNG.`
  if (file.size > MAX_MEDIA_UPLOAD_BYTES)
    return `Too large at ${formatSize(file.size)}. Uploads can be up to ${MAX_MEDIA_UPLOAD_BYTES / MB} MB.`
  return undefined
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
  done: { tone: "ok", label: "On Google" },
  failed: { tone: "bad", label: "Failed" },
}

/**
 * "Add media" (reference `#upload`): pick a Google category, then either
 * choose or drop JPG/PNG files, or import one photo from a public URL.
 *
 * Each file is checked against the upload route's own rules before it can
 * be sent, and each upload is its own request, so one refusal from Google
 * leaves the others alone and names its own reason and code. Only real
 * outcomes are shown: "On Google" is the route reporting the write as
 * succeeded.
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const disabled = Boolean(writeReason)

  const addUrl = useResourceMutation<MediaMutationResult>({
    mutationFn: () =>
      createMediaFromUrl(locationId, {
        mediaFormat: "PHOTO",
        category,
        sourceUrl: url,
      }),
    invalidate: onAdded,
    successToast: (result) =>
      result.status === "succeeded"
        ? "Photo added on Google"
        : "Photo sent to Google",
    onSuccess: () => {
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
        file,
        status: error ? "invalid" : "ready",
        progress: 0,
        error,
      } satisfies UploadEntry
    })
    setEntries((current) => [...current, ...added])
  }

  async function uploadAll() {
    setConfirmOpen(false)
    setUploading(true)
    let succeeded = 0
    let failed = 0
    for (const entry of ready) {
      patch(entry.key, { status: "uploading", progress: 0 })
      const form = new FormData()
      form.set("file", entry.file)
      form.set("mediaFormat", "PHOTO")
      form.set("category", category)
      try {
        const result = await uploadMediaFile(locationId, form, (fraction) =>
          patch(entry.key, { progress: fraction })
        )
        succeeded += 1
        patch(entry.key, {
          status: result.status === "succeeded" ? "done" : "sent",
          progress: 1,
        })
      } catch (error) {
        failed += 1
        patch(entry.key, {
          status: "failed",
          error: describeActionError(error),
          code: error instanceof ApiClientError ? error.code : undefined,
        })
      }
    }
    setUploading(false)
    if (succeeded > 0) onAdded()
    if (fileRef.current) fileRef.current.value = ""
    toasts.add({
      title:
        succeeded > 0
          ? `${succeeded} ${succeeded === 1 ? "photo" : "photos"} sent to Google`
          : "No photos were uploaded",
      description:
        failed > 0
          ? `${failed} failed. The reason is beside each one.`
          : undefined,
      type: failed > 0 ? "error" : "success",
    })
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled || uploading) return
    acceptFiles(event.dataTransfer.files)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && uploading) return
          if (!next) setEntries([])
          onOpenChange(next)
        }}
      >
        <DialogContent size="wide">
          <DialogHeader>
            <DialogTitle>Add media</DialogTitle>
            <DialogDescription>
              Each photo goes to Google as soon as its upload finishes. Nothing
              waits for a publish step.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel>Google photo category</FieldLabel>
            <Select
              value={category}
              onValueChange={(next) => setCategory(next as MediaCategory)}
              disabled={disabled || uploading}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue>
                  {(value: string | null) => humaniseCategory(value ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {humaniseCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Every file in this upload goes into this category.
            </FieldDescription>
          </Field>

          {/* The drop well is a label for the file input, so a tap anywhere
              on it opens the picker (the camera roll on a phone); dropping
              files is the desktop shortcut, never the only way in. */}
          <label
            data-dragging={dragging || undefined}
            onDragOver={(event) => {
              event.preventDefault()
              if (!disabled && !dragging) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-line-strong bg-surface-alt px-4 py-6 text-center transition-colors duration-(--np-duration-fast)",
              "hover:bg-fill has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              "data-[dragging]:border-primary data-[dragging]:bg-accent-tint",
              "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
            )}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              aria-label="Direct file upload"
              aria-describedby={hintId}
              accept={ACCEPTED_TYPES.join(",")}
              onChange={(event) => {
                acceptFiles(event.target.files)
                event.target.value = ""
              }}
              disabled={disabled || uploading}
              className="sr-only"
            />
            <UploadIcon aria-hidden className="size-6 text-ink-muted" />
            <span className="text-body font-semibold text-ink">
              Drop photos here, or choose files
            </span>
            <span id={hintId} className="text-caption text-ink-muted">
              JPG or PNG, up to {MAX_MEDIA_UPLOAD_BYTES / MB} MB each
            </span>
          </label>

          {entries.length > 0 ? (
            <ul
              aria-label="Files to upload"
              aria-live="polite"
              className="flex flex-col gap-2"
            >
              {entries.map((entry) => {
                const pill = STATUS_PILL[entry.status]
                const removable =
                  !uploading &&
                  (entry.status === "ready" ||
                    entry.status === "invalid" ||
                    entry.status === "failed")
                return (
                  <li
                    key={entry.key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md border border-line px-3 py-2.5"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-ui font-semibold break-words text-ink">
                        {entry.file.name}
                      </span>
                      <span className="font-mono text-caption text-ink-muted tabular-nums">
                        {formatSize(entry.file.size)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <StatusPill tone={pill.tone}>
                        {entry.status === "uploading"
                          ? `${pill.label} ${Math.round(entry.progress * 100)}%`
                          : pill.label}
                      </StatusPill>
                      {removable ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${entry.file.name}`}
                          onClick={() =>
                            setEntries((current) =>
                              current.filter((row) => row.key !== entry.key)
                            )
                          }
                        >
                          <XIcon aria-hidden />
                        </Button>
                      ) : null}
                    </span>
                    {entry.status === "uploading" ? (
                      <Progress
                        className="col-span-2"
                        value={Math.round(entry.progress * 100)}
                        label={`Upload progress for ${entry.file.name}`}
                      />
                    ) : null}
                    {entry.error ? (
                      <p className="col-span-2 flex items-start gap-1.5 text-caption text-danger-ink">
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
                  </li>
                )
              })}
            </ul>
          ) : null}

          <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
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
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/photo.jpg"
                inputMode="url"
                type="url"
                aria-label="Photo URL"
                disabled={disabled || uploading}
                className="min-w-0 flex-1"
              />
              <Button
                variant="secondary"
                onClick={() => addUrl.mutate()}
                pending={addUrl.isPending}
                pendingLabel="Adding…"
                disabled={disabled || uploading || url.trim().length === 0}
              >
                Add from URL
              </Button>
            </div>
          </div>

          <GateNote reason={writeReason} />
          <DialogFooter className="sm:items-center">
            {entries.length > 0 ? (
              <span className="text-caption text-ink-muted sm:mr-auto">
                {done} sent · {ready.length} ready · {cannot} can’t upload
              </span>
            ) : null}
            <Button
              onClick={() => setConfirmOpen(true)}
              pending={uploading}
              pendingLabel="Uploading…"
              disabled={disabled || ready.length === 0}
            >
              Review file upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UploadDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        files={ready.map((entry) => entry.file)}
        category={category}
        pending={uploading}
        onConfirm={() => void uploadAll()}
      />
    </>
  )
}
