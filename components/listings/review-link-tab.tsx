"use client"

import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  RotateCwIcon,
} from "lucide-react"
import * as React from "react"

import {
  QrDownloads,
  QrImage,
  reviewQrFileStem,
  useReviewLinkQrSvg,
} from "@/components/listings/review-link-qr"
import {
  useCheckGoogleForReviewForm,
  useCreateReviewLink,
  useReviewLink,
  useUpdateReviewLink,
} from "@/lib/queries/use-review-link"
import { ReviewLinkStats } from "@/components/listings/review-link-stats"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import {
  checkReviewLinkCaption,
  DEFAULT_REVIEW_LINK_CAPTION,
  normaliseReviewLinkCaption,
  REVIEW_LINK_CAPTION_MAX,
} from "@/lib/domain/review-link-caption"
import type {
  ReviewLink,
  ReviewLinkAction,
  ReviewLinkState,
} from "@/lib/domain/review-link-contract"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format/number"
import { useLocationDirectory } from "@/lib/queries/use-locations"

/**
 * Making a new link or switching it off stops every printed code working,
 * so only an owner or admin may; anyone who may edit the listing can still
 * create one, caption it, or switch it back on. The server enforces the same
 * rule (lib/server/review-links.ts).
 */
const RETIRE_REASON =
  "Only an owner or admin can do this: printed QR codes would stop working."

function canRetireLinks(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin"
}

/**
 * The "Review link" area (/listings/[id]/review-link): one short link per
 * listing to its Google review form, its QR code for table talkers, receipts
 * and till screens, and how often it is opened beside the new reviews that
 * arrive. Nothing here writes to Google; the link's target is the review
 * form Google gives in the listing's details.
 */
export function ReviewLinkTab({
  locationId,
  role = null,
}: {
  locationId: string
  role?: string | null
}) {
  const query = useReviewLink(locationId)
  // Already loaded by the listing's gate: names the QR downloads.
  const directory = useLocationDirectory(role)
  const listingName =
    directory.data?.find((entry) => entry.id === locationId)?.name ?? null
  if (query.isPending) return <TabLoading label="Loading the review link…" />
  if (query.isError)
    return <TabError error={query.error} onRetry={() => void query.refetch()} />
  return (
    <ReviewLinkPanel
      locationId={locationId}
      state={query.data}
      canRetire={canRetireLinks(role)}
      listingName={listingName}
    />
  )
}

function ReviewLinkPanel({
  locationId,
  state,
  canRetire,
  listingName,
}: {
  locationId: string
  state: ReviewLinkState
  canRetire: boolean
  listingName: string | null
}) {
  const { link } = state
  if (!link) return <NoLinkYet locationId={locationId} state={state} />
  return (
    <div className="flex flex-col gap-(--np-gap-card)" data-slot="review-link">
      <LinkCard
        locationId={locationId}
        state={state}
        link={link}
        canRetire={canRetire}
      />
      {/* Keyed on the saved caption: a caption saved elsewhere (another
          tab, a refetch) reseeds the draft instead of being reverted. */}
      <QrCard
        key={link.caption ?? ""}
        locationId={locationId}
        state={state}
        link={link}
        listingName={listingName}
      />
      <ReviewLinkStats locationId={locationId} />
    </div>
  )
}

/** Reads Google's details again, for a listing whose review form is missing or old. */
function CheckGoogleButton({
  locationId,
  currentTarget = null,
  variant = "secondary",
}: {
  locationId: string
  /** Google's review form as last read, to say when nothing changed. */
  currentTarget?: string | null
  variant?: "default" | "secondary" | "link"
}) {
  const toast = useToastManager()
  const check = useCheckGoogleForReviewForm(locationId)
  return (
    <Button
      variant={variant}
      pending={check.isPending}
      pendingLabel="Checking Google…"
      onClick={() =>
        check.mutate(undefined, {
          onSuccess: (next) => {
            if (!next.googleTarget)
              toast.add({
                title: "Google still hasn’t given a review link",
                description:
                  "It usually appears once the listing is verified. Try again later.",
                type: "info",
              })
            else if (next.googleTarget === currentTarget)
              toast.add({
                title: "Google’s review form hasn’t changed",
                type: "success",
              })
          },
          onError: (cause) =>
            toast.add({ title: describeActionError(cause), type: "error" }),
        })
      }
    >
      <RefreshCwIcon aria-hidden />
      Check for a new review form
    </Button>
  )
}

function NoLinkYet({
  locationId,
  state,
}: {
  locationId: string
  state: ReviewLinkState
}) {
  const toast = useToastManager()
  const create = useCreateReviewLink(locationId)

  if (!state.googleTarget) {
    return (
      <Card data-slot="review-link-missing-target">
        <CardHeader>
          <CardTitle as="h2">Google hasn’t given a review link yet</CardTitle>
          <CardDescription>
            Google adds one to a listing’s details once the listing is verified.
            Check again now; you can make the short link and QR code as soon as
            it’s there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.canManage ? (
            <CheckGoogleButton locationId={locationId} variant="default" />
          ) : (
            <p className="text-ui text-ink-muted">
              Someone who can edit this listing can check Google for it.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-slot="review-link-empty">
      <CardHeader>
        <CardTitle as="h2">No review link yet</CardTitle>
        <CardDescription>
          One short link and QR code for table talkers, receipts and till
          screens. It opens this listing’s Google review form, and counts how
          often it is opened.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.canManage ? (
          <Button
            pending={create.isPending}
            pendingLabel="Creating…"
            onClick={() =>
              create.mutate(
                {},
                {
                  onSuccess: () =>
                    toast.add({
                      title: "Review link created",
                      type: "success",
                    }),
                  onError: (cause) =>
                    toast.add({
                      title: describeActionError(cause),
                      type: "error",
                    }),
                }
              )
            }
          >
            Create review link
          </Button>
        ) : (
          <p className="text-ui text-ink-muted">
            Someone who can edit this listing can create one.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

type Confirming = "rotate" | "disable" | null

function LinkCard({
  locationId,
  state,
  link,
  canRetire,
}: {
  locationId: string
  state: ReviewLinkState
  link: ReviewLink
  /** Owner or admin: may make a new link or switch it off. */
  canRetire: boolean
}) {
  const toast = useToastManager()
  const update = useUpdateReviewLink(locationId)
  const [copied, setCopied] = React.useState(false)
  const [confirming, setConfirming] = React.useState<Confirming>(null)
  // The dialog keeps its words while it closes, after `confirming` clears.
  const [shown, setShown] = React.useState<Exclude<Confirming, null>>("rotate")
  function ask(kind: Exclude<Confirming, null>) {
    setShown(kind)
    setConfirming(kind)
  }
  const urlField = React.useRef<HTMLInputElement>(null)
  const heading = React.useRef<HTMLHeadingElement>(null)
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )
  const live = link.status === "live"

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2500)
    } catch {
      urlField.current?.focus()
      urlField.current?.select()
      toast.add({
        title: "Couldn’t copy the link. It’s selected: copy it manually.",
        type: "error",
      })
    }
  }

  function run(action: ReviewLinkAction, success: string) {
    update.mutate(action, {
      onSuccess: () => {
        setConfirming(null)
        toast.add({ title: success, type: "success" })
        // The button that was pressed may be gone (Switch off becomes
        // Switch back on): keep focus in the card, after the dialog has
        // handed it back.
        window.setTimeout(() => heading.current?.focus(), 0)
      },
      onError: (cause) =>
        toast.add({ title: describeActionError(cause), type: "error" }),
    })
  }

  return (
    <Card data-slot="review-link-card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle
            as="h2"
            ref={heading}
            tabIndex={-1}
            className="outline-none"
          >
            Your review link
          </CardTitle>
          <StatusPill tone={live ? "healthy" : "neutral"}>
            {live ? "Live" : "Switched off"}
          </StatusPill>
        </div>
        <CardDescription>
          {live
            ? "Opens this listing’s Google review form. Share it anywhere guests will see it."
            : "Anyone who opens it, or scans a printed code, sees a page saying it isn’t working. Switch it back on to use it again."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel>Link</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input
              ref={urlField}
              readOnly
              value={link.url}
              className="min-w-0 flex-1 basis-56 font-mono"
              onFocus={(event) => event.currentTarget.select()}
              data-slot="review-link-url"
            />
            <Button
              variant="secondary"
              onClick={() => void copyLink()}
              className="max-sm:w-full"
            >
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <span role="status" className="sr-only">
              {copied ? "Link copied" : ""}
            </span>
          </div>
          <FieldDescription>
            <a
              href={link.targetUri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent-ink underline underline-offset-3 focus-halo"
            >
              Open the Google review form
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            to check where the link goes.
            {state.canManage ? (
              <>
                {" "}
                Google changed the address?{" "}
                <CheckGoogleButton
                  locationId={locationId}
                  currentTarget={state.googleTarget}
                  variant="link"
                />
              </>
            ) : null}
          </FieldDescription>
        </Field>

        {state.targetChanged && state.canManage ? (
          <Alert variant="info">
            <AlertTitle>
              Google has a new address for the review form
            </AlertTitle>
            <AlertDescription>
              The link still opens the old one. Point it at the new one; the
              link and printed codes stay the same.
            </AlertDescription>
            <AlertActions>
              <Button
                variant="secondary"
                pending={update.isPending}
                pendingLabel="Updating…"
                onClick={() =>
                  run({ action: "sync_target" }, "The link opens the new form")
                }
              >
                Use the new address
              </Button>
            </AlertActions>
          </Alert>
        ) : null}

        {state.canManage ? (
          <div className="flex flex-col gap-2">
            <div
              className="flex flex-wrap gap-2"
              data-slot="review-link-actions"
            >
              <Button
                variant="secondary"
                onClick={() => ask("rotate")}
                disabledReason={canRetire ? undefined : RETIRE_REASON}
              >
                <RotateCwIcon aria-hidden />
                Make a new link
              </Button>
              {live ? (
                <Button
                  variant="danger-outline"
                  onClick={() => ask("disable")}
                  disabledReason={canRetire ? undefined : RETIRE_REASON}
                >
                  Switch off
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  pending={update.isPending}
                  pendingLabel="Switching on…"
                  onClick={() =>
                    run({ action: "enable" }, "Review link switched back on")
                  }
                >
                  Switch back on
                </Button>
              )}
            </div>
            {canRetire ? null : (
              <p className="text-caption text-ink-muted">{RETIRE_REASON}</p>
            )}
          </div>
        ) : (
          <p className="text-ui text-ink-muted">
            An owner or admin can make a new link or switch it off.
          </p>
        )}
      </CardContent>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          {shown === "rotate" ? (
            <>
              <AlertDialogTitle>Make a new link?</AlertDialogTitle>
              <AlertDialogDescription>
                The current link and every printed QR code stop working straight
                away. You’ll need to reprint table talkers and receipts with the
                new code. Opens counted so far are kept.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogClose
                  render={<Button variant="ghost">Keep this link</Button>}
                />
                <Button
                  variant="danger"
                  pending={update.isPending}
                  pendingLabel="Making a new link…"
                  onClick={() => run({ action: "rotate" }, "New link made")}
                >
                  Make a new link
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogTitle>Switch off this link?</AlertDialogTitle>
              <AlertDialogDescription>
                Anyone who opens it, or scans a printed code, sees a page saying
                it isn’t working. You can switch it back on later.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogClose
                  render={<Button variant="ghost">Keep it on</Button>}
                />
                <Button
                  variant="danger"
                  pending={update.isPending}
                  pendingLabel="Switching off…"
                  onClick={() =>
                    run({ action: "disable" }, "Review link switched off")
                  }
                >
                  Switch off
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function QrCard({
  locationId,
  state,
  link,
  listingName,
}: {
  locationId: string
  state: ReviewLinkState
  link: ReviewLink
  /** The listing's name, for the download's file name. */
  listingName: string | null
}) {
  const toast = useToastManager()
  const update = useUpdateReviewLink(locationId)
  const [draft, setDraft] = React.useState(link.caption ?? "")
  const saved = link.caption ?? ""
  const caption = normaliseReviewLinkCaption(draft)
  const check = caption ? checkReviewLinkCaption(caption) : null
  const problem = check?.problems[0]?.message ?? null
  const dirty = (caption ?? "") !== saved
  const printed =
    normaliseReviewLinkCaption(saved) ?? DEFAULT_REVIEW_LINK_CAPTION
  const label = "QR code for this listing’s review link"
  const svg = useReviewLinkQrSvg(link.status === "live" ? link.qrUrl : null, {
    caption: printed,
    label,
  })

  function saveCaption(event: React.FormEvent) {
    event.preventDefault()
    if (problem || !dirty) return
    update.mutate(
      { action: "caption", caption },
      {
        onSuccess: (next) => {
          setDraft(next.link?.caption ?? "")
          toast.add({ title: "Caption saved", type: "success" })
        },
        onError: (cause) =>
          toast.add({ title: describeActionError(cause), type: "error" }),
      }
    )
  }

  return (
    <Card data-slot="review-link-qr-card">
      <CardHeader>
        <CardTitle as="h2">QR code</CardTitle>
        <CardDescription>
          For table talkers, receipts and till screens. Scans count as link
          opens, and are also shown on their own below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-start">
        <QrImage
          svg={svg}
          label={label}
          unavailable={
            link.status === "live"
              ? null
              : {
                  title: "The link is switched off",
                  body: "Switch it back on to see and download its code.",
                }
          }
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {state.canManage ? (
            <form className="flex flex-col gap-3" onSubmit={saveCaption}>
              <Field error={problem ?? undefined}>
                <FieldLabel optional>Caption under the code</FieldLabel>
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={DEFAULT_REVIEW_LINK_CAPTION}
                  maxLength={REVIEW_LINK_CAPTION_MAX * 2}
                  data-slot="review-link-caption"
                />
                <FieldDescription>
                  Ask for a Google review and nothing else: Google doesn’t allow
                  asking for stars or a rating, asking only happy guests, or
                  offering anything in return. Left empty, it says “
                  {DEFAULT_REVIEW_LINK_CAPTION}”.
                </FieldDescription>
                <FieldError />
                <FieldCounter
                  count={caption?.length ?? 0}
                  max={REVIEW_LINK_CAPTION_MAX}
                >
                  {formatNumber(caption?.length ?? 0)} /{" "}
                  {formatNumber(REVIEW_LINK_CAPTION_MAX)}
                </FieldCounter>
              </Field>
              <div>
                <Button
                  type="submit"
                  variant="secondary"
                  pending={update.isPending}
                  pendingLabel="Saving…"
                  disabledReason={
                    problem
                      ? "Fix the caption first: see the note under it."
                      : undefined
                  }
                  disabled={!dirty}
                >
                  Save caption
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-ui text-ink-secondary">Caption: “{printed}”</p>
          )}
          <QrDownloads
            svg={svg}
            fileStem={reviewQrFileStem(listingName, link.code)}
            disabledReason={
              link.status === "live"
                ? null
                : "Switch the link back on to download its code."
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}
