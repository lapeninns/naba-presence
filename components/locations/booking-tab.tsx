"use client"

import {
  Bike,
  CalendarCheck,
  Clock,
  Link2,
  Lock,
  Pencil,
  ShoppingBag,
  Store,
  Trash2,
  Unlink,
  Utensils,
  Video,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useId, useRef, useState } from "react"

import { CapabilityBanner } from "@/components/editors/capability-banner"
import { EditorFrame } from "@/components/editors/editor-frame"
import { LocationTab } from "@/components/locations/location-tab"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusPill } from "@/components/ui/status-pill"
import {
  createPlaceAction,
  deletePlaceAction,
  updatePlaceAction,
  type PlaceActionLink,
  type PlaceActionType,
  type PlaceActionsState,
} from "@/lib/api/location-booking"
import {
  ACTION_TYPE_COPY,
  actionTypeLabel,
  checkBookingUrl,
  hostOf,
} from "@/lib/editors/booking-presentation"
import { editorGate } from "@/lib/editors/gate"
import type { LocationCapabilities } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { usePlaceActions } from "@/lib/queries/use-location-booking"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { cn } from "@/lib/utils"

export { humaniseActionType } from "@/lib/editors/booking-presentation"

const TYPE_ICON: Record<string, LucideIcon> = {
  DINING_RESERVATION: CalendarCheck,
  FOOD_ORDERING: Utensils,
  FOOD_DELIVERY: Bike,
  FOOD_TAKEOUT: ShoppingBag,
  APPOINTMENT: Clock,
  ONLINE_APPOINTMENT: Video,
  SHOP_ONLINE: Store,
}

export function BookingTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="booking links"
      useResource={usePlaceActions}
      resource="booking"
    >
      {({ data: state, caps, publishReason }) => (
        <EditorFrame title="Booking links" titleHidden>
          <BookingLinks
            locationId={locationId}
            state={state}
            caps={caps}
            writeReason={publishReason}
          />
        </EditorFrame>
      )}
    </LocationTab>
  )
}

function formatObserved(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/**
 * Booking links (reference listing-booking): the links Google holds, grouped
 * by the button they sit behind, an "add" form, and a sketch of the buttons
 * a customer sees. Every change here is a direct Google write confirmed in a
 * dialog first; there is no NabaPresence copy and no review step.
 */
function BookingLinks({
  locationId,
  state,
  caps,
  writeReason,
}: {
  locationId: string
  state: PlaceActionsState
  caps: LocationCapabilities | undefined
  /** Why Google writes are blocked for this resource, or null. Booking links are Google-direct, so this is the only gate. */
  writeReason: string | null
}) {
  const [deleteTarget, setDeleteTarget] = useState<PlaceActionLink | null>(null)
  const [editTarget, setEditTarget] = useState<PlaceActionLink | null>(null)
  const [preferTarget, setPreferTarget] = useState<PlaceActionLink | null>(null)
  const [confirmFailure, setConfirmFailure] = useState<string | null>(null)
  const disabled = writeReason !== null
  const gate = editorGate({
    caps,
    resource: "booking",
    // Every booking change is a Google write, so for someone who can't edit
    // the location at all (a viewer) the gate is "look, don't change", not a
    // publishing limit an owner could work around.
    editReason: caps && !caps.canEditCanonical ? writeReason : null,
    publishReason: writeReason,
    noun: "these links",
    savesHere: false,
  })

  const remove = useResourceMutation({
    mutationFn: (link: PlaceActionLink) =>
      deletePlaceAction(locationId, link.id, {
        expectedGoogleHash: link.googleHash,
      }),
    invalidate: [queryKeys.locationBooking(locationId)],
    successToast: "Booking link removed",
    onSuccess: () => setDeleteTarget(null),
    onError: (_error, message) => setConfirmFailure(message),
  })

  const prefer = useResourceMutation({
    mutationFn: (link: PlaceActionLink) =>
      updatePlaceAction(locationId, link.id, {
        uri: link.uri,
        placeActionType: link.placeActionType as PlaceActionType,
        isPreferred: true,
        expectedGoogleHash: link.googleHash,
      }),
    invalidate: [queryKeys.locationBooking(locationId)],
    successToast: "Preferred link sent to Google",
    onSuccess: () => setPreferTarget(null),
    onError: (_error, message) => setConfirmFailure(message),
  })

  if (state.supportedTypes.length === 0 && state.links.length === 0) {
    return (
      <div className="rounded-(--np-radius-card) border border-line bg-surface">
        <Empty
          icon={<Unlink />}
          titleAs="h2"
          title="Google doesn’t offer booking links for this listing"
          description="Google reports no Reserve, Order or Book buttons this listing can show, so there’s nothing to manage here. The primary category usually decides this."
          action={
            <Link
              href={`/listings/${locationId}/profile`}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Check categories
            </Link>
          }
        />
      </div>
    )
  }

  // Types in Google's order, then any a link carries that Google no longer
  // lists as supported (so an existing link never disappears from view).
  const groupTypes = [
    ...state.supportedTypes.filter((type) =>
      state.links.some((link) => link.placeActionType === type)
    ),
    ...[...new Set(state.links.map((link) => link.placeActionType))].filter(
      (type) => !(state.supportedTypes as readonly string[]).includes(type)
    ),
  ]
  const latest = state.latestMutation
  const hasProviderLinks = state.links.some((link) => !link.isEditable)

  return (
    <div className="@container/booking flex flex-col gap-5">
      {gate ? (
        <CapabilityBanner
          tone={gate.tone}
          title={gate.title}
          description={gate.description}
          code={gate.code}
        />
      ) : null}

      {latest && latest.status !== "succeeded" ? (
        latest.status === "failed" ? (
          <Alert variant="destructive" role="status">
            <AlertTitle>The last change didn’t reach Google</AlertTitle>
            <AlertDescription>
              The last change ({latest.operation.toLowerCase()}) failed. The
              links below are what Google holds now.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="info">
            <AlertTitle>Sent to Google — waiting for confirmation</AlertTitle>
            <AlertDescription>
              The last change ({latest.operation.toLowerCase()}) hasn’t been
              confirmed yet. The links below are what Google held when we last
              checked.
            </AlertDescription>
          </Alert>
        )
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 @[880px]/booking:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {state.links.length === 0 ? (
            <div className="rounded-(--np-radius-card) border border-line bg-surface">
              <Empty
                icon={<Link2 />}
                titleAs="h2"
                title="No booking links yet"
                description="Customers can’t reserve or order from this listing. Add a link below and the button appears on Google as soon as Google accepts it."
              />
            </div>
          ) : (
            groupTypes.map((type) => {
              const links = state.links.filter(
                (link) => link.placeActionType === type
              )
              const Icon = TYPE_ICON[type] ?? Link2
              const headingId = `booking-${type}`
              return (
                <section
                  key={type}
                  aria-labelledby={headingId}
                  className="@container/group overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Icon
                        className="mt-0.5 size-4 shrink-0 text-ink-secondary"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <h2
                          id={headingId}
                          className="text-title font-semibold text-ink"
                        >
                          {actionTypeLabel(type)}
                        </h2>
                        {ACTION_TYPE_COPY[type] ? (
                          <p className="text-ui text-ink-muted">
                            {ACTION_TYPE_COPY[type].description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-caption text-ink-muted tabular-nums">
                      {links.length} {links.length === 1 ? "link" : "links"}
                    </span>
                  </div>
                  <ul className="divide-y divide-line">
                    {links.map((link) => {
                      const observed = formatObserved(link.observedAt)
                      return (
                        <li
                          key={link.id}
                          className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-5 py-3 @[560px]/group:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <span className="font-mono text-[12.5px] break-all text-ink-secondary">
                              {link.uri}
                            </span>
                            <span className="flex flex-wrap items-center gap-1.5">
                              {link.isPreferred ? (
                                <StatusPill tone="accent">Preferred</StatusPill>
                              ) : null}
                              {!link.isEditable ? (
                                <StatusPill tone="outline" plain>
                                  <Lock
                                    className="size-3"
                                    strokeWidth={1.75}
                                    aria-hidden
                                  />
                                  Managed by Google
                                </StatusPill>
                              ) : null}
                              <span className="text-caption text-ink-muted">
                                {!link.isEditable
                                  ? "Added by a booking provider · can’t be edited here"
                                  : observed
                                    ? `Checked on Google ${observed}`
                                    : null}
                              </span>
                            </span>
                          </div>
                          {link.isEditable ? (
                            <div className="-ml-2.5 flex flex-wrap gap-1 @[560px]/group:ml-0 @[560px]/group:justify-end">
                              {!link.isPreferred && links.length > 1 ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={disabled}
                                  onClick={() => setPreferTarget(link)}
                                  aria-label={`Make this the preferred ${actionTypeLabel(type)} link`}
                                >
                                  Make preferred
                                </Button>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={disabled}
                                onClick={() => setEditTarget(link)}
                                aria-label={`Edit the ${actionTypeLabel(type)} link`}
                              >
                                <Pencil aria-hidden />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteTarget(link)}
                                disabled={disabled}
                                aria-label={`Remove the ${actionTypeLabel(type)} link`}
                              >
                                <Trash2 aria-hidden />
                                Remove
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })
          )}

          {hasProviderLinks ? (
            <p className="text-caption text-ink-muted">
              Links a booking provider added through Google’s partner programme
              belong to that provider. Only they can change or remove them.
            </p>
          ) : null}

          <AddLinkForm
            locationId={locationId}
            state={state}
            disabled={disabled}
          />
        </div>

        <BookingPreview links={state.links} />
      </div>

      <OverwriteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setDeleteTarget(null)
          setConfirmFailure(null)
        }}
        title="Remove this booking link from Google?"
        description={
          deleteTarget
            ? `Customers stop seeing it on the ${actionTypeLabel(deleteTarget.placeActionType)} button once Google accepts the change.`
            : "This removes the link from your Google Business Profile."
        }
        confirmLabel="Remove"
        confirmVariant="danger"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => {
          setConfirmFailure(null)
          if (deleteTarget) remove.mutate(deleteTarget)
        }}
      >
        {deleteTarget ? <UriPreview uri={deleteTarget.uri} /> : null}
        {confirmFailure ? <FailureNote message={confirmFailure} /> : null}
      </OverwriteConfirmDialog>

      <OverwriteConfirmDialog
        open={preferTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setPreferTarget(null)
          setConfirmFailure(null)
        }}
        title={
          preferTarget
            ? `Make this the preferred ${actionTypeLabel(preferTarget.placeActionType)} link?`
            : "Make this the preferred link?"
        }
        description="Google shows the preferred link first on the button. The other links stay on the listing."
        confirmLabel="Send to Google"
        requireAcknowledgement={false}
        pending={prefer.isPending}
        onConfirm={() => {
          setConfirmFailure(null)
          if (preferTarget) prefer.mutate(preferTarget)
        }}
      >
        {preferTarget ? <UriPreview uri={preferTarget.uri} /> : null}
        {confirmFailure ? <FailureNote message={confirmFailure} /> : null}
      </OverwriteConfirmDialog>

      <EditLinkDialog
        locationId={locationId}
        link={editTarget}
        others={state.links}
        onClose={() => setEditTarget(null)}
      />
    </div>
  )
}

/** A failed Google write, said where the operator is looking. */
function FailureNote({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-3 text-ui text-danger-ink">
      {message}
    </p>
  )
}

function UriPreview({ uri }: { uri: string }) {
  return (
    <p className="rounded-(--np-radius-control) border border-line bg-surface-alt px-3 py-2 font-mono text-caption break-all text-ink-secondary">
      {uri}
    </p>
  )
}

/** "How customers see it": the buttons Google would draw, from real links only. */
function BookingPreview({ links }: { links: PlaceActionLink[] }) {
  const types = [...new Set(links.map((link) => link.placeActionType))]
  const headingId = useId()
  return (
    <aside
      aria-labelledby={headingId}
      className="flex flex-col gap-2.5 @[880px]/booking:sticky @[880px]/booking:top-4"
    >
      <h2 id={headingId} className="text-title font-semibold text-ink">
        How customers see it
      </h2>
      <div className="overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
        <div className="flex flex-wrap gap-2 p-4">
          {types.length === 0 ? (
            <span className="text-caption text-ink-muted">
              No buttons show yet.
            </span>
          ) : (
            types.map((type) => {
              const Icon = TYPE_ICON[type] ?? Link2
              const preferred =
                links.find(
                  (link) => link.placeActionType === type && link.isPreferred
                ) ?? links.find((link) => link.placeActionType === type)
              return (
                <span
                  key={type}
                  title={preferred?.uri}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-(--np-radius-pill) border border-line-strong bg-surface px-3.5 text-ui font-semibold text-info-ink"
                >
                  <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {actionTypeLabel(type)}
                </span>
              )
            })
          )}
        </div>
        <p className="border-t border-line bg-surface-alt px-4 py-2.5 text-caption text-ink-muted">
          Illustration only. Google decides the final layout, and may hide a
          button it can’t verify.
        </p>
      </div>
      {types.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
          {types.map((type) => {
            const preferred =
              links.find(
                (link) => link.placeActionType === type && link.isPreferred
              ) ?? links.find((link) => link.placeActionType === type)
            return (
              <div key={type} className="contents">
                <dt className="text-ink-muted">{actionTypeLabel(type)}</dt>
                <dd className="font-mono text-caption break-all text-ink-secondary">
                  {preferred ? hostOf(preferred.uri) : ""}
                </dd>
              </div>
            )
          })}
        </dl>
      ) : null}
    </aside>
  )
}

function AddLinkForm({
  locationId,
  state,
  disabled,
}: {
  locationId: string
  state: PlaceActionsState
  disabled: boolean
}) {
  const headingId = useId()
  const uriId = useId()
  const uriRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<PlaceActionType>(
    // A table reservation is the button most listings here want first.
    state.supportedTypes.includes("DINING_RESERVATION")
      ? "DINING_RESERVATION"
      : ((state.supportedTypes[0] as PlaceActionType) ?? "DINING_RESERVATION")
  )
  const [uri, setUri] = useState("")
  const [preferred, setPreferred] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = useResourceMutation({
    mutationFn: () =>
      createPlaceAction(locationId, {
        uri: uri.trim(),
        placeActionType: type,
        isPreferred: preferred,
      }),
    invalidate: [queryKeys.locationBooking(locationId)],
    successToast: "Booking link added",
    onSuccess: () => {
      setUri("")
      setPreferred(false)
      setError(null)
    },
  })

  const sameType = state.links.filter((link) => link.placeActionType === type)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = checkBookingUrl(uri, sameType)
    setError(problem)
    if (problem) {
      uriRef.current?.focus()
      return
    }
    add.mutate()
  }

  if (state.supportedTypes.length === 0) return null

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Add a booking link
        </h2>
        <p className="text-ui text-ink-muted">
          The link goes to Google as soon as you add it.
        </p>
      </div>
      <div className="grid gap-4 @[560px]/booking:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @[560px]/booking:items-start">
        <Field>
          <FieldLabel>Type</FieldLabel>
          <Select
            value={type}
            onValueChange={(next) => setType(next as PlaceActionType)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full" aria-label="Booking link type">
              <SelectValue>
                {(value: string | null) =>
                  value ? actionTypeLabel(value) : ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {state.supportedTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {actionTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field error={error ?? undefined}>
          <FieldLabel htmlFor={uriId}>Link</FieldLabel>
          <Input
            ref={uriRef}
            id={uriId}
            type="url"
            value={uri}
            onChange={(event) => {
              setUri(event.target.value)
              if (error) setError(checkBookingUrl(event.target.value, sameType))
            }}
            placeholder="https://…"
            inputMode="url"
            autoComplete="off"
            disabled={disabled}
          />
          <FieldError />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Checkbox
          checked={preferred}
          onCheckedChange={(value) => setPreferred(value === true)}
          disabled={disabled}
          label="Make this the preferred link"
          description="Google shows the preferred link first when a button has more than one."
          labelClassName="text-ui"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled}
          pending={add.isPending}
          pendingLabel="Sending to Google…"
        >
          Add booking link
        </Button>
      </div>
    </form>
  )
}

function EditLinkDialog({
  locationId,
  link,
  others,
  onClose,
}: {
  locationId: string
  link: PlaceActionLink | null
  others: PlaceActionLink[]
  onClose: () => void
}) {
  const uriId = useId()
  const uriRef = useRef<HTMLInputElement>(null)
  const [uri, setUri] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [shownFor, setShownFor] = useState<string | null>(null)
  if ((link?.id ?? null) !== shownFor) {
    setShownFor(link?.id ?? null)
    setUri(link?.uri ?? "")
    setError(null)
    setFailure(null)
  }

  const update = useResourceMutation({
    mutationFn: () => {
      if (!link) throw new Error("No link selected.")
      return updatePlaceAction(locationId, link.id, {
        uri: uri.trim(),
        placeActionType: link.placeActionType as PlaceActionType,
        isPreferred: link.isPreferred,
        expectedGoogleHash: link.googleHash,
      })
    },
    invalidate: [queryKeys.locationBooking(locationId)],
    successToast: "Booking link sent to Google",
    onSuccess: onClose,
    // The toast goes away; the dialog keeps the link and says what happened.
    onError: (_error, message) => setFailure(message),
  })

  const sameType = link
    ? others.filter(
        (other) =>
          other.id !== link.id && other.placeActionType === link.placeActionType
      )
    : []

  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const problem = checkBookingUrl(uri, sameType)
            setError(problem)
            setFailure(null)
            if (problem) {
              uriRef.current?.focus()
              return
            }
            update.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Edit {link ? actionTypeLabel(link.placeActionType) : ""} link
            </DialogTitle>
            <DialogDescription>
              The new link replaces this one on Google as soon as you save.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field error={error ?? undefined}>
              <FieldLabel htmlFor={uriId}>Link</FieldLabel>
              <Input
                ref={uriRef}
                id={uriId}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={uri}
                onChange={(event) => {
                  setUri(event.target.value)
                  if (error)
                    setError(checkBookingUrl(event.target.value, sameType))
                }}
              />
              <FieldError />
            </Field>
            {failure ? <FailureNote message={failure} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              pending={update.isPending}
              pendingLabel="Sending to Google…"
              disabled={!link || uri.trim() === link.uri}
            >
              Save to Google
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
