"use client"

import { LinkIcon, UploadCloudIcon } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createMediaFromUrl,
  uploadMediaFile,
  type MediaCategory,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/contracts/location-media"
import { humaniseCategory } from "@/lib/locations/media-labels"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

const ACCEPTED_TYPES = ["image/jpeg", "image/png"]

/**
 * "Add media": pick a Google category, then either import a photo from a
 * public URL or choose a file and confirm the upload. Owns every piece of
 * that flow's state; the parent only opens/closes it and refreshes after.
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
  const categoryLabelId = useId()
  const [category, setCategory] = useState<MediaCategory>(
    categories.includes("ADDITIONAL")
      ? "ADDITIONAL"
      : (categories[0] as MediaCategory)
  )
  const [url, setUrl] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const disabled = Boolean(writeReason)

  const addUrl = useResourceMutation<MediaMutationResult>({
    mutationFn: () =>
      createMediaFromUrl(locationId, {
        mediaFormat: "PHOTO",
        category,
        sourceUrl: url,
      }),
    invalidate: onAdded,
    successToast: "Photo added",
    onSuccess: () => {
      setUrl("")
      onOpenChange(false)
    },
  })

  const upload = useResourceMutation<MediaMutationResult>({
    mutationFn: () => {
      const form = new FormData()
      form.set("file", pendingFile as File)
      form.set("mediaFormat", "PHOTO")
      form.set("category", category)
      return uploadMediaFile(locationId, form, setProgress)
    },
    invalidate: onAdded,
    successToast: "Photo uploaded",
    onSuccess: () => {
      setProgress(null)
      setPendingFile(null)
      if (fileRef.current) fileRef.current.value = ""
      onOpenChange(false)
    },
    onError: () => setProgress(null),
  })

  // One gate for both ways a file arrives (the picker and a drop on the
  // well), so the size rule and the type rule are stated once.
  function acceptFile(file: File | null) {
    if (file && !ACCEPTED_TYPES.includes(file.type)) {
      setFileError("That file type is not supported. Choose a JPG or PNG.")
      setPendingFile(null)
      return
    }
    if (file && file.size > MAX_MEDIA_UPLOAD_BYTES) {
      setFileError("That file is too large. Uploads cannot exceed 75 MB.")
      setPendingFile(null)
      return
    }
    setFileError(null)
    setPendingFile(file)
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0] ?? null)
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    acceptFile(event.dataTransfer.files?.[0] ?? null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[min(90vh,46rem)] gap-5 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add media</DialogTitle>
            <DialogDescription>
              Upload a JPG or PNG, or import a photo from a public URL.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <span id={categoryLabelId} className="text-ui font-medium text-ink">
              Google photo category
            </span>
            <Select
              value={category}
              onValueChange={(next) => setCategory(next as MediaCategory)}
            >
              <SelectTrigger
                className="w-full sm:w-64"
                aria-label="Photo category"
                aria-describedby={categoryLabelId}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {humaniseCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* The drop well: a dashed edge in the strong line on the
                tertiary fill, the one place a dashed border belongs. While a
                file is held over it the edge turns accent. */}
            <label
              data-dragging={dragging || undefined}
              onDragOver={(event) => {
                event.preventDefault()
                if (!disabled && !dragging) setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className="group flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-(--np-radius-card) border border-dashed border-line-strong bg-fill-tertiary px-4 py-6 text-center transition-[background-color,border-color] duration-(--np-duration-fast) ease-spring-snappy has-[:focus-visible]:[box-shadow:var(--np-focus-halo)] hover:bg-fill-secondary data-[dragging]:border-primary data-[dragging]:bg-accent-tint has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
            >
              <input
                ref={fileRef}
                type="file"
                aria-label="Direct file upload"
                accept={ACCEPTED_TYPES.join(",")}
                onChange={onFileChange}
                disabled={disabled}
                className="sr-only"
              />
              <span className="flex size-10 items-center justify-center rounded-(--np-radius-pill) bg-surface text-ink-muted hairline">
                <UploadCloudIcon
                  aria-hidden
                  className="size-5"
                  strokeWidth={1.75}
                />
              </span>
              <span className="text-body font-semibold text-ink">
                {pendingFile ? pendingFile.name : "Choose a photo"}
              </span>
              <span className="text-caption text-ink-muted">
                Drop a JPG or PNG here, up to 75 MB
              </span>
            </label>

            <div className="flex min-h-40 flex-col justify-center gap-3 rounded-(--np-radius-card) bg-surface-sunken p-4">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-(--np-radius-control) bg-surface text-ink-muted hairline">
                  <LinkIcon aria-hidden className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-body font-semibold text-ink">
                    Import from URL
                  </p>
                  <p className="text-caption text-ink-muted">
                    Use a publicly accessible image link.
                  </p>
                </div>
              </div>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/photo.jpg"
                inputMode="url"
                aria-label="Photo URL"
                disabled={disabled}
              />
              <div>
                <Button
                  variant="secondary"
                  onClick={() => addUrl.mutate()}
                  disabled={
                    disabled || url.trim().length === 0 || addUrl.isPending
                  }
                >
                  {addUrl.isPending ? "Adding…" : "Add from URL"}
                </Button>
              </div>
            </div>
          </div>

          {upload.isPending ? (
            <div className="flex items-center gap-2">
              <progress
                value={progress ?? 0}
                max={1}
                className="h-2 flex-1 accent-primary"
                aria-label="Upload progress"
              />
              <span className="text-caption text-ink-muted tabular-nums">
                {Math.round((progress ?? 0) * 100)}%
              </span>
            </div>
          ) : null}
          {fileError ? (
            <p role="alert" className="text-caption text-danger-ink">
              {fileError}
            </p>
          ) : null}
          <GateNote reason={writeReason} />
          <DialogFooter>
            <Button
              onClick={() => setUploadOpen(true)}
              disabled={disabled || !pendingFile || upload.isPending}
            >
              Review file upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        file={pendingFile}
        category={category}
        pending={upload.isPending}
        onConfirm={() => {
          setUploadOpen(false)
          setProgress(0)
          upload.mutate()
        }}
      />
    </>
  )
}
