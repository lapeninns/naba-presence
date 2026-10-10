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
import { usePlaceActionReview } from "@/components/locations/place-actions/use-place-action-review"
import { SavedPlaceActionWork } from "@/components/locations/place-actions/saved-place-action-work"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
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
  type PlaceActionLink,
  type PlaceActionType,
  type PlaceActionsState,
} from "@/lib/api/location-booking"
import {
  ACTION_TYPE_COPY,
  actionTypeLabel,
  checkBookingUrl,
  hostOf,
  humaniseActionType,
} from "@/lib/editors/booking-presentation"
import { editorGate } from "@/lib/editors/gate"
import type { LocationCapabilities } from "@/lib/locations/gating"
import { usePlaceActions } from "@/lib/queries/use-location-booking"
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
  const workflow = usePlaceActionReview(locationId)
  return (
    <div id="section-action-links" className="flex min-w-0 flex-col gap-5">
    <LocationTab
      locationId={locationId}
      loadingLabel="action links"
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
            workflow={workflow}
          />
        </EditorFrame>
      )}
    </LocationTab>
    <SavedPlaceActionWork locationId={locationId} workflow={workflow} />
    </div>
  )
}

function formatObserved(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function BookingLinks({
  locationId,
  state,
  caps,
  writeReason,
  workflow,
}: {
  locationId: string
  state: PlaceActionsState
  caps: LocationCapabilities | undefined
  /** Why Google writes are blocked for this resource, or null. Booking links are Google-direct, so this is the only gate. */
  writeReason: string | null
  workflow: ReturnType<typeof usePlaceActionReview>
}) {
  const [deleteTarget, setDeleteTarget] = useState<PlaceActionLink | null>(null)
  const [editTarget, setEditTarget] = useState<PlaceActionLink | null>(null)
  const [preferTarget, setPreferTarget] = useState<PlaceActionLink | null>(null)
  const [confirmFailure, setConfirmFailure] = useState<string | null>(null)
  const disabled = writeReason !== null || workflow.busy || workflow.unresolved
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

  const remove = { isPending: workflow.busy, mutate: (link: PlaceActionLink) => void workflow.preview({ operation: "delete", name: link.googleLinkName }).then((result) => { if (result.ok) setDeleteTarget(null); else setConfirmFailure(result.error) }) }
  const prefer = { isPending: workflow.busy, mutate: (link: PlaceActionLink) => void workflow.preview({ operation: "update", name: link.googleLinkName, payload: placeActionInputSchema.parse({ uri: link.uri, placeActionType: link.placeActionType, isPreferred: true }) }).then((result) => { if (result.ok) setPreferTarget(null); else setConfirmFailure(result.error) }) }

  if (state.supportedTypes.length === 0 && state.links.length === 0) {
    const unsupported = Boolean(state.unsupportedTypes?.length || state.unsupportedLinks?.length)
    return (
      <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-(--np-radius-card) border border-line bg-surface">
        <Empty
          icon={<Unlink />}
          titleAs="h2"
          title={unsupported ? "Manage these action types in Google" : "Google doesn’t offer action links for this listing"}
          description={unsupported ? "Google returned action types this editor cannot safely edit. Open Google Business Profile to manage them." : "Google reports no action types for this exact listing. Check its category before preparing a new link."}
          action={
            unsupported ? <a href="https://business.google.com/" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "secondary" }))}>Manage action links in Google</a> : <Link
              href={`/listings/${locationId}/profile`}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Check categories
            </Link>
          }
        />
      </div>
      {/* The empty state above already carries the Google handoff. */}
      <GoogleManagedLinks links={state.unsupportedLinks ?? []} handoff={false} />
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
      {workflow.unresolved ? <Alert variant="info"><AlertTitle>Action link changes are paused</AlertTitle><AlertDescription>Read the saved outcome and refresh its observation before another action link change.</AlertDescription></Alert> : null}
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
            <AlertTitle>Google rejected the last change</AlertTitle>
            <AlertDescription>
              The last change ({latest.operation.toLowerCase()}) failed. The
              links below are what Google holds now.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="info">
            <AlertTitle>The last action link outcome needs a check</AlertTitle>
            <AlertDescription>
              The last change ({latest.operation.toLowerCase()}) has no confirmed
              outcome. Read its saved request before another change. The links
              below are what Google held when we last checked.
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
                title="No action links yet"
                description="Prepare a supported action link below. Review, approval and sending are separate steps; Google decides its public appearance."
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

          <GoogleManagedLinks links={state.unsupportedLinks ?? []} />

          <AddLinkForm
            state={state}
            disabled={disabled}
            workflow={workflow}
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
        title="Review removing this action link?"
        description={
          deleteTarget
            ? `Customers stop seeing it on the ${actionTypeLabel(deleteTarget.placeActionType)} button once Google accepts the change.`
            : "This removes the link from your Google Business Profile."
        }
        confirmLabel="Prepare removal review"
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
        confirmLabel="Prepare preferred link review"
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
        link={editTarget}
        others={state.links}
        workflow={workflow}
        disabled={disabled}
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
/** Links Google returned with an action type this release cannot model: listed read-only with a handoff. */
function GoogleManagedLinks({ links, handoff = true }: { links: NonNullable<PlaceActionsState["unsupportedLinks"]>; handoff?: boolean }) {
  if (links.length === 0) return null
  return (
    <section
      aria-labelledby="booking-google-managed"
      className="overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
    >
      <div className="flex flex-col gap-1 border-b border-line px-5 py-4">
        <h2 id="booking-google-managed" className="text-title font-semibold text-ink">
          Managed in Google
        </h2>
        <p className="text-ui text-ink-muted">
          Google lists {links.length === 1 ? "an action link" : "action links"} of a type this editor can’t change yet. They stay in place and are part of every review’s Google baseline.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {links.map((link) => (
          <li key={link.name} className="flex min-w-0 flex-col gap-1.5 px-5 py-3">
            <span className="font-mono text-[12.5px] break-all text-ink-secondary">{link.uri}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone="outline" plain>
                <Lock className="size-3" strokeWidth={1.75} aria-hidden />
                {humaniseActionType(link.placeActionType)}
              </StatusPill>
              <span className="text-caption text-ink-muted">Can’t be edited here</span>
            </span>
          </li>
        ))}
      </ul>
      {handoff ? (
        <div className="border-t border-line px-5 py-3">
          <a
            href="https://business.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            Manage these links in Google
          </a>
        </div>
      ) : null}
    </section>
  )
}

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
  state,
  disabled,
  workflow,
}: {
  state: PlaceActionsState
  disabled: boolean
  workflow: ReturnType<typeof usePlaceActionReview>
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
  const [failure, setFailure] = useState<string | null>(null)


  const sameType = state.links.filter((link) => link.placeActionType === type)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = checkBookingUrl(uri, sameType)
    setError(problem)
    if (problem) {
      uriRef.current?.focus()
      return
    }
    setFailure(null)
    if (!disabled) void workflow.preview({ operation: "create", payload: { uri: uri.trim(), placeActionType: type, isPreferred: preferred } }).then((result) => { if (!result.ok) setFailure(result.error) })
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
          Add an action link
        </h2>
        <p className="text-ui text-ink-muted">
          Prepare a review first. Approval saves the exact request; sending to Google is a separate action.
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
      {failure ? <FailureNote message={failure} /> : null}
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
          pending={workflow.busy}
          pendingLabel="Preparing review…"
        >
          Review action link
        </Button>
      </div>
    </form>
  )
}

function EditLinkDialog({
  link,
  others,
  onClose,
  workflow,
  disabled,
}: {
  link: PlaceActionLink | null
  others: PlaceActionLink[]
  onClose: () => void
  workflow: ReturnType<typeof usePlaceActionReview>
  disabled: boolean
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
            if (link && !disabled) void workflow.preview({ operation: "update", name: link.googleLinkName,
              payload: placeActionInputSchema.parse({ uri: uri.trim(), placeActionType: link.placeActionType, isPreferred: link.isPreferred }) }).then((result) => { if (result.ok) onClose(); else setFailure(result.error) })
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Edit {link ? actionTypeLabel(link.placeActionType) : ""} link
            </DialogTitle>
            <DialogDescription>
              Review this change before approval. Sending to Google is a separate action.
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
              pending={workflow.busy}
              pendingLabel="Preparing review…"
              disabled={disabled || !link || uri.trim() === link.uri}
            >
              Review action link change
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
