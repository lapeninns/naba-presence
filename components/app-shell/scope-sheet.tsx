"use client"

import { ChevronLeft, ChevronRight, MapPin } from "lucide-react"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { healthLabel } from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import type { DirectoryEntry } from "@/lib/locations/directory"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { AllClientsMark, CurrentMark, HealthDot } from "./client-scope-rows"
import {
  SEARCH_THRESHOLD,
  announceSwitch,
  locationScopeName,
  locationStatusWords,
  useClientSwitch,
  useLocationSwitch,
} from "./scope-sheet-model"

/**
 * The phone's scope switcher, after Notion Mail's account switcher: a bottom
 * sheet titled "Working on" whose rows are the scopes, the current one
 * ticked. Choosing applies at once, closes the sheet, and a toast names the
 * new scope ("Switched to Harbour Kitchen").
 *
 * - Agency: All clients and each client, health in words. A client's
 *   trailing chevron pushes, inside the sheet, to that client's locations
 *   ("‹ All clients" goes back).
 * - Business: All locations and each location. Never the word "client".
 *
 * Past eight rows the showing view gets a plain search field (not cmdk: a
 * native field is all a filter needs, and it keeps cmdk out of the shell).
 */
function ScopeSheet({
  open,
  onOpenChange,
  mode = "agency",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: WorkspaceMode
}) {
  return mode === "business" ? (
    <BusinessScopeSheet open={open} onOpenChange={onOpenChange} />
  ) : (
    <AgencyScopeSheet open={open} onOpenChange={onOpenChange} />
  )
}

type SheetProps = { open: boolean; onOpenChange: (open: boolean) => void }

/**
 * The filter starts empty every time the sheet opens (and every time the
 * view changes), rather than reopening on a list narrowed to one stale
 * name. Reset whenever `open` turns false, however the sheet was closed (a
 * choice, Escape, or the shell closing it on a route change), during render
 * so the stale words never paint.
 */
function useSheetQuery(open: boolean, onClose?: () => void) {
  const [query, setQuery] = React.useState("")
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setQuery("")
      onClose?.()
    }
  }
  return [query, setQuery] as const
}

function AgencyScopeSheet({ open, onOpenChange }: SheetProps) {
  const { clients, current, select } = useClientSwitch()
  const locations = useLocationSwitch("agency")
  const [pushedId, setPushedId] = React.useState<string | null>(null)
  const [query, setQuery] = useSheetQuery(open, () => setPushedId(null))

  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const pushButtons = React.useRef(new Map<string, HTMLButtonElement>())
  const returnTo = React.useRef<string | null>(null)

  const list = clients ?? []
  const scoped = list.some((entry) => entry.id === current) ? current : null
  const pushed = pushedId
    ? (list.find((entry) => entry.id === pushedId) ?? null)
    : null

  // In-sheet push: focus moves to the new view's title, and back returns it
  // to the chevron that pushed.
  React.useEffect(() => {
    if (pushedId) {
      titleRef.current?.focus()
    } else if (returnTo.current) {
      pushButtons.current.get(returnTo.current)?.focus()
      returnTo.current = null
    }
  }, [pushedId])

  const push = (clientId: string) => {
    setQuery("")
    setPushedId(clientId)
  }
  const back = () => {
    returnTo.current = pushedId
    setQuery("")
    setPushedId(null)
  }

  const chooseClient = (clientId: string | null) => {
    onOpenChange(false)
    const name = clientId
      ? (list.find((entry) => entry.id === clientId)?.name ?? clientId)
      : "All clients"
    // The client is already in scope but narrowed to one of its locations:
    // widen back to the whole client.
    if (clientId !== null && clientId === scoped && locations.current) {
      locations.clearLocation(() => announceSwitch(name))
      return
    }
    void select(clientId, () => announceSwitch(name))
  }

  const chooseLocation = (entry: DirectoryEntry, client: ClientSummary) => {
    onOpenChange(false)
    locations.chooseLocation(entry, () =>
      announceSwitch(locationScopeName(entry, client.name))
    )
  }

  const needle = query.trim().toLowerCase()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          {pushed ? <BackControl label="All clients" onBack={back} /> : null}
          <SheetTitle
            ref={titleRef}
            tabIndex={-1}
            className="truncate text-title font-semibold outline-none"
          >
            {pushed ? pushed.name : "Working on"}
          </SheetTitle>
          <SheetDescription>
            {pushed
              ? "Inbox and Reports narrow to the location you choose; anywhere else opens its listing."
              : "Inbox, Listings and Reports show this client. Choose All clients to see everything."}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-[max(--spacing(5),var(--np-safe-bottom))]">
          {pushed ? (
            <ClientLocations
              client={pushed}
              clientInScope={scoped === pushed.id}
              currentLocation={locations.current}
              query={query}
              onQuery={setQuery}
              onChooseClient={() => chooseClient(pushed.id)}
              onChooseLocation={(entry) => chooseLocation(entry, pushed)}
            />
          ) : (
            <>
              {list.length > SEARCH_THRESHOLD ? (
                <SearchField
                  label="Search clients"
                  value={query}
                  onChange={setQuery}
                />
              ) : null}
              <ClientRows
                clients={list}
                scoped={scoped}
                needle={needle}
                onChoose={chooseClient}
                onPush={push}
                pushRef={(id, node) => {
                  if (node) pushButtons.current.set(id, node)
                  else pushButtons.current.delete(id)
                }}
              />
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function ClientRows({
  clients,
  scoped,
  needle,
  onChoose,
  onPush,
  pushRef,
}: {
  clients: ClientSummary[]
  scoped: string | null
  needle: string
  onChoose: (clientId: string | null) => void
  onPush: (clientId: string) => void
  pushRef: (clientId: string, node: HTMLButtonElement | null) => void
}) {
  const matches = needle
    ? clients.filter((entry) => entry.name.toLowerCase().includes(needle))
    : clients
  const showAll = !needle || "all clients".includes(needle)
  if (!showAll && !matches.length) {
    return <NoMatch>No client matches that.</NoMatch>
  }
  const rows: ScopeRow[] = [
    ...(showAll
      ? [
          {
            key: null,
            name: "All clients",
            checked: scoped === null,
            mark: <AllMark />,
            onChoose: () => onChoose(null),
          },
        ]
      : []),
    ...matches.map((entry): ScopeRow => ({
      key: entry.id,
      name: entry.name,
      checked: entry.id === scoped,
      mark: <ClientAvatar name={entry.name} colour={entry.colour} />,
      sub: {
        words: healthLabel(entry.health),
        dot: <HealthDot client={entry} />,
      },
      onChoose: () => onChoose(entry.id),
      push:
        entry.locationCount > 0
          ? {
              label: `Locations of ${entry.name}`,
              onPush: () => onPush(entry.id),
            }
          : undefined,
    })),
  ]
  return <ScopeRadioGroup label="Client" rows={rows} pushRef={pushRef} />
}

/**
 * A client's locations, inside the sheet: "All <client> locations" (which
 * is choosing the client) and then each location the directory files under
 * it. The directory query lives here, so the sheet's first view never waits
 * on it.
 */
function ClientLocations({
  client,
  clientInScope,
  currentLocation,
  query,
  onQuery,
  onChooseClient,
  onChooseLocation,
}: {
  client: ClientSummary
  clientInScope: boolean
  currentLocation: string | null
  query: string
  onQuery: (query: string) => void
  onChooseClient: () => void
  onChooseLocation: (entry: DirectoryEntry) => void
}) {
  const directory = useLocationDirectory(useSessionRole())
  const all = `All ${client.name} locations`
  const groupId = React.useId()

  if (!directory.data) {
    return directory.isError ? (
      <NoMatch>Couldn’t load the locations. Close this and try again.</NoMatch>
    ) : (
      <NoMatch>Loading locations…</NoMatch>
    )
  }

  const list = directory.data.filter((entry) => entry.clientId === client.id)
  const located = list.some((entry) => entry.id === currentLocation)
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? list.filter((entry) => entry.name.toLowerCase().includes(needle))
    : list
  const showAll = !needle || all.toLowerCase().includes(needle)

  const rows: ScopeRow[] = [
    ...(showAll
      ? [
          {
            key: null,
            name: all,
            checked: clientInScope && !located,
            mark: <ClientAvatar name={client.name} colour={client.colour} />,
            onChoose: onChooseClient,
          },
        ]
      : []),
    ...matches.map((entry): ScopeRow => ({
      key: entry.id,
      name: entry.name,
      checked: entry.id === currentLocation,
      mark: <LocationMark />,
      sub: wordsFor(entry),
      onChoose: () => onChooseLocation(entry),
    })),
  ]

  return (
    <>
      {list.length > SEARCH_THRESHOLD ? (
        <SearchField
          label="Search locations"
          value={query}
          onChange={onQuery}
        />
      ) : null}
      <p id={groupId} className="text-ui font-medium text-ink-muted">
        Locations
      </p>
      {rows.length ? (
        <ScopeRadioGroup labelledBy={groupId} rows={rows} />
      ) : (
        <NoMatch>No location matches that.</NoMatch>
      )}
    </>
  )
}

function BusinessScopeSheet({ open, onOpenChange }: SheetProps) {
  const [query, setQuery] = useSheetQuery(open)
  const locations = useLocationSwitch("business")
  const directory = useLocationDirectory(useSessionRole())

  const list = directory.data ?? []
  const located = list.some((entry) => entry.id === locations.current)
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? list.filter((entry) => entry.name.toLowerCase().includes(needle))
    : list
  const showAll = !needle || "all locations".includes(needle)

  const chooseAll = () => {
    onOpenChange(false)
    locations.clearLocation(() => announceSwitch("All locations"))
  }
  const choose = (entry: DirectoryEntry) => {
    onOpenChange(false)
    locations.chooseLocation(entry, () => announceSwitch(entry.name))
  }

  const rows: ScopeRow[] = [
    ...(showAll
      ? [
          {
            key: null,
            name: "All locations",
            checked: !located,
            mark: <AllMark />,
            onChoose: chooseAll,
          },
        ]
      : []),
    ...matches.map((entry): ScopeRow => ({
      key: entry.id,
      name: entry.name,
      checked: entry.id === locations.current,
      mark: <LocationMark />,
      sub: wordsFor(entry),
      onChoose: () => choose(entry),
    })),
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle className="text-title font-semibold">
            Working on
          </SheetTitle>
          <SheetDescription>
            Inbox and Reports narrow to the location you choose; anywhere else
            opens its listing.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-[max(--spacing(5),var(--np-safe-bottom))]">
          {!directory.data ? (
            <NoMatch>
              {directory.isError
                ? "Couldn’t load the locations. Close this and try again."
                : "Loading locations…"}
            </NoMatch>
          ) : (
            <>
              {list.length > SEARCH_THRESHOLD ? (
                <SearchField
                  label="Search locations"
                  value={query}
                  onChange={setQuery}
                />
              ) : null}
              {rows.length ? (
                <ScopeRadioGroup label="Location" rows={rows} />
              ) : (
                <NoMatch>No location matches that.</NoMatch>
              )}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function wordsFor(entry: DirectoryEntry): ScopeRow["sub"] {
  const words = locationStatusWords(entry)
  return words ? { words } : undefined
}

/** The labelled back control of an in-sheet push: "‹ All clients". */
function BackControl({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={`Back to ${label}`}
      data-slot="scope-sheet-back"
      className={cn(
        "-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-(--np-radius-pill) pr-3 pl-1 text-ui font-medium text-ink-secondary",
        "transition-colors duration-(--np-duration-fast) hover:bg-fill active:bg-fill",
        "focus-halo focus-visible:outline-none"
      )}
    >
      <ChevronLeft aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
      {label}
    </button>
  )
}

/**
 * The shared search field: a plain native input (not cmdk), 16px
 * (`text-body`) and 44px tall on touch, so iOS never zooms the page on
 * focus.
 */
function SearchField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      placeholder={label}
      autoComplete="off"
      enterKeyHint="search"
      className="shrink-0"
    />
  )
}

function NoMatch({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-ui text-ink-muted">{children}</p>
}

/** The neutral 32px mark for "everything" (All clients, All locations). */
function AllMark() {
  return (
    <AllClientsMark className="size-8 rounded-(--np-radius-control) text-ink-muted" />
  )
}

/** The neutral 32px mark for one location: a pin, never a status colour. */
function LocationMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-(--np-radius-control) bg-fill text-ink-muted",
        className
      )}
    >
      <MapPin className="size-4" strokeWidth={1.75} />
    </span>
  )
}

type ScopeRow = {
  /** The row's id; null for the "All …" row. */
  key: string | null
  name: string
  checked: boolean
  mark: React.ReactNode
  /** Status in words (with an optional tone dot that only reinforces them). */
  sub?: { words: string; dot?: React.ReactNode }
  onChoose: () => void
  /** A trailing chevron that pushes into this row's children. */
  push?: { label: string; onPush: () => void }
}

/**
 * The sheet's list as a radio group: one choice, the checked one is the
 * scope. Arrow keys move between rows (one Tab stop for the whole group,
 * the roving-tabindex pattern), and Enter or Space chooses. Arrows only
 * move here rather than also choosing, as a plain radio group would,
 * because choosing navigates and closes the sheet; walking the list must
 * not switch the scope at every step.
 *
 * A row's chevron (a client's locations) is a separate button after its
 * radio: Tab from a row reaches that row's chevron only, so a long list is
 * still two Tab stops, not one per client.
 */
function ScopeRadioGroup({
  rows,
  label,
  labelledBy,
  pushRef,
}: {
  rows: ScopeRow[]
  label?: string
  labelledBy?: string
  /** Receives each row's chevron, so back can return focus to it. */
  pushRef?: (key: string, node: HTMLButtonElement | null) => void
}) {
  const keys = rows.map((row) => row.key)
  // The Tab stop is the checked row, or the first row while the filter has
  // hidden it (or nothing is checked).
  const checked = rows.find((row) => row.checked)
  const tabStop = checked ? checked.key : keys[0]
  const [active, setActive] = React.useState<string | null | undefined>(
    undefined
  )
  const focusRow =
    active !== undefined && keys.includes(active) ? active : tabStop
  const hasPush = rows.some((row) => row.push)

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0
    const edge = event.key === "Home" ? 0 : event.key === "End" ? -1 : null
    if (!step && edge === null) return
    const radios = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    )
    if (!radios.length) return
    event.preventDefault()
    const row = (document.activeElement as HTMLElement | null)?.closest(
      "[data-scope-row]"
    )
    const at = radios.findIndex(
      (radio) => radio.closest("[data-scope-row]") === row
    )
    const next =
      edge === 0
        ? 0
        : edge === -1
          ? radios.length - 1
          : (Math.max(at, 0) + step + radios.length) % radios.length
    radios[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="-mx-2 flex flex-col"
    >
      {rows.map((row) => (
        <ScopeRadio
          key={row.key ?? "__all__"}
          row={row}
          tabbable={tabStop === row.key}
          pushTabbable={focusRow === row.key}
          reserveChevron={hasPush}
          onFocusRow={() => setActive(row.key)}
          pushRef={
            pushRef && row.key !== null
              ? (node) => pushRef(row.key!, node)
              : undefined
          }
        />
      ))}
    </div>
  )
}

/**
 * One row: mark, name, and the status in words with its tone dot beside
 * them (never the dot alone), then ✓ when it is the scope. The name is the
 * radio's accessible name and the words its description, so a screen
 * reader hears "Harbour Kitchen, radio button, checked, Action needed".
 */
function ScopeRadio({
  row,
  tabbable,
  pushTabbable,
  reserveChevron,
  onFocusRow,
  pushRef,
}: {
  row: ScopeRow
  tabbable: boolean
  pushTabbable: boolean
  reserveChevron: boolean
  onFocusRow: () => void
  pushRef?: (node: HTMLButtonElement | null) => void
}) {
  const nameId = React.useId()
  const subId = React.useId()
  const { checked, sub, push } = row
  return (
    <div data-scope-row="" className="flex min-w-0 items-center">
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        aria-labelledby={nameId}
        aria-describedby={sub ? subId : undefined}
        tabIndex={tabbable ? 0 : -1}
        onClick={row.onChoose}
        onFocus={onFocusRow}
        className={cn(
          "flex min-h-14 w-full min-w-0 flex-1 items-center gap-3 rounded-(--np-radius-control) px-2 py-2 text-left",
          "transition-colors duration-(--np-duration-fast) hover:bg-fill active:bg-fill",
          "focus-halo focus-visible:outline-none"
        )}
      >
        {row.mark}
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            id={nameId}
            className={cn(
              "truncate text-body text-ink",
              checked && "font-medium"
            )}
          >
            {row.name}
          </span>
          {sub ? (
            <span className="flex items-center gap-1.5 text-caption text-ink-muted">
              {sub.dot}
              <span id={subId}>{sub.words}</span>
            </span>
          ) : null}
        </span>
        <CurrentMark current={checked} />
      </button>
      {push ? (
        <button
          ref={pushRef}
          type="button"
          aria-label={push.label}
          tabIndex={pushTabbable ? 0 : -1}
          onClick={push.onPush}
          onFocus={onFocusRow}
          data-slot="scope-sheet-push"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-(--np-radius-pill) text-ink-muted",
            "transition-colors duration-(--np-duration-fast) hover:bg-fill active:bg-fill",
            "focus-halo focus-visible:outline-none"
          )}
        >
          <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
      ) : reserveChevron ? (
        <span aria-hidden className="w-11 shrink-0" />
      ) : null}
    </div>
  )
}

export { LocationMark, ScopeSheet }
