"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ImagesIcon,
  LinkIcon,
  Maximize2Icon,
  PlusIcon,
  RefreshCwIcon,
  StoreIcon,
  Trash2Icon,
  UploadCloudIcon,
  UserRoundIcon,
} from "lucide-react"
import { useRef, useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
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
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import {
  createMediaFromUrl,
  deleteMediaItem,
  fetchMedia,
  updateMediaCategory,
  uploadMediaFile,
  type MediaCategory,
  type MediaItem,
  type MediaOwnership,
  type MediaState,
} from "@/lib/api/location-media"
import { describeActionError } from "@/lib/locations/action-errors"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { formatNumber } from "@/lib/format"
import { DEFAULT_MEDIA_PAGE_SIZE } from "@/lib/media-page"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useMedia } from "@/lib/queries/use-location-media"

const MAX_UPLOAD_BYTES = 75 * 1024 * 1024

/** Categories Google allows when PATCHing an existing media item. */
export const PATCHABLE_MEDIA_CATEGORIES = [
  "LOGO",
  "EXTERIOR",
  "INTERIOR",
  "PRODUCT",
  "AT_WORK",
  "FOOD_AND_DRINK",
  "MENU",
  "COMMON_AREA",
  "ROOMS",
  "TEAMS",
  "ADDITIONAL",
] as const satisfies readonly MediaCategory[]

const OWNERSHIP_FILTERS = [
  { value: "all", label: "All" },
  { value: "merchant", label: "Your photos" },
  { value: "customer", label: "Customer photos" },
] as const

type OwnershipFilter = (typeof OWNERSHIP_FILTERS)[number]["value"]

export function humaniseCategory(category: string): string {
  const lower = category.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function isPatchableMediaCategory(
  category: string
): category is (typeof PATCHABLE_MEDIA_CATEGORIES)[number] {
  return (PATCHABLE_MEDIA_CATEGORIES as readonly string[]).includes(category)
}

function formatMediaDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

function PhotosLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-(--nr-radius-control)" />
          <Skeleton className="h-8 w-24 rounded-(--nr-radius-control)" />
          <Skeleton className="hidden h-8 w-28 rounded-(--nr-radius-control) sm:block" />
        </div>
        <Skeleton className="h-8 w-28 rounded-(--nr-radius-control)" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton
            key={index}
            className="aspect-[4/3] rounded-(--nr-radius-card)"
          />
        ))}
      </div>
    </div>
  )
}

export function PhotosTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const [page, setPage] = useState(1)
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all")
  const [categoryFilter, setCategoryFilter] = useState<MediaCategory | "all">(
    "all"
  )
  const [refreshing, setRefreshing] = useState(false)

  const ownership: MediaOwnership | null =
    ownershipFilter === "all" ? null : ownershipFilter
  const category: MediaCategory | null =
    categoryFilter === "all" ? null : categoryFilter

  const mediaQuery = useMedia(locationId, {
    page,
    pageSize: DEFAULT_MEDIA_PAGE_SIZE,
    category,
    ownership,
  })
  const caps = useLocationCapabilities(locationId).data

  function changeOwnership(next: OwnershipFilter) {
    setOwnershipFilter(next)
    setPage(1)
  }

  function changeCategoryFilter(next: MediaCategory | "all") {
    setCategoryFilter(next)
    setPage(1)
  }

  async function refreshFromGoogle() {
    setRefreshing(true)
    try {
      const media = await fetchMedia(locationId, {
        page: 1,
        pageSize: DEFAULT_MEDIA_PAGE_SIZE,
        refresh: true,
        category: category ?? undefined,
        ownership: ownership ?? undefined,
      })
      setPage(1)
      queryClient.setQueryData(
        queryKeys.locationMedia(locationId, {
          page: 1,
          category,
          ownership,
        }),
        media
      )
      await queryClient.invalidateQueries({
        queryKey: ["locations", locationId, "media"],
      })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    } finally {
      setRefreshing(false)
    }
  }

  async function invalidate(options: { refresh?: boolean } = {}) {
    if (options.refresh) {
      await refreshFromGoogle()
      return
    }
    await queryClient.invalidateQueries({
      queryKey: ["locations", locationId, "media"],
    })
  }

  if (mediaQuery.isPending) return <PhotosLoading />
  if (mediaQuery.isError) {
    return (
      <TabError
        error={mediaQuery.error}
        onRetry={() => void mediaQuery.refetch()}
      />
    )
  }

  const media = mediaQuery.data
  const pageCount = Math.max(1, Math.ceil(media.total / media.pageSize))
  const currentPage = Math.min(page, pageCount)
  const filtersActive = ownershipFilter !== "all" || categoryFilter !== "all"

  return (
    <PhotosTabLoaded
      locationId={locationId}
      media={media}
      page={currentPage}
      pageCount={pageCount}
      caps={caps}
      refreshing={refreshing}
      ownershipFilter={ownershipFilter}
      categoryFilter={categoryFilter}
      filtersActive={filtersActive}
      onOwnershipChange={changeOwnership}
      onCategoryFilterChange={changeCategoryFilter}
      onPageChange={setPage}
      onRefresh={() => void refreshFromGoogle()}
      invalidate={(opts) => void invalidate(opts)}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function PhotosTabLoaded({
  locationId,
  media,
  page,
  pageCount,
  caps,
  refreshing,
  ownershipFilter,
  categoryFilter,
  filtersActive,
  onOwnershipChange,
  onCategoryFilterChange,
  onPageChange,
  onRefresh,
  invalidate,
  toast,
}: {
  locationId: string
  media: MediaState
  page: number
  pageCount: number
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  refreshing: boolean
  ownershipFilter: OwnershipFilter
  categoryFilter: MediaCategory | "all"
  filtersActive: boolean
  onOwnershipChange: (value: OwnershipFilter) => void
  onCategoryFilterChange: (value: MediaCategory | "all") => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  invalidate: (options?: { refresh?: boolean }) => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [category, setCategory] = useState<MediaCategory>(
    (media.categories.includes("ADDITIONAL")
      ? "ADDITIONAL"
      : media.categories[0]) as MediaCategory
  )
  const [url, setUrl] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const writeReason = resourceDisabledReason(
    caps,
    "photos",
    media.writesEnabled
  )
  const disabled = Boolean(writeReason)

  const addUrl = useMutation({
    mutationFn: () =>
      createMediaFromUrl(locationId, {
        mediaFormat: "PHOTO",
        category,
        sourceUrl: url,
      }),
    onSuccess: () => {
      setUrl("")
      setAddOpen(false)
      invalidate({ refresh: true })
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
      return uploadMediaFile(locationId, form, (fraction) =>
        setProgress(fraction)
      )
    },
    onMutate: () => setProgress(0),
    onSuccess: () => {
      setPendingFile(null)
      if (fileRef.current) fileRef.current.value = ""
      setAddOpen(false)
      invalidate({ refresh: true })
      toast("Photo uploaded", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
    onSettled: () => setProgress(null),
  })

  const changeCategory = useMutation({
    mutationFn: (input: { item: MediaItem; category: MediaCategory }) =>
      updateMediaCategory(locationId, input.item.id, {
        category: input.category,
        expectedGoogleHash: input.item.googleHash,
      }),
    onMutate: (input) => setUpdatingId(input.item.id),
    onSuccess: () => {
      invalidate({ refresh: true })
      toast("Category updated", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
    onSettled: () => setUpdatingId(null),
  })

  const remove = useMutation({
    mutationFn: (item: MediaItem) =>
      deleteMediaItem(locationId, item.id, {
        expectedGoogleHash: item.googleHash,
      }),
    onSuccess: () => {
      setDeleteTarget(null)
      invalidate({ refresh: true })
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

  const rangeStart = media.total === 0 ? 0 : (page - 1) * media.pageSize + 1
  const rangeEnd = Math.min(page * media.pageSize, media.total)
  const patchCategories = media.categories.filter(isPatchableMediaCategory)

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-(--nr-radius-card) border border-border/70 bg-card shadow-(--nr-shadow-card)">
        <div className="@container/photo-toolbar flex flex-col gap-3 border-b border-border/60 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-title font-semibold">Photo library</h2>
                <Badge variant="secondary">
                  {formatNumber(media.total)}{" "}
                  {media.total === 1 ? "item" : "items"}
                </Badge>
              </div>
              <p className="mt-0.5 text-caption text-muted-foreground">
                Browse and manage the photos and videos visible on your Google
                listing.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={refreshing}
              >
                <RefreshCwIcon
                  aria-hidden
                  className={refreshing ? "animate-spin" : undefined}
                  data-icon="inline-start"
                />
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => setAddOpen(true)}
              >
                <PlusIcon aria-hidden data-icon="inline-start" />
                Add photos
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 @min-[42rem]/photo-toolbar:flex-row @min-[42rem]/photo-toolbar:items-end @min-[42rem]/photo-toolbar:justify-between">
            <div
              role="group"
              aria-label="Photo ownership"
              className="grid grid-cols-3 gap-1 rounded-(--nr-radius-control) bg-muted/70 p-1 sm:inline-grid"
            >
              {OWNERSHIP_FILTERS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={
                    ownershipFilter === option.value ? "secondary" : "ghost"
                  }
                  aria-pressed={ownershipFilter === option.value}
                  onClick={() => onOwnershipChange(option.value)}
                  className="w-full"
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <label className="flex min-w-0 flex-col gap-1 text-ui sm:w-52">
              <span className="text-caption text-muted-foreground">
                Category
              </span>
              <Select
                value={categoryFilter}
                onValueChange={(next) =>
                  onCategoryFilterChange(next as MediaCategory | "all")
                }
              >
                <SelectTrigger
                  className="w-full"
                  aria-label="Filter by category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {media.categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {humaniseCategory(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>

        <GateNote reason={writeReason} />

        {media.total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ImagesIcon aria-hidden className="size-5" />
            </span>
            <div>
              <h3 className="text-ui font-semibold">
                {filtersActive ? "No matching photos" : "No photos yet"}
              </h3>
              <p className="mt-1 max-w-sm text-caption text-muted-foreground">
                {filtersActive
                  ? "Try a different ownership or category filter."
                  : "Add high-quality photos to help customers understand what to expect."}
              </p>
            </div>
            {filtersActive ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOwnershipChange("all")
                  onCategoryFilterChange("all")
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => setAddOpen(true)}
              >
                <PlusIcon aria-hidden data-icon="inline-start" />
                Add photos
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3 p-3 sm:p-4">
              {media.items.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  disabled={disabled}
                  updating={updatingId === item.id}
                  patchCategories={patchCategories}
                  onOpen={() => setPreviewItem(item)}
                  onCategoryChange={(next) => {
                    if (next === item.category) return
                    changeCategory.mutate({ item, category: next })
                  }}
                  onDelete={() => setDeleteTarget(item)}
                />
              ))}
            </ul>

            <nav
              aria-label="Photo pages"
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2.5 sm:px-4"
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeftIcon aria-hidden />
                Previous
              </Button>
              <span className="order-first w-full text-center text-caption text-muted-foreground tabular-nums sm:order-none sm:w-auto">
                {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} of{" "}
                {formatNumber(media.total)}
                {pageCount > 1 ? ` · Page ${page} of ${pageCount}` : null}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
              >
                Next
                <ChevronRightIcon aria-hidden />
              </Button>
            </nav>
          </>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
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
                {media.categories.map((c) => (
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

      <MediaPreview
        item={previewItem}
        open={previewItem !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null)
        }}
      />

      <OverwriteConfirmDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="Upload this file to Google?"
        description={
          pendingFile
            ? `“${pendingFile.name}” will be added as a ${humaniseCategory(category)} photo on your Google Business Profile.`
            : ""
        }
        confirmLabel="Upload"
        requireAcknowledgement={false}
        pending={upload.isPending}
        onConfirm={() => {
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

function MediaCard({
  item,
  disabled,
  updating,
  patchCategories,
  onOpen,
  onCategoryChange,
  onDelete,
}: {
  item: MediaItem
  disabled: boolean
  updating: boolean
  patchCategories: MediaCategory[]
  onOpen: () => void
  onCategoryChange: (category: MediaCategory) => void
  onDelete: () => void
}) {
  const customer = item.ownership === "customer"
  const patchable = isPatchableMediaCategory(item.category)
  const categoryLabel = humaniseCategory(item.category)
  const mediaKind = item.mediaFormat.toLowerCase()

  return (
    <li className="group overflow-hidden rounded-(--nr-radius-card) border border-border/70 bg-background shadow-sm transition-[border-color,box-shadow,transform] duration-(--nr-duration-fast) hover:-translate-y-0.5 hover:border-border hover:shadow-(--nr-shadow-card)">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${categoryLabel} ${mediaKind}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-muted text-left focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none focus-visible:ring-inset"
      >
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full object-cover transition-transform duration-(--nr-duration-deliberate) group-hover:scale-[1.02]"
          />
        ) : (
          <span
            className="flex size-full items-center justify-center text-muted-foreground"
            aria-hidden
          >
            <ImagesIcon className="size-6" />
          </span>
        )}
        <span
          aria-hidden
          className="absolute inset-0 bg-linear-to-t from-black/70 via-black/0 to-black/20"
        />
        <span className="absolute top-2 left-2">
          <Badge
            variant={customer ? "outline" : "secondary"}
            className="border-white/20 bg-black/55 text-white backdrop-blur-sm"
          >
            {customer ? (
              <UserRoundIcon aria-hidden data-icon="inline-start" />
            ) : (
              <StoreIcon aria-hidden data-icon="inline-start" />
            )}
            {customer ? "Customer" : "Business"}
          </Badge>
        </span>
        <span className="absolute right-2 bottom-2 left-2 flex items-end justify-between gap-2 text-white">
          <span className="min-w-0 truncate text-ui font-semibold">
            {categoryLabel}
          </span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
            <Maximize2Icon aria-hidden className="size-3.5" />
          </span>
        </span>
      </button>

      <div className="min-h-12 border-t border-border/60 p-2.5">
        {customer ? (
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <UserRoundIcon aria-hidden className="size-3.5 shrink-0" />
            <span>Shared by a customer</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1 text-ui">
              <span className="sr-only">Change category</span>
              <Select
                value={patchable ? item.category : null}
                onValueChange={(next) => {
                  if (next == null) return
                  onCategoryChange(next as MediaCategory)
                }}
                disabled={disabled || updating}
              >
                <SelectTrigger
                  className="h-7 w-full px-2"
                  aria-label={`Change category for ${categoryLabel} ${mediaKind}`}
                >
                  <SelectValue placeholder="Move to category…" />
                </SelectTrigger>
                <SelectContent>
                  {patchCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {humaniseCategory(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button
              variant="destructive"
              size="icon-sm"
              onClick={onDelete}
              disabled={disabled || updating}
              aria-label={`Delete ${categoryLabel} ${mediaKind}`}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

function MediaPreview({
  item,
  open,
  onOpenChange,
}: {
  item: MediaItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!item) return null

  const customer = item.ownership === "customer"
  const categoryLabel = humaniseCategory(item.category)
  const mediaKind = item.mediaFormat.toLowerCase()
  const created = formatMediaDate(item.createTime)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,52rem)] gap-4 overflow-y-auto p-3 sm:max-w-4xl sm:p-4">
        <DialogHeader className="pr-10">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{categoryLabel}</DialogTitle>
            <Badge variant={customer ? "outline" : "secondary"}>
              {customer ? `Customer ${mediaKind}` : `Business ${mediaKind}`}
            </Badge>
          </div>
          <DialogDescription>
            {created
              ? `Added ${created}`
              : `${humaniseCategory(mediaKind)} from your Google listing`}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-(--nr-radius-field) bg-black/90">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnailUrl}
              alt={`${categoryLabel} ${item.mediaFormat.toLowerCase()}`}
              referrerPolicy="no-referrer"
              className="max-h-[min(70vh,40rem)] w-full object-contain"
            />
          ) : (
            <div className="flex min-h-72 items-center justify-center text-white/60">
              <ImagesIcon aria-hidden className="size-8" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--nr-radius-field) bg-muted/50 px-3 py-2 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {customer ? (
              <UserRoundIcon aria-hidden className="size-3.5" />
            ) : (
              <StoreIcon aria-hidden className="size-3.5" />
            )}
            {customer ? "Shared by a customer" : "Uploaded by your business"}
          </span>
          {item.googleUrl ? (
            <a
              href={item.googleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
            >
              Open original
              <ExternalLinkIcon aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
