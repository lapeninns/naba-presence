"use client"

import { Building2, ChevronRight, MapPin } from "lucide-react"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { Input } from "@/components/ui/input"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import {
  Sheet,
  SheetBack,
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

import { HealthDot } from "./client-scope-rows"
import {
  SEARCH_THRESHOLD,
  announceSwitch,
  locationScopeName,
  locationStatusWords,
  useClientSwitch,
  useLocationSwitch,
} from "./scope-sheet-model"

/**
 * The phone's scope switcher, after Notion Mail's account switcher: an
 * inset sheet (a floating card above the dock) titled "Working on" whose
 * option rows are the scopes, the current one ticked. Choosing applies at once, closes the sheet, and a toast names the
 * new scope ("Switched to Harbour Kitchen").
 *
 * - Agency: All clients and each client, health in words. A client's
 *   trailing chevron pushes, inside the sheet, to that client's locations
 *   ("‹ Back", named "Back to All clients", goes back).
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

  const pushButtons = React.useRef(new Map<string, HTMLButtonElement>())
  const returnTo = React.useRef<string | null>(null)

  const list = clients ?? []
  const scoped = list.some((entry) => entry.id === current) ? current : null
  const pushed = pushedId
    ? (list.find((entry) => entry.id === pushedId) ?? null)
    : null

  // In-sheet push: the header's `page` moves focus to the new view's title
  // (SheetHeader). Back returns it to the chevron that pushed instead: this
  // effect runs after the header's (a parent's effects follow its
  // children's), so the chevron wins over the "Working on" title.
  React.useEffect(() => {
    if (!pushedId && returnTo.current) {
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
    // Likewise All clients while no client is in scope but a location is.
    if (clientId === scoped && locations.current) {
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
      <SheetContent variant="inset">
        <SheetHeader
          page={pushed ? `client:${pushed.id}` : "clients"}
          back={
            pushed ? <SheetBack to="All clients" onClick={back} /> : undefined
          }
        >
          <SheetTitle className="max-w-full truncate">
            {pushed ? pushed.name : "Working on"}
          </SheetTitle>
          <SheetDescription>
            {pushed
              ? "Inbox and Reports narrow to the location you choose; anywhere else opens its listing."
              : "Inbox, Listings and Reports show this client. Choose All clients to see everything."}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
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
            mark: <Building2 />,
            onChoose: () => onChoose(null),
          },
        ]
      : []),
    ...matches.map((entry): ScopeRow => ({
      key: entry.id,
      name: entry.name,
      checked: entry.id === scoped,
      mark: <ClientAvatar name={entry.name} colour={entry.colour} size="xs" />,
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
  return <ScopeOptions label="Client" rows={rows} pushRef={pushRef} />
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
            mark: (
              <ClientAvatar
                name={client.name}
                colour={client.colour}
                size="xs"
              />
            ),
            onChoose: onChooseClient,
          },
        ]
      : []),
    ...matches.map((entry): ScopeRow => ({
      key: entry.id,
      name: entry.name,
      checked: entry.id === currentLocation,
      mark: <MapPin />,
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
      <p id={groupId} className="px-3 text-caption font-medium text-ink-muted">
        Locations
      </p>
      {rows.length ? (
        <ScopeOptions labelledBy={groupId} rows={rows} />
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
            mark: <Building2 />,
            onChoose: chooseAll,
          },
        ]
      : []),
    ...matches.map((entry): ScopeRow => ({
      key: entry.id,
      name: entry.name,
      checked: entry.id === locations.current,
      mark: <MapPin />,
      sub: wordsFor(entry),
      onChoose: () => choose(entry),
    })),
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent variant="inset">
        <SheetHeader>
          <SheetTitle>Working on</SheetTitle>
          <SheetDescription>
            Inbox and Reports narrow to the location you choose; anywhere else
            opens its listing.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
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
                <ScopeOptions label="Location" rows={rows} />
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
  /** The 20px leading icon (OptionRow's icon slot): avatar, pin or All. */
  mark: React.ReactNode
  /** Status in words (with an optional tone dot that only reinforces them). */
  sub?: { words: string; dot?: React.ReactNode }
  onChoose: () => void
  /** A trailing chevron that pushes into this row's children. */
  push?: { label: string; onPush: () => void }
}

const ROW_SELECTOR = '[data-slot="option-row"]:not(:disabled)'
const PUSH_SELECTOR = '[data-slot="scope-sheet-push"]'

/**
 * The sheet's list: `OptionRowGroup` in its apply-on-choose mode (a
 * listbox of options, the current scope selected and ticked). Arrow keys
 * only move between rows (one Tab stop for the whole list, roving
 * tabindex), and Enter, Space or a tap chooses: choosing navigates and
 * closes the sheet, so walking the list must not switch the scope at every
 * step.
 *
 * A client's chevron (its locations) is a separate 44px button beside its
 * row, never inside the option, and outside the listbox, which may only
 * hold options: the listbox and the chevron column share one grid
 * (subgrid rows), so each chevron sits level with its row. Only the
 * focused row's chevron is in the Tab order, so Tab from a row reaches that
 * row's chevron and a long list is still two Tab stops. Arrows from a
 * chevron move on to the rows, as they do from a row.
 */
function ScopeOptions({
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
  const checked = rows.find((row) => row.checked)
  const tabStop = checked ? checked.key : keys[0]
  const [active, setActive] = React.useState<string | null | undefined>(
    undefined
  )
  const focusRow =
    active !== undefined && keys.includes(active) ? active : tabStop
  const hasPush = rows.some((row) => row.push)

  /** Arrow keys on a chevron move to the rows, as the group's own do. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const from = (event.target as HTMLElement).closest<HTMLElement>(
      PUSH_SELECTOR
    )
    if (!from) return
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0
    const edge = event.key === "Home" ? 0 : event.key === "End" ? -1 : null
    if (!step && edge === null) return
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR)
    )
    if (!options.length) return
    event.preventDefault()
    const at = Number(from.dataset.rowIndex ?? 0)
    const next =
      edge === 0
        ? 0
        : edge === -1
          ? options.length - 1
          : (at + step + options.length) % options.length
    options[next]?.focus()
  }

  const group = (
    <OptionRowGroup
      applyOnChoose
      label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cn(
        hasPush && "col-start-1 row-span-(--scope-rows) grid grid-rows-subgrid"
      )}
      style={
        hasPush
          ? ({ "--scope-rows": rows.length } as React.CSSProperties)
          : undefined
      }
    >
      {rows.map((row) => (
        <OptionRow
          key={row.key ?? "__all__"}
          indicator="check"
          selected={row.checked}
          icon={row.mark}
          label={<span className="block truncate">{row.name}</span>}
          description={
            row.sub ? (
              <span className="flex items-center gap-1.5">
                {row.sub.dot}
                <span>{row.sub.words}</span>
              </span>
            ) : undefined
          }
          onClick={row.onChoose}
          onFocus={() => setActive(row.key)}
        />
      ))}
    </OptionRowGroup>
  )

  if (!hasPush) return group

  return (
    // The keydown handler only serves the chevrons; the group handles its
    // own rows.
    <div
      onKeyDown={onKeyDown}
      className="grid grid-cols-[1fr_auto] gap-x-1 gap-y-1"
    >
      {group}
      {rows.map((row, index) =>
        row.push ? (
          <button
            key={row.key ?? "__all__"}
            ref={
              pushRef && row.key !== null
                ? (node) => pushRef(row.key!, node)
                : undefined
            }
            type="button"
            aria-label={row.push.label}
            tabIndex={focusRow === row.key ? 0 : -1}
            onClick={row.push.onPush}
            onFocus={() => setActive(row.key)}
            data-slot="scope-sheet-push"
            data-row-index={index}
            style={{ "--scope-row": index + 1 } as React.CSSProperties}
            className={cn(
              "col-start-2 row-start-(--scope-row) flex size-11 shrink-0 items-center justify-center self-center rounded-(--np-radius-pill) text-ink-muted",
              "transition-colors duration-(--np-duration-fast) hover:bg-fill active:bg-fill",
              "focus-halo focus-visible:outline-none"
            )}
          >
            <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
          </button>
        ) : null
      )}
    </div>
  )
}

export { LocationMark, ScopeSheet }
