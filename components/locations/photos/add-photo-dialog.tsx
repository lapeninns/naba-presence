"use client"

import { LinkIcon, UploadCloudIcon } from "lucide-react"
import { useRef, useState } from "react"

import { UploadDialog } from "@/components/locations/photos/upload-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const [category, setCategory] = useState<MediaCategory>(
    categories.includes("ADDITIONAL")
      ? "ADDITIONAL"
      : (categories[0] as MediaCategory)
  )
  const [url, setUrl] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)
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

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (file && file.size > MAX_MEDIA_UPLOAD_BYTES) {
      setSizeError("That file is too large. Uploads cannot exceed 75 MB.")
      setPendingFile(null)
      return
    }
    setSizeError(null)
    setPendingFile(file)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[min(90vh,46rem)] gap-4 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add media</DialogTitle>
            <DialogDescription>
              Upload a JPG or PNG, or import a photo from a public URL.
            </DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption font-medium text-muted-foreground">
              Google photo category
            </span>
            <Select
              value={category}
              onValueChange={(next) => setCategory(next as MediaCategory)}
            >
              <SelectTrigger className="w-full" aria-label="Photo category">
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
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="group flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-(--nr-radius-field) border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors hover:bg-muted/60">
              <input
                ref={fileRef}
                type="file"
                aria-label="Direct file upload"
                accept="image/jpeg,image/png"
                onChange={onFileChange}
                disabled={disabled}
                className="sr-only"
              />
              <span className="flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border/70">
                <UploadCloudIcon aria-hidden className="size-5" />
              </span>
              <span className="text-ui font-semibold">
                {pendingFile ? pendingFile.name : "Choose a photo"}
              </span>
              <span className="text-caption text-muted-foreground">
                JPG or PNG, up to 75 MB
              </span>
            </label>

            <div className="flex min-h-40 flex-col justify-center gap-3 rounded-(--nr-radius-field) border border-border/70 bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-(--nr-radius-control) bg-background text-muted-foreground ring-1 ring-border/70">
                  <LinkIcon aria-hidden className="size-4" />
                </span>
                <div>
                  <p className="text-ui font-semibold">Import from URL</p>
                  <p className="text-caption text-muted-foreground">
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
              <Button
                variant="outline"
                onClick={() => addUrl.mutate()}
                disabled={
                  disabled || url.trim().length === 0 || addUrl.isPending
                }
              >
                {addUrl.isPending ? "Adding…" : "Add from URL"}
              </Button>
            </div>
          </div>

          {upload.isPending ? (
            <div className="flex items-center gap-2">
              <progress
                value={progress ?? 0}
                max={1}
                className="h-2 flex-1"
                aria-label="Upload progress"
              />
              <span className="text-caption text-muted-foreground">
                {Math.round((progress ?? 0) * 100)}%
              </span>
            </div>
          ) : null}
          {sizeError ? (
            <p className="text-caption text-destructive">{sizeError}</p>
          ) : null}
          <GateNote reason={writeReason} />
          <div className="flex justify-end">
            <Button
              onClick={() => setUploadOpen(true)}
              disabled={disabled || !pendingFile || upload.isPending}
            >
              Review file upload
            </Button>
          </div>
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
