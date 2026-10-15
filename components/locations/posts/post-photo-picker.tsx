"use client"

import { CheckIcon, PlusIcon } from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import type { MediaItem } from "@/lib/contracts/location-media"
import { useMedia } from "@/lib/queries/use-location-media"
import { cn } from "@/lib/utils"

// The add flow is the photo library's own dialog (camera, library, drop,
// link): it loads the first time a post asks for a new photo.
const AddPhotoDialog = dynamic(
  () =>
    import("@/components/locations/photos/add-photo-dialog").then(
      (m) => m.AddPhotoDialog
    ),
  { ssr: false }
)

/** A library photo's link as a post carries it: Google's copy, http(s) only. */
export function photoLink(item: MediaItem): string | null {
  const url = item.googleUrl ?? item.sourceUrl
  return url && /^https?:\/\//i.test(url) ? url : null
}

/**
 * Choose the photo a post carries from the listing's own photos on Google,
 * or add a new one first through the photo library's add flow. Choosing is
 * one tap and closes the dialog; adding sends the photo to Google (that
 * dialog says so) and it appears here once Google has it.
 */
export function PostPhotoPicker({
  open,
  onOpenChange,
  locationId,
  chosenUrl,
  onChoose,
  addReason,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  locationId: string
  chosenUrl: string
  onChoose: (url: string) => void
  /** Why a new photo cannot be added (permission, pause), or null. */
  addReason: string | null
}) {
  const media = useMedia(locationId, { ownership: "merchant" })
  const [addOpen, setAddOpen] = useState(false)
  const [addMounted, setAddMounted] = useState(false)
  if (addOpen && !addMounted) setAddMounted(true)

  const items = (media.data?.items ?? []).filter(
    (item) => item.mediaFormat === "PHOTO" && photoLink(item) !== null
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="wide">
          <DialogHeader>
            <DialogTitle>Choose a photo</DialogTitle>
            <DialogDescription>
              Photos already on your Google listing. The post carries the one
              you choose.
            </DialogDescription>
          </DialogHeader>

          {media.isPending ? (
            <p role="status" className="text-ui text-ink-muted">
              Loading your photos…
            </p>
          ) : media.isError ? (
            <p role="alert" className="text-ui text-danger-ink">
              We couldn’t load your photos. You can still add a new one.
            </p>
          ) : items.length === 0 ? (
            <Empty
              variant="empty"
              framed
              titleAs="h3"
              title="No photos on Google yet"
              description="Add one and it appears here."
            />
          ) : (
            <ul
              aria-label="Your Google photos"
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            >
              {items.map((item) => {
                const url = photoLink(item) as string
                const chosen = url === chosenUrl
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={chosen}
                      aria-label={
                        item.description
                          ? `Use photo: ${item.description}`
                          : "Use this photo"
                      }
                      onClick={() => {
                        onChoose(url)
                        onOpenChange(false)
                      }}
                      className={cn(
                        "relative block aspect-square w-full overflow-hidden rounded-(--np-radius-control) border bg-fill focus-halo",
                        chosen ? "border-primary" : "border-line"
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- a remote Google URL shown as-is */}
                      <img
                        src={item.thumbnailUrl ?? url}
                        alt=""
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="size-full object-cover"
                      />
                      {chosen ? (
                        <span
                          aria-hidden
                          className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"
                        >
                          <CheckIcon className="size-4" />
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <DialogFooter className="sm:items-center">
            {addReason ? (
              <span className="text-caption text-ink-muted sm:mr-auto">
                {addReason}
              </span>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => setAddOpen(true)}
              disabled={Boolean(addReason)}
            >
              <PlusIcon aria-hidden />
              Add a new photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {addMounted && media.data ? (
        <AddPhotoDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          locationId={locationId}
          categories={media.data.categories}
          writeReason={addReason}
          onAdded={() => void media.refetch()}
        />
      ) : null}
    </>
  )
}
