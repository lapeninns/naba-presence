"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import {
  createMediaFromUrl,
  deleteMediaItem,
  uploadMediaFile,
  type MediaCategory,
  type MediaItem,
  type MediaState,
} from "@/lib/api/location-media"
import { describeActionError } from "@/lib/locations/action-errors"
import { publishDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useMedia } from "@/lib/queries/use-location-media"

const MAX_UPLOAD_BYTES = 75 * 1024 * 1024

export function humaniseCategory(category: string): string {
  const lower = category.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function PhotosTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const mediaQuery = useMedia(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (mediaQuery.isPending) return <TabLoading />
  if (mediaQuery.isError) return <TabError error={mediaQuery.error} onRetry={() => mediaQuery.refetch()} />

  return (
    <PhotosTabLoaded
      locationId={locationId}
      media={mediaQuery.data}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationMedia(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function PhotosTabLoaded({
  locationId,
  media,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  media: MediaState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [category, setCategory] = useState<MediaCategory>((media.categories[0] as MediaCategory) ?? "ADDITIONAL")
  const [url, setUrl] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const writeReason = publishDisabledReason(caps, media.writesEnabled)
  const disabled = Boolean(writeReason)

  const addUrl = useMutation({
    mutationFn: () => createMediaFromUrl(locationId, { mediaFormat: "PHOTO", category, sourceUrl: url }),
    onSuccess: () => {
      setUrl("")
      invalidate()
      toast("Photo added", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.set("file", pendingFile as File)
      form.set("mediaFormat", "PHOTO")
      form.set("category", category)
      return uploadMediaFile(locationId, form, (fraction) => setProgress(fraction))
    },
    onMutate: () => setProgress(0),
    onSuccess: () => {
      setPendingFile(null)
      if (fileRef.current) fileRef.current.value = ""
      invalidate()
      toast("Photo uploaded", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
    onSettled: () => setProgress(null),
  })

  const remove = useMutation({
    mutationFn: (item: MediaItem) => deleteMediaItem(locationId, item.id, { expectedGoogleHash: item.googleHash }),
    onSuccess: () => {
      setDeleteTarget(null)
      invalidate()
      toast("Photo deleted", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setSizeError("That file is too large. Uploads cannot exceed 75 MB.")
      setPendingFile(null)
      return
    }
    setSizeError(null)
    setPendingFile(file)
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Add media</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Category</span>
            <Select value={category} onValueChange={(next) => setCategory(next as MediaCategory)}>
              <SelectTrigger className="w-48" aria-label="Photo category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {media.categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {humaniseCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Photo URL</span>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url" className="w-72" disabled={disabled} />
          </label>
          <Button variant="outline" onClick={() => addUrl.mutate()} disabled={disabled || url.trim().length === 0 || addUrl.isPending}>
            Add from URL
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Direct file upload</span>
            <input ref={fileRef} type="file" aria-label="Direct file upload" accept="image/jpeg,image/png,video/mp4,video/quicktime" onChange={onFileChange} disabled={disabled} className="text-ui" />
          </label>
          <Button variant="outline" onClick={() => setUploadOpen(true)} disabled={disabled || !pendingFile || upload.isPending}>
            Review file upload
          </Button>
        </div>
        {upload.isPending ? (
          <div className="flex items-center gap-2">
            <progress value={progress ?? 0} max={1} className="h-2 w-40" aria-label="Upload progress" />
            <span className="text-caption text-muted-foreground">Uploading… {Math.round((progress ?? 0) * 100)}%</span>
          </div>
        ) : null}
        {sizeError ? <p className="text-caption text-destructive">{sizeError}</p> : null}
        <GateNote reason={writeReason} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Current media</h2>
        {media.items.length === 0 ? (
          <p className="text-ui text-muted-foreground">No photos or videos yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {media.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 rounded-(--nr-radius-card) border border-border p-2">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt={`${humaniseCategory(item.category)} ${item.mediaFormat.toLowerCase()}`} className="aspect-square w-full rounded-(--nr-radius-control) object-cover" />
                ) : (
                  <div className="aspect-square w-full rounded-(--nr-radius-control) bg-muted" aria-hidden />
                )}
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{humaniseCategory(item.category)}</Badge>
                  {item.ownership === "customer" ? (
                    <Badge variant="outline">Customer photo</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)} disabled={disabled} aria-label={`Delete ${humaniseCategory(item.category)} photo`}>
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OverwriteConfirmDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="Upload this file to Google?"
        description={pendingFile ? `“${pendingFile.name}” will be added as a ${humaniseCategory(category)} photo on your Google Business Profile.` : ""}
        confirmLabel="Upload"
        requireAcknowledgement={false}
        pending={upload.isPending}
        onConfirm={() => {
          // Close the dialog so the section's progress bar is visible during upload.
          setUploadOpen(false)
          upload.mutate()
        }}
      />
      <OverwriteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this photo from Google?"
        description="This removes the photo from your Google Business Profile. It cannot be undone."
        confirmLabel="Delete"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  )
}
