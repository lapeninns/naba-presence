"use client"

import {
  BarChart3Icon,
  CircleAlertIcon,
  EllipsisIcon,
  InboxIcon,
  KeyRoundIcon,
  MapPinIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  Share2Icon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ClientAvatar } from "@/components/clients/client-avatar"
import { ShareReportDialog } from "@/components/clients/share-report-dialog"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty } from "@/components/ui/empty"
import { KpiTile } from "@/components/ui/kpi-tile"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  connectionNeedsReconnect,
  diagnoseClient,
  attentionDescription,
  healthCause,
  healthDescription,
  healthLabel,
  healthTone,
  type ClientDiagnosis,
} from "@/lib/clients/health"
import type { ClientResponse } from "@/lib/contracts/clients"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { listingHealthLabel, listingHealthTone } from "@/lib/listings/health"
import { formatAddressLine } from "@/lib/locations/address"
import { useClient } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"
import { LISTING_TERMS } from "@/lib/workspace/terms"

type Client = ClientResponse["client"]
type Listing = ClientResponse["locations"][number]
type Diagnosis = ClientDiagnosis<Client["connections"][number]>

// The listing's busiest areas, plus its report on Reports. The overview is
// the listing's own name, a link already, so it is not repeated here.
const SECTIONS = [
  { href: (id: string) => `/listings/${id}/profile`, label: "Profile" },
  { href: (id: string) => `/listings/${id}/photos`, label: "Photos" },
  { href: (id: string) => `/listings/${id}/posts`, label: "Posts" },
  { href: (id: string) => `/reports?locationId=${id}`, label: "Reports" },
]

/**
 * The details cards (past reviews, notes) read as quiet settings groups on a
 * phone: no border, a grey group surface, and a small muted label instead of
 * a title. The desk lays them side by side under the listings table.
 */
const ASIDE_CARD_ON_PHONE =
  "@max-md:border-transparent @max-md:bg-fill-secondary"
const ASIDE_LABEL_ON_PHONE =
  "@max-md:text-ui @max-md:font-medium @max-md:text-ink-muted"

/** A plain text link (not a button): the touch height on a coarse pointer. */
const TEXT_LINK =
  "rounded-(--np-radius-tag) text-ui font-medium text-accent-ink underline underline-offset-3 focus-halo pointer-coarse:inline-flex pointer-coarse:min-h-(--np-touch) pointer-coarse:items-center"

/**
 * One client's home: how it is doing, what needs doing, and its listings.
 *
 * This is the level an agency actually works at. Everything below — a
 * listing's profile, its hours, its photos — is reached from here, which is
 * why each listing row carries its own section links rather than making the
 * operator open the listing first and then find the tab.
 *
 * Reference `client.hub`: header with the Google login behind the client and
 * the one primary action that matters now (Reconnect, Finish setup, or Open
 * inbox), four work tiles that each open the filtered inbox, the listings
 * table, and the past-reviews and notes cards. Everything shown comes from the client summary;
 * the reference's activity feed has no data source here and is left out.
 */
function ClientHub({
  clientId,
  canManage,
}: {
  clientId: string
  canManage: boolean
}) {
  const query = useClient(clientId)

  if (query.isPending) return <HubSkeleton />
  if (query.isError) {
    return (
      <>
        <PageHeader title="Client" eyebrow="Client" />
        <Card flush>
          <Empty
            tone="bad"
            titleAs="h2"
            icon={<CircleAlertIcon />}
            title="We couldn't load this client"
            description={`${describeActionError(query.error)} Health, work and listings aren’t shown until it loads. Nothing was changed.`}
            action={
              <>
                <Button
                  variant="secondary"
                  pending={query.isFetching}
                  pendingLabel="Trying again…"
                  onClick={() => void query.refetch()}
                >
                  <RefreshCwIcon aria-hidden />
                  Try again
                </Button>
                <Link
                  href="/clients"
                  className={cn(buttonVariants({ variant: "ghost" }))}
                >
                  All clients
                </Link>
              </>
            }
          />
        </Card>
      </>
    )
  }

  const { client, locations } = query.data
  // One diagnosis drives the header chip, the alert and the listing rows, so
  // they cannot tell three different stories about the same problem.
  const diagnosis = diagnoseClient(client)
  const notSetUp = client.health === "not_connected"

  // The fix for a broken login lives in the alert below, beside its reason;
  // the header's primary stays the everyday one.
  const finishSetup = canManage && notSetUp && !diagnosis
  // Where the health word came from (CLR-13): read-only navigation, so every
  // role gets it.
  const cause = healthCause(client.id, client.health, locations)

  return (
    <>
      {/* The client's mark leads the header at every width: 44px beside a
          name that may wrap on a phone, the full 48px from @md. */}
      <div className="flex min-w-0 items-start gap-3 @md:gap-4">
        <ClientAvatar
          name={client.name}
          colour={client.colour}
          size="lg"
          className="mt-1 size-11 @md:size-12"
        />
        <PageHeader
          className="min-w-0 flex-1"
          title={client.name}
          eyebrow="Client"
          meta={
            <StatusPill tone={healthTone(client.health)} dashed={notSetUp}>
              {healthLabel(client.health)}
            </StatusPill>
          }
          description={
            <span className="flex flex-col gap-1.5">
              <span className="text-ui text-ink-secondary">
                {client.health === "attention"
                  ? attentionDescription(client.freshness)
                  : healthDescription(client.health)}
                {client.lastSyncAt ? (
                  <>
                    {" "}
                    <RelativeTime
                      iso={client.lastSyncAt}
                      prefix="Last synced "
                      suffix="."
                    />
                  </>
                ) : null}
              </span>
              {cause ? (
                <Link href={cause.href} className={cn("self-start", TEXT_LINK)}>
                  {cause.label}
                </Link>
              ) : null}
              <LoginLine client={client} diagnosis={diagnosis} />
            </span>
          }
        />
      </div>

      {/* One primary under the header, the full width of the page on a phone,
          with everything else behind More. */}
      <HubActions
        clientId={client.id}
        clientName={client.name}
        canManage={canManage}
        finishSetup={finishSetup}
      />

      {diagnosis ? (
        <DiagnosisAlert
          client={client}
          diagnosis={diagnosis}
          canManage={canManage}
        />
      ) : null}

      <section aria-labelledby="client-work" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="client-work" className="text-title font-semibold text-ink">
            Work for this client
          </h2>
          <p className="text-caption text-ink-muted">
            Each opens the inbox or listings filtered to {client.name}.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          <WorkTile
            label="Needs reply"
            value={formatNumber(client.openWork.needsReply)}
            hint={
              client.openWork.needsReply === 0
                ? "Nothing waiting"
                : "Across this client's listings"
            }
            href={`/inbox?clientId=${client.id}&queue=needs_reply`}
          />
          <WorkTile
            label="Awaiting approval"
            value={formatNumber(client.openWork.awaitingApproval)}
            hint={
              client.openWork.awaitingApproval === 0
                ? "Nothing waiting"
                : "Drafted, not yet published"
            }
            href={`/inbox?clientId=${client.id}&queue=approval`}
          />
          <WorkTile
            label="Replies that didn’t post"
            value={formatNumber(client.openWork.failed)}
            hint={client.openWork.failed === 0 ? "None" : "Need a retry"}
            tone={client.openWork.failed > 0 ? "bad" : undefined}
            href={`/inbox?clientId=${client.id}&queue=failed`}
          />
          <WorkTile
            label={`${LISTING_TERMS.placePluralTitle} linked`}
            value={`${formatNumber(client.linkedCount)} / ${formatNumber(client.locationCount)}`}
            hint={`${formatNumber(client.verifiedCount)} verified on Google`}
            href={`/listings?clientId=${client.id}`}
          />
        </div>
      </section>

      {/* The listings table takes the full content width, so it stays a table
          (not phone record cards) at a desktop window; past reviews and notes
          sit beside each other under it. */}
      <div className="flex flex-col gap-6">
        <ListingsSection
          client={client}
          listings={locations}
          canManage={canManage}
          loginBroken={
            diagnosis?.kind === "reconnect" ||
            diagnosis?.kind === "permission_missing"
          }
        />
        <aside
          aria-label={`${client.name} details`}
          className="grid min-w-0 gap-4 @3xl:grid-cols-2 @3xl:items-start"
        >
          <PastReviewsCard client={client} canManage={canManage} />
          <section aria-labelledby="client-notes">
            <Card size="sm" className={ASIDE_CARD_ON_PHONE}>
              <CardHeader>
                <CardTitle
                  as="h2"
                  id="client-notes"
                  className={ASIDE_LABEL_ON_PHONE}
                >
                  Notes for the team
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p
                  className={cn(
                    "text-ui break-words whitespace-pre-line",
                    client.notes ? "text-ink" : "text-ink-muted"
                  )}
                >
                  {client.notes || "No notes yet."}
                </p>
                {canManage ? (
                  <Link
                    href={`/clients/${client.id}/settings#details`}
                    className={cn("self-start", TEXT_LINK)}
                  >
                    Edit notes
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </aside>
      </div>
    </>
  )
}

/**
 * The header's actions: the one primary (Finish setup while a client is not
 * set up, otherwise Open inbox) and a "More" menu for the rest, which is an
 * action sheet on a phone. Settings and Share report are owner and admin
 * actions: the share link shows this client's numbers to anyone who has it
 * (the API refuses everyone else too).
 */
function HubActions({
  clientId,
  clientName,
  canManage,
  finishSetup,
}: {
  clientId: string
  clientName: string
  canManage: boolean
  finishSetup: boolean
}) {
  const [shareOpen, setShareOpen] = React.useState(false)
  // Mounted on first use and kept, so it costs nothing on a page where it is
  // never opened and still animates closed once it has been.
  const [shareUsed, setShareUsed] = React.useState(false)
  return (
    <div className="flex items-center gap-2">
      {finishSetup ? (
        <Link
          href={`/setup?client=${clientId}`}
          className={cn(buttonVariants(), "@max-md:flex-1")}
        >
          Finish setup
        </Link>
      ) : (
        <Link
          href={`/inbox?clientId=${clientId}`}
          className={cn(buttonVariants(), "@max-md:flex-1")}
        >
          <InboxIcon aria-hidden strokeWidth={1.75} />
          Open inbox
        </Link>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="secondary" aria-label="More actions" />}
        >
          <EllipsisIcon aria-hidden strokeWidth={1.75} />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" title="Client actions">
          <DropdownMenuItem
            render={<Link href={`/reports?clientId=${clientId}`} />}
          >
            <BarChart3Icon aria-hidden strokeWidth={1.75} />
            Report
          </DropdownMenuItem>
          {canManage ? (
            <DropdownMenuItem
              onClick={() => {
                setShareUsed(true)
                setShareOpen(true)
              }}
            >
              <Share2Icon aria-hidden strokeWidth={1.75} />
              Share report
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <DropdownMenuItem
              render={<Link href={`/clients/${clientId}/settings`} />}
            >
              <Settings2Icon aria-hidden strokeWidth={1.75} />
              Settings
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {shareUsed ? (
        <ShareReportDialog
          clientId={clientId}
          clientName={clientName}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </div>
  )
}

/**
 * "Google login: <login>" with its state, from the client's real connections.
 *
 * The chip never says all is well while a listing is unreachable: a login
 * can be connected and still have lost manager access to one of the
 * client's listings, and "Connected · refreshed a minute ago" beside an
 * "Can’t reach Google" alert read as a contradiction.
 *
 * With several logins it names the one the alert below is about, so a
 * working first login is never drawn as "Connected" over an alert that names
 * another. A working login is plain text: a pill is kept for a state that
 * needs a look, as in the listings table (CLR-15), so the calm login does not
 * outshout the client's own health.
 */
function LoginLine({
  client,
  diagnosis,
}: {
  client: Client
  diagnosis: Diagnosis | null
}) {
  const connections = client.connections
  const shown =
    (diagnosis?.kind === "reconnect" || diagnosis?.kind === "permission_missing"
      ? diagnosis.connection
      : null) ?? connections[0]
  if (!shown) {
    return (
      <span className="flex items-center gap-2 text-caption text-ink-muted">
        <KeyRoundIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
        No Google login connected yet.
      </span>
    )
  }
  const others = connections.length - 1
  const shownBroken = connectionNeedsReconnect(shown)
  const accessLost = diagnosis?.kind === "access_lost"
  const lost = accessLost ? diagnosis.accessLost : 0
  return (
    <span className="flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
      <KeyRoundIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        Google login:{" "}
        <strong className="font-semibold text-ink">
          {shown.googleEmail ?? "Google account"}
        </strong>
        {others > 0 ? ` and ${formatNumber(others)} more` : ""}
        {!shownBroken && !accessLost ? (
          <>
            {" · "}
            <span>Connected</span>
            {shown.lastRefreshAt ? (
              <>
                {", "}
                <RelativeTime iso={shown.lastRefreshAt} prefix="refreshed " />
              </>
            ) : null}
          </>
        ) : null}
      </span>
      {shownBroken ? (
        <StatusPill tone="at-risk">
          Needs reconnecting
          {shown.lastRefreshAt ? (
            <>
              {" · "}
              <RelativeTime iso={shown.lastRefreshAt} prefix="last refresh " />
            </>
          ) : null}
        </StatusPill>
      ) : accessLost ? (
        <StatusPill tone="attention">
          {lost > 1
            ? `Connected · ${formatNumber(lost)} listings unreachable`
            : "Connected · a listing is unreachable"}
        </StatusPill>
      ) : null}
    </span>
  )
}

/**
 * One work count as a deep link into the filtered inbox (or listings): the
 * shared `KpiTile` with an `href`, so the whole tile is one tab stop whose
 * accessible name starts with the visible label ("Needs reply 5 Across this
 * client's listings"). KpiTile has no tone of its own, so a failed-publish
 * count says so in the danger ink in its hint.
 */
function WorkTile({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string
  value: string
  hint: string
  href: string
  tone?: "bad"
}) {
  return (
    <KpiTile
      label={label}
      value={value}
      href={href}
      hint={
        tone === "bad" ? (
          <span className="font-medium text-danger-ink">{hint}</span>
        ) : (
          hint
        )
      }
    />
  )
}

function ListingsSection({
  client,
  listings,
  canManage,
  loginBroken,
}: {
  client: Client
  listings: Listing[]
  canManage: boolean
  /** A login needs reconnecting, so every linked listing is paused. */
  loginBroken: boolean
}) {
  const add = canManage ? (
    <Link
      href={`/setup?client=${client.id}&step=locations`}
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
    >
      <PlusIcon aria-hidden strokeWidth={1.75} />
      Add listings from Google
    </Link>
  ) : null

  return (
    <section
      aria-labelledby="client-listings"
      className="flex min-w-0 flex-1 flex-col gap-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="client-listings" className="text-title font-semibold text-ink">
          {LISTING_TERMS.placePluralTitle}
        </h2>
        {/* The linked and verified counts are the "Listings linked" tile
            above; they are not repeated here. */}
        {listings.length > 0 ? add : null}
      </div>

      {listings.length === 0 ? (
        <Card flush>
          <Empty
            titleAs="h3"
            icon={<MapPinIcon />}
            title="No listings yet"
            description={`Connect the Google account that manages ${client.name}'s Business Profile, then pick its ${LISTING_TERMS.placePlural}. Reviews start arriving once a ${LISTING_TERMS.place} is linked.`}
            action={
              canManage ? (
                <Link
                  href={`/setup?client=${client.id}&step=locations`}
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  Add listings from Google
                </Link>
              ) : (
                <span className="text-caption text-ink-muted">
                  An owner or admin can add listings.
                </span>
              )
            }
          />
        </Card>
      ) : (
        // Below 48rem of its own width the table becomes record cards: the
        // name is the headline with its Google state trailing, the address
        // the subtitle, verification the one meta line, and More the row's
        // actions. A healthy row shows plain text at the desk and nothing on
        // a phone; a pill appears only for a state that needs a look.
        <DataTable
          caption={`${client.name}'s listings with their Google link, health, work waiting and verification`}
          rows={listings}
          rowId={(listing) => listing.locationId}
          surface
          responsive
          columns={[
            {
              id: "listing",
              header: "Listing",
              priority: "primary",
              cell: (listing) => (
                <Link
                  href={`/listings/${listing.locationId}`}
                  // The record card's way in: a full touch-height row on
                  // touch (the name alone is an 18px line), the compact text
                  // link at the desk.
                  className="inline-flex min-h-(--np-touch) items-center rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline desk:min-h-0"
                >
                  {listing.name}
                </Link>
              ),
            },
            {
              id: "address",
              header: "Address",
              priority: "secondary",
              cell: (listing) => (
                <span className="text-caption break-words text-ink-muted">
                  {formatAddressLine(listing.address) ?? "No address"}
                  <PhoneListingFacts listing={listing} />
                </span>
              ),
            },
            {
              id: "google",
              header: "Google",
              priority: "trailing",
              cell: (listing) =>
                listing.linkId ? (
                  listing.accessLost ? (
                    <StatusPill tone="at-risk">
                      Linked · no manager access
                    </StatusPill>
                  ) : loginBroken ? (
                    <StatusPill tone="at-risk">Linked · paused</StatusPill>
                  ) : (
                    <span className="text-ui text-ink-secondary @max-3xl/table:hidden">
                      Linked
                    </span>
                  )
                ) : (
                  <StatusPill tone="neutral" dashed>
                    Not linked
                  </StatusPill>
                ),
            },
            {
              // The listings board's Health word (DSK-10). A state the Google
              // or Verified cell already says is not said twice: a paused
              // login, no manager access, not linked, not verified. A token
              // that has only expired is not "paused" there, so it keeps its
              // word here.
              id: "health",
              header: "Health",
              priority: "trailing",
              cell: (listing) => {
                const health = listing.health
                if (!health) return null
                const said =
                  (health === "not_linked" && !listing.linkId) ||
                  (health === "pending_verification" &&
                    listing.verified === false) ||
                  (health === "access_lost" && listing.accessLost) ||
                  (health === "disconnected" && loginBroken)
                if (said)
                  return (
                    <span className="text-ui text-ink-muted @max-3xl/table:hidden">
                      —
                    </span>
                  )
                return health === "healthy" ? (
                  <span className="text-ui text-ink-secondary @max-3xl/table:hidden">
                    {listingHealthLabel(health)}
                  </span>
                ) : (
                  <StatusPill tone={listingHealthTone(health)}>
                    {listingHealthLabel(health)}
                  </StatusPill>
                )
              },
            },
            {
              // Waiting and Verified are desk columns: on a card their calm
              // values are hidden, and the meta line they shared was left
              // with nothing but its "·". The card says only the states that
              // need a look, after the address (PhoneListingFacts).
              id: "waiting",
              header: "Waiting",
              priority: "desk-only",
              cell: (listing) =>
                listing.waiting ? (
                  <span className="text-ui text-ink-secondary">
                    {formatNumber(listing.waiting)} waiting
                  </span>
                ) : (
                  <span className="text-ui text-ink-muted @max-3xl/table:hidden">
                    —
                  </span>
                ),
            },
            {
              id: "verified",
              header: "Verified",
              priority: "desk-only",
              cell: (listing) =>
                !listing.linkId ? (
                  <span className="text-ui text-ink-muted @max-3xl/table:hidden">
                    —
                  </span>
                ) : listing.verified ? (
                  <span className="text-ui text-ink-secondary @max-3xl/table:hidden">
                    Verified
                  </span>
                ) : (
                  <StatusPill tone="attention">Not verified</StatusPill>
                ),
            },
            {
              id: "sections",
              header: <span className="sr-only">Sections</span>,
              priority: "actions",
              className: "text-right",
              cell: (listing) => (
                <>
                  <nav
                    aria-label={`${listing.name} sections`}
                    className="flex flex-wrap justify-end gap-1 @max-3xl/table:hidden"
                  >
                    {SECTIONS.map((section) => (
                      <Link
                        key={section.label}
                        href={section.href(listing.locationId)}
                        className={cn(
                          buttonVariants({
                            variant: "ghost",
                            size: "sm",
                          })
                        )}
                      >
                        {section.label}
                      </Link>
                    ))}
                  </nav>
                  {/* On a narrow row four ghost links wrapped under the name;
                      one menu keeps the row to its name and its state. */}
                  <div className="@3xl/table:hidden">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More for ${listing.name}`}
                          />
                        }
                      >
                        <EllipsisIcon aria-hidden strokeWidth={1.75} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {SECTIONS.map((section) => (
                          <DropdownMenuItem
                            key={section.label}
                            render={
                              <Link href={section.href(listing.locationId)} />
                            }
                          >
                            {section.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              ),
            },
          ]}
        />
      )}
    </section>
  )
}

/**
 * A listing card's Waiting and Verified facts on a phone, after its address,
 * only when they need a look: "· 3 waiting" and a "Not verified on Google"
 * pill. A calm listing adds nothing. Hidden from the table width up, where
 * the desk columns say the same; the words differ from those cells ("Not
 * verified on Google", and the separator in the same text) so the two copies
 * are never the same text.
 */
function PhoneListingFacts({ listing }: { listing: Listing }) {
  const waiting = listing.waiting ?? 0
  const unverified = Boolean(listing.linkId) && !listing.verified
  if (waiting === 0 && !unverified) return null
  return (
    <span className="@3xl/table:hidden">
      {waiting > 0 ? (
        <span className="text-ink-secondary">{` · ${formatNumber(waiting)} waiting`}</span>
      ) : null}
      {unverified ? (
        <>
          {" "}
          <StatusPill tone="attention" className="align-middle">
            Not verified on Google
          </StatusPill>
        </>
      ) : null}
    </span>
  )
}

/** Past reviews across the client's listings, from the summary's counts. */
function PastReviewsCard({
  client,
  canManage,
}: {
  client: Client
  canManage: boolean
}) {
  const { running, failed, succeeded, notStarted } = client.backfill
  const total = running + failed + succeeded + notStarted
  return (
    <section aria-labelledby="client-import">
      <Card size="sm" className={ASIDE_CARD_ON_PHONE}>
        <CardHeader>
          <CardTitle
            as="h2"
            id="client-import"
            className={ASIDE_LABEL_ON_PHONE}
          >
            Past reviews
          </CardTitle>
          <CardDescription className="@max-md:sr-only">
            Bring in the reviews Google already holds for these listings.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {total === 0 ? (
            <p className="text-ui text-ink-muted">
              Nothing to bring in until a listing is linked.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-ui">
              {running > 0 ? (
                <ImportRow tone="pending" label="Importing" count={running} />
              ) : null}
              {failed > 0 ? (
                <ImportRow tone="at-risk" label="Stopped" count={failed} />
              ) : null}
              {succeeded > 0 ? (
                <ImportRow tone="healthy" label="Complete" count={succeeded} />
              ) : null}
              {notStarted > 0 ? (
                <ImportRow
                  tone="neutral"
                  label="Not started"
                  count={notStarted}
                />
              ) : null}
            </ul>
          )}
          {canManage && (failed > 0 || notStarted > 0) ? (
            <Link
              href={`/setup?client=${client.id}&step=backfill`}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "self-start"
              )}
            >
              {failed > 0
                ? "Retry bringing in past reviews"
                : "Bring in past reviews"}
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function ImportRow({
  tone,
  label,
  count,
}: {
  tone: "pending" | "at-risk" | "healthy" | "neutral"
  label: string
  count: number
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <StatusPill tone={tone} dashed={tone === "neutral"}>
        {label}
      </StatusPill>
      <span className="text-caption text-ink-muted tabular-nums">
        {formatNumber(count)} {count === 1 ? "listing" : "listings"}
      </span>
    </li>
  )
}

/**
 * The one alert for a client that needs a person, with the fix inside it.
 *
 * A broken login and a lost listing are different problems with different
 * fixes. They used to share one "Google needs reconnecting" alert, shown
 * under a shell banner saying reconnecting would not help.
 */
function DiagnosisAlert({
  client,
  diagnosis,
  canManage,
}: {
  client: Client
  diagnosis: Diagnosis
  canManage: boolean
}) {
  const email = diagnosis.connection?.googleEmail ?? null
  if (diagnosis.kind === "access_lost") {
    const many = diagnosis.accessLost > 1
    return (
      <Alert variant="warning">
        <AlertTitle>
          {many
            ? `${formatNumber(diagnosis.accessLost)} listings can’t be reached`
            : "A listing can’t be reached"}
        </AlertTitle>
        <AlertDescription>
          {email ? (
            <>
              <strong className="font-semibold [overflow-wrap:anywhere]">
                {email}
              </strong>{" "}
              is still connected, but it is
            </>
          ) : (
            "The connected Google login still works, but it is"
          )}{" "}
          no longer a manager of {many ? "these listings" : "this listing"} on
          Google. Reconnecting won’t fix this: ask {client.name} to add it back
          as a manager on the Business Profile. Their other listings keep
          syncing.
        </AlertDescription>
        <AlertActions>
          <Link
            href={`/listings?clientId=${client.id}`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            See {client.name}’s listings
          </Link>
        </AlertActions>
      </Alert>
    )
  }
  const permission = diagnosis.kind === "permission_missing"
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {permission
          ? "Google permission missing"
          : "Google login needs reconnecting"}
      </AlertTitle>
      <AlertDescription>
        {permission
          ? `${email ?? "The connected login"} was connected without permission to manage Business Profiles. Reconnect it and allow access when Google asks.`
          : email
            ? `Google stopped accepting ${email}, so ${client.name}’s reviews and profile changes have stopped syncing. Reconnect it to resume.`
            : `Reviews and profile changes for ${client.name} have stopped syncing. Reconnect Google to resume.`}
        {canManage ? "" : " Ask an owner or admin to reconnect it."}
      </AlertDescription>
      {canManage ? (
        <AlertActions>
          <Link
            href={`/setup?client=${client.id}&step=connect`}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            <RefreshCwIcon aria-hidden strokeWidth={1.75} />
            Reconnect Google
          </Link>
        </AlertActions>
      ) : null}
    </Alert>
  )
}

/**
 * The hub's loading shape, drawn by the route's `loading.tsx` and by the hub
 * while its query is pending: the same header, the same tile grid and the
 * same full-width listings table with the details cards under it, so the
 * swap to the real hub does not jump.
 */
function HubSkeleton() {
  return (
    <div className="flex flex-col gap-(--np-gap-section)" aria-busy="true">
      <div className="flex items-start gap-4">
        <Skeleton className="mt-1 size-11 rounded-(--np-radius-card) @md:size-12" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <p role="status" className="text-ui text-ink-muted">
        Loading this client…
      </p>
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 rounded-(--np-radius-card)" />
        ))}
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-48 min-w-0 rounded-(--np-radius-card)" />
        <div className="grid gap-4 @3xl:grid-cols-2">
          <Skeleton className="h-28 rounded-(--np-radius-card)" />
          <Skeleton className="h-24 rounded-(--np-radius-card)" />
        </div>
      </div>
    </div>
  )
}

export { ClientHub, HubSkeleton }
