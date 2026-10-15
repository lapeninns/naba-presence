"use client"

import {
  Bike,
  CalendarCheck,
  Clock,
  Link2,
  Lock,
  MoreHorizontal,
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
import { DiscardDialog } from "@/components/editors/discard-dialog"
import { DraftNotices } from "@/components/editors/draft-notices"
import { EditorFrame } from "@/components/editors/editor-frame"
import { GoogleFreshness } from "@/components/editors/google-freshness"
import { LocationTab } from "@/components/locations/location-tab"
import { usePlaceActionReview } from "@/components/locations/place-actions/use-place-action-review"
import { SavedPlaceActionWork } from "@/components/locations/place-actions/saved-place-action-work"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ActionBar } from "@/components/ui/action-bar"
import { Button, buttonVariants } from "@/components/ui/button"
import { cardClassName } from "@/components/ui/card"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ListRow, ListRowTag } from "@/components/ui/list-row"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes"
import type { LocationCapabilities } from "@/lib/locations/gating"
import {
  usePlaceActions,
  useRefreshPlaceActions,
} from "@/lib/queries/use-location-booking"
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
    <div id="section-action-links" className="flex min-w-0 flex-col gap-6">
      <LocationTab
        locationId={locationId}
        loadingLabel="booking links"
        useResource={usePlaceActions}
        resource="booking"
      >
        {({ data: state, caps, publishReason }) => (
          <EditorFrame title="Booking links" titleHidden>
            <PlaceActionsFreshness
              locationId={locationId}
              observedAt={state.observedAt}
            />
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

/** "Checked with Google N min ago · Check Google now" for the links. */
function PlaceActionsFreshness({
  locationId,
  observedAt,
}: {
  locationId: string
  observedAt: string | undefined
}) {
  const refresh = useRefreshPlaceActions(locationId)
  return (
    <GoogleFreshness
      observedAt={observedAt}
      refreshing={refresh.isPending}
      failed={refresh.isError}
      onRefresh={() => refresh.mutate()}
    />
  )
}

function formatObserved(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/**
 * Link rows sit in a `SettingsGroup` (flat on a phone, a bordered card on
 * the desk), as `ListRow`s that carry their own actions in the footer: flush
 * to the text column on a phone, inset inside the desk card.
 */
const linkRowClassName = "desk:px-2"
/** A plain block inside a desk card group, aligned with the rows' words. */
const cardBlockClassName = "py-2 desk:px-2"
/** A group's label: a quiet heading in sentence case, never a card title. */
const groupLabelClassName = "text-caption font-medium text-ink-muted"

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

  // Both confirmations only prepare a review (workflow.preview): nothing is
  // sent to Google until the review is approved and sent separately.
  const prepareRemoval = (link: PlaceActionLink) => {
    void workflow
      .preview({ operation: "delete", name: link.googleLinkName })
      .then((result) => {
        if (result.ok) setDeleteTarget(null)
        else setConfirmFailure(result.error)
      })
  }
  const preparePreferred = (link: PlaceActionLink) => {
    void workflow
      .preview({
        operation: "update",
        name: link.googleLinkName,
        payload: placeActionInputSchema.parse({
          uri: link.uri,
          placeActionType: link.placeActionType,
          isPreferred: true,
        }),
      })
      .then((result) => {
        if (result.ok) setPreferTarget(null)
        else setConfirmFailure(result.error)
      })
  }

  if (state.supportedTypes.length === 0 && state.links.length === 0) {
    const unsupported = Boolean(
      state.unsupportedTypes?.length || state.unsupportedLinks?.length
    )
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Empty
          framed
          icon={<Unlink />}
          titleAs="h2"
          title={
            unsupported
              ? "Manage these action types in Google"
              : "Google doesn’t offer booking links for this listing"
          }
          description={
            unsupported
              ? "Google returned action types this editor cannot safely edit. Open Google Business Profile to manage them."
              : "Google reports no action types for this exact listing. Check its category before preparing a new link."
          }
          action={
            unsupported ? (
              <a
                href="https://business.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                Manage booking links in Google
              </a>
            ) : (
              <Link
                href={`/listings/${locationId}/profile`}
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                Check categories
              </Link>
            )
          }
        />
        {/* The empty state above already carries the Google handoff. */}
        <GoogleManagedLinks
          links={state.unsupportedLinks ?? []}
          handoff={false}
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
    <div className="@container/booking flex flex-col gap-6">
      {workflow.unresolved ? (
        <Alert variant="info">
          <AlertTitle>Booking link changes are paused</AlertTitle>
          <AlertDescription>
            Read the saved outcome and refresh its observation before another
            booking link change.
          </AlertDescription>
        </Alert>
      ) : null}
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
            <AlertTitle>The last booking link outcome needs a check</AlertTitle>
            <AlertDescription>
              The last change ({latest.operation.toLowerCase()}) has no
              confirmed outcome. Read its saved request before another change.
              The links below are what Google held when we last checked.
            </AlertDescription>
          </Alert>
        )
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 @4xl/booking:grid-cols-[minmax(0,1fr)_--spacing(80)]">
        <div className="flex min-w-0 flex-col gap-6">
          {state.links.length === 0 ? (
            <Empty
              framed
              icon={<Link2 />}
              titleAs="h2"
              title="No booking links yet"
              description="Add a booking link below. Google decides how it appears publicly."
            />
          ) : (
            groupTypes.map((type) => {
              const links = state.links.filter(
                (link) => link.placeActionType === type
              )
              const Icon = TYPE_ICON[type] ?? Link2
              return (
                <SettingsGroup
                  key={type}
                  headingId={`booking-${type}`}
                  className="mt-0 min-w-0"
                  card
                  label={
                    <span className="inline-flex items-center gap-2">
                      <Icon
                        className="size-4 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {actionTypeLabel(type)}
                    </span>
                  }
                  caption={ACTION_TYPE_COPY[type]?.description}
                  actions={
                    <span className="text-caption text-ink-muted tabular-nums">
                      {links.length} {links.length === 1 ? "link" : "links"}
                    </span>
                  }
                  listProps={{ className: "divide-y divide-line-subtle" }}
                >
                  {links.map((link) => {
                    const observed = formatObserved(link.observedAt)
                    const note = !link.isEditable
                      ? "Added by a booking provider · can’t be edited here"
                      : observed
                        ? `Checked on Google ${observed}`
                        : null
                    return (
                      <ListRow
                        key={link.id}
                        as="li"
                        flush
                        wrap
                        interactive={false}
                        emphasis="neutral"
                        wrapperClassName={linkRowClassName}
                        title={link.uri}
                        subtitle={
                          !link.isEditable || note ? (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption">
                              {!link.isEditable ? (
                                <span className="inline-flex items-center gap-1 font-medium text-ink-secondary">
                                  <Lock
                                    className="size-3"
                                    strokeWidth={1.75}
                                    aria-hidden
                                  />
                                  Managed by Google
                                </span>
                              ) : null}
                              <span className="text-ink-muted">{note}</span>
                            </span>
                          ) : undefined
                        }
                        tags={
                          link.isPreferred ? (
                            <ListRowTag tone="accent">Preferred</ListRowTag>
                          ) : undefined
                        }
                        footer={
                          link.isEditable ? (
                            <LinkActions
                              typeLabel={actionTypeLabel(type)}
                              canPrefer={!link.isPreferred && links.length > 1}
                              disabled={disabled}
                              onEdit={() => setEditTarget(link)}
                              onPrefer={() => setPreferTarget(link)}
                              onRemove={() => setDeleteTarget(link)}
                            />
                          ) : undefined
                        }
                      />
                    )
                  })}
                </SettingsGroup>
              )
            })
          )}

          {hasProviderLinks ? (
            <p className="text-caption text-ink-muted sm:px-1">
              Links a booking provider added through Google’s partner programme
              belong to that provider. Only they can change or remove them.
            </p>
          ) : null}

          <GoogleManagedLinks links={state.unsupportedLinks ?? []} />

          <AddLinkForm
            locationId={locationId}
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
        title="Review removing this booking link?"
        description={
          deleteTarget
            ? `Customers stop seeing it on the ${actionTypeLabel(deleteTarget.placeActionType)} button once Google accepts the change.`
            : "This removes the link from your Google Business Profile."
        }
        confirmLabel="Prepare removal review"
        confirmVariant="danger"
        requireAcknowledgement={false}
        pending={workflow.busy}
        pendingLabel="Preparing review…"
        onConfirm={() => {
          setConfirmFailure(null)
          if (deleteTarget) prepareRemoval(deleteTarget)
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
        pending={workflow.busy}
        pendingLabel="Preparing review…"
        onConfirm={() => {
          setConfirmFailure(null)
          if (preferTarget) preparePreferred(preferTarget)
        }}
      >
        {preferTarget ? <UriPreview uri={preferTarget.uri} /> : null}
        {confirmFailure ? <FailureNote message={confirmFailure} /> : null}
      </OverwriteConfirmDialog>

      <EditLinkDialog
        locationId={locationId}
        link={editTarget}
        others={state.links}
        workflow={workflow}
        disabled={disabled}
        onClose={() => setEditTarget(null)}
      />
    </div>
  )
}

/**
 * A link row's actions: Edit stays visible as the one direct action; making
 * it preferred and removing it sit in an overflow menu (an action sheet on a
 * phone), with the destructive Remove last. Remove still opens its own
 * confirmation, which only prepares a review.
 */
function LinkActions({
  typeLabel,
  canPrefer,
  disabled,
  onEdit,
  onPrefer,
  onRemove,
}: {
  typeLabel: string
  canPrefer: boolean
  disabled: boolean
  onEdit: () => void
  onPrefer: () => void
  onRemove: () => void
}) {
  return (
    <div className="-ml-2.5 flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="text-ink-secondary"
        disabled={disabled}
        onClick={onEdit}
        aria-label={`Edit the ${typeLabel} link`}
      >
        <Pencil aria-hidden />
        Edit
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`More actions for the ${typeLabel} link`}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent title={`${typeLabel} link`}>
          {canPrefer ? (
            <>
              <DropdownMenuItem onClick={onPrefer}>
                Make preferred
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <Trash2 aria-hidden />
            Remove link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
function GoogleManagedLinks({
  links,
  handoff = true,
}: {
  links: NonNullable<PlaceActionsState["unsupportedLinks"]>
  handoff?: boolean
}) {
  if (links.length === 0) return null
  return (
    <SettingsGroup
      label="Managed in Google"
      headingId="booking-google-managed"
      className="mt-0 min-w-0"
      card
      caption={
        <>
          Google lists {links.length === 1 ? "a booking link" : "booking links"}{" "}
          of a type this editor can’t change yet. They stay in place and are
          part of every review’s Google baseline.
        </>
      }
      listProps={{ className: "divide-y divide-line-subtle" }}
      footer={
        handoff ? (
          <a
            href="https://business.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "text-accent-ink"
            )}
          >
            Manage these links in Google
          </a>
        ) : undefined
      }
    >
      {links.map((link) => (
        <ListRow
          key={link.name}
          as="li"
          flush
          wrap
          interactive={false}
          emphasis="neutral"
          wrapperClassName={linkRowClassName}
          title={link.uri}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption">
              <span className="inline-flex items-center gap-1 font-medium text-ink-secondary">
                <Lock className="size-3" strokeWidth={1.75} aria-hidden />
                {humaniseActionType(link.placeActionType)}
              </span>
              <span className="text-ink-muted">Can’t be edited here</span>
            </span>
          }
        />
      ))}
    </SettingsGroup>
  )
}

function BookingPreview({ links }: { links: PlaceActionLink[] }) {
  const types = [...new Set(links.map((link) => link.placeActionType))]
  const headingId = useId()
  return (
    <aside
      aria-labelledby={headingId}
      className="flex flex-col gap-2 @4xl/booking:sticky @4xl/booking:top-4"
    >
      <h2 id={headingId} className={cn(groupLabelClassName, "sm:px-1")}>
        How customers see it
      </h2>
      <div className={cardClassName({ className: "overflow-hidden" })}>
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
                  className="inline-flex h-9 items-center gap-1.5 rounded-(--np-radius-pill) border border-line-strong bg-surface px-3.5 text-ui font-medium text-ink"
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
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui sm:px-1">
          {types.map((type) => {
            const preferred =
              links.find(
                (link) => link.placeActionType === type && link.isPreferred
              ) ?? links.find((link) => link.placeActionType === type)
            return (
              <div key={type} className="contents">
                <dt className="text-ink-muted">{actionTypeLabel(type)}</dt>
                <dd className="break-all text-ink-secondary">
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

type NewLink = { type: PlaceActionType; uri: string; preferred: boolean }

/** A new link's untouched form: the type picker alone is not an edit. */
function sameNewLink(a: NewLink, b: NewLink): boolean {
  return a.uri.trim() === b.uri.trim() && a.preferred === b.preferred
}

function parseNewLink(value: unknown): NewLink | null {
  if (!value || typeof value !== "object") return null
  const { type, uri, preferred } = value as Record<string, unknown>
  return typeof type === "string" &&
    typeof uri === "string" &&
    typeof preferred === "boolean"
    ? { type: type as PlaceActionType, uri, preferred }
    : null
}

function AddLinkForm({
  locationId,
  state,
  disabled,
  workflow,
}: {
  locationId: string
  state: PlaceActionsState
  disabled: boolean
  workflow: ReturnType<typeof usePlaceActionReview>
}) {
  const headingId = useId()
  const uriId = useId()
  const uriRef = useRef<HTMLInputElement>(null)
  // A typed link survives a refetch, asks before the page is left, and is
  // offered back after a forced sign-out or an unmount.
  // A table reservation is the button most listings here want first.
  const defaultType: PlaceActionType = state.supportedTypes.includes(
    "DINING_RESERVATION"
  )
    ? "DINING_RESERVATION"
    : ((state.supportedTypes[0] as PlaceActionType) ?? "DINING_RESERVATION")
  const editor = useEditorDraft<NewLink>({
    initial: {
      type: defaultType,
      uri: "",
      preferred: false,
    },
    revision: "new",
    scope: {
      resource: "location-place-action-new",
      resourceId: locationId,
      schemaVersion: 1,
    },
    parseStashed: parseNewLink,
    isEqual: sameNewLink,
  })
  const { uri, preferred } = editor.draft
  // A draft offered back may carry a type Google no longer supports here.
  const type = state.supportedTypes.includes(editor.draft.type)
    ? editor.draft.type
    : defaultType
  const setType = (next: PlaceActionType) =>
    editor.setDraft((current) => ({ ...current, type: next }))
  const setUri = (next: string) =>
    editor.setDraft((current) => ({ ...current, uri: next }))
  const setPreferred = (next: boolean) =>
    editor.setDraft((current) => ({ ...current, preferred: next }))
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [typeOpen, setTypeOpen] = useState(false)

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
    // Once the review is prepared the request is saved with it, so the form
    // empties rather than holding a copy that would ask before leaving.
    if (disabled) return
    void workflow
      .preview({
        operation: "create",
        payload: {
          uri: uri.trim(),
          placeActionType: type,
          isPreferred: preferred,
        },
      })
      .then((result) => {
        if (result.ok) editor.discard()
        else setFailure(result.error)
      })
  }

  if (state.supportedTypes.length === 0) return null

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col"
    >
      <SettingsGroup
        label="Add a booking link"
        headingId={headingId}
        caption="Review comes first. Nothing reaches Google until you approve and send it."
        bodyAs="div"
        card
        className="mt-0"
      >
        <DraftNotices drafts={[editor]} noun="this booking link" />
        {/* The type is a short choice list: a row that opens it, or plain
            text when Google supports only one. */}
        {state.supportedTypes.length > 1 ? (
          <SettingsRow
            label="Type"
            value={actionTypeLabel(type)}
            disabled={disabled}
            onClick={() => setTypeOpen(true)}
          />
        ) : (
          <SettingsRow label="Type" value={actionTypeLabel(type)} />
        )}
        <div className={cardBlockClassName}>
          <Field error={error ?? undefined}>
            <FieldLabel htmlFor={uriId}>Link</FieldLabel>
            <Input
              ref={uriRef}
              id={uriId}
              type="url"
              value={uri}
              onChange={(event) => {
                setUri(event.target.value)
                if (error)
                  setError(checkBookingUrl(event.target.value, sameType))
              }}
              placeholder="https://…"
              inputMode="url"
              autoComplete="off"
              disabled={disabled}
            />
            <FieldError />
          </Field>
          {failure ? <FailureNote message={failure} /> : null}
        </div>
        <div className={cardBlockClassName}>
          <Checkbox
            checked={preferred}
            onCheckedChange={(value) => setPreferred(value === true)}
            disabled={disabled}
            label="Make this the preferred link"
            description="Google shows the preferred link first when a button has more than one."
            labelClassName="text-ui"
          />
        </div>
      </SettingsGroup>
      {/* The action appears once there is a link to review, docked on a
          phone so the thumb reaches it. */}
      <ActionBar
        dock
        sticky={false}
        safeArea={false}
        label="Booking link actions"
        // Kept on screen while the review is being prepared (its button then
        // reads "Preparing review…"): unmounting the focused button dropped
        // focus to the page, and a failed review left it there.
        visible={uri.trim() !== "" && (!disabled || workflow.busy)}
        status="Ready to review. Nothing is sent to Google yet."
        actions={
          <Button
            type="submit"
            pending={workflow.busy}
            pendingLabel="Preparing review…"
          >
            Review booking link
          </Button>
        }
      />
      <Sheet open={typeOpen} onOpenChange={setTypeOpen}>
        <SheetContent variant="inset">
          <SheetHeader>
            <SheetTitle>Booking link type</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <OptionRowGroup applyOnChoose label="Booking link type">
              {state.supportedTypes.map((t) => (
                <OptionRow
                  key={t}
                  indicator="check"
                  selected={t === type}
                  label={actionTypeLabel(t)}
                  onClick={() => {
                    setType(t as PlaceActionType)
                    setTypeOpen(false)
                  }}
                />
              ))}
            </OptionRowGroup>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </form>
  )
}

function EditLinkDialog({
  locationId,
  link,
  others,
  onClose,
  workflow,
  disabled,
}: {
  locationId: string
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
  const isDirty = link !== null && uri.trim() !== link.uri

  // Warns on a reload; closing the dialog or leaving the page with it asks
  // first. Nothing offers an edited link back once the dialog is gone, so
  // the edit is not stashed.
  const { leavePrompt: leave, forget: markDiscarded } = useUnsavedChanges({
    scope: `location-place-action-edit/${locationId}/${link?.id ?? ""}`,
    isDirty,
  })

  const sameType = link
    ? others.filter(
        (other) =>
          other.id !== link.id && other.placeActionType === link.placeActionType
      )
    : []

  return (
    // The Dialog's own guard asks before a swipe, Escape, a scrim tap or the
    // ✕ throws the edit away; Cancel is a deliberate discard.
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (open) return
        markDiscarded()
        onClose()
      }}
      dirty={isDirty}
      onDiscard={markDiscarded}
      discardPrompt={{
        title: "Close without saving?",
        description:
          "Your edit to this link isn’t saved. Closing throws it away. Google is not affected.",
        confirmLabel: "Close and discard",
      }}
    >
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
            if (!link || disabled) return
            void workflow
              .preview({
                operation: "update",
                name: link.googleLinkName,
                payload: placeActionInputSchema.parse({
                  uri: uri.trim(),
                  placeActionType: link.placeActionType,
                  isPreferred: link.isPreferred,
                }),
              })
              .then((result) => {
                if (!result.ok) return setFailure(result.error)
                markDiscarded()
                onClose()
              })
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Edit {link ? actionTypeLabel(link.placeActionType) : ""} link
            </DialogTitle>
            <DialogDescription>
              Review this change before approval. Sending to Google is a
              separate action.
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
            <Button
              type="submit"
              pending={workflow.busy}
              pendingLabel="Preparing review…"
              disabled={disabled || !link || uri.trim() === link.uri}
            >
              Review booking link change
            </Button>
          </DialogFooter>
        </form>
        <DiscardDialog
          {...leave}
          title="Leave without saving?"
          confirmLabel="Leave and discard"
          announce={false}
          description="Your edit to this link isn’t saved. Leaving throws it away. Google is not affected."
        />
      </DialogContent>
    </Dialog>
  )
}
