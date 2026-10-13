"use client"

import { ChevronDown, ChevronsUpDown } from "lucide-react"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { guardNavigation } from "@/lib/editors/use-leave-guard"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { healthLabel } from "@/lib/clients/health"
import {
  clientPageKind,
  clientSwitchTarget,
  currentClientId,
  syncClientScope,
} from "@/lib/clients/scope"
import type { ClientSummary } from "@/lib/contracts/clients"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

import {
  AllClientsMark,
  AllClientsOption,
  ClientOption,
  CurrentMark,
  HealthDot,
} from "./client-scope-rows"
import {
  usePageScopeHandler,
  usePageClientScope,
  useRememberedClient,
} from "./client-context"

/** Past this many clients the list gets a search field. */
const SEARCH_THRESHOLD = 8

const ALL = "__all__"

/**
 * The current client and the way to change it, for the switcher and the
 * command palette. `clients` is null while the list is unknown, and empty
 * or single when there is nothing to switch between.
 */
function useClientSwitch() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const clients = useClients()
  const { remembered, setRemembered } = useRememberedClient()
  const pageClientId = usePageClientScope()
  const pageHandler = usePageScopeHandler()

  const items = clients.data?.items ?? null
  const visibleIds = React.useMemo(
    () => (items ? new Set(items.map((client) => client.id)) : null),
    [items]
  )
  const current = currentClientId({
    pathname,
    searchClientId: searchParams.get("clientId"),
    pageClientId,
    remembered,
    visibleIds,
  })

  const select = React.useCallback(
    async (next: string | null) => {
      // The Inbox applies the change itself, behind its unsaved-reply
      // guard; a declined discard leaves everything as it was.
      const handler = pageHandler()
      if (clientPageKind(pathname) === "scoped" && handler) {
        if (await handler(next)) setRemembered(next)
        return
      }
      const target = clientSwitchTarget({
        pathname,
        search: new URLSearchParams(searchParams.toString()),
        current,
        next,
      })
      if (!target) {
        setRemembered(next)
        return
      }
      // Leaving an editor with unsaved edits asks first; staying keeps the
      // client as it was.
      guardNavigation(() => {
        setRemembered(next)
        if (target.mode === "push") router.push(target.href)
        else router.replace(target.href, { scroll: false })
      })
    },
    [current, pageHandler, pathname, router, searchParams, setRemembered]
  )

  return { clients: items, current, select }
}

/**
 * Keeps the remembered client and the address in step (lib/clients/scope.ts
 * `syncClientScope`): remembers what a scoped page's address says, fills
 * the remembered client into a scoped page the operator arrived on
 * unscoped, and silently drops a client the session can no longer see.
 * Waits for the client list, so nothing is filled in or forgotten on a
 * guess.
 */
function ClientScopeSync() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const clients = useClients()
  const { remembered, setRemembered } = useRememberedClient()
  const pageClientId = usePageClientScope()
  const previous = React.useRef<{
    pathname: string | null
    searchClientId: string | null
  } | null>(null)

  const searchClientId = searchParams.get("clientId")
  const narrowed =
    searchParams.has("locationId") || searchParams.has("selected")
  const search = searchParams.toString()
  const data = clients.data

  React.useEffect(() => {
    if (!data) return
    const action = syncClientScope({
      pathname,
      searchClientId,
      pageClientId,
      remembered,
      visibleIds: new Set(data.items.map((client) => client.id)),
      previous: previous.current,
      narrowed,
    })
    previous.current = { pathname, searchClientId }
    if (action.remember !== undefined) setRemembered(action.remember)
    if (action.searchClientId !== undefined && pathname) {
      const params = new URLSearchParams(search)
      if (action.searchClientId) params.set("clientId", action.searchClientId)
      else params.delete("clientId")
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    }
  }, [
    data,
    narrowed,
    pageClientId,
    pathname,
    remembered,
    router,
    search,
    searchClientId,
    setRemembered,
  ])

  return null
}

/**
 * The desk trigger: the current client's mark, name and health dot, or All
 * clients. 34px where a cursor drives it, 44px on a coarse pointer (a
 * tablet). Below md it hides itself in CSS (`max-md:hidden`): a phone gets
 * `ClientScopeChip` in the app bar and `ClientScopeSheet` instead, and
 * choosing by CSS rather than a JS media query keeps the server render
 * right on every width. The accessible name always says "Client: …".
 */
const ClientSwitcherTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { client: ClientSummary | null }
>(function ClientSwitcherTrigger({ client, className, ...props }, ref) {
  const healthId = React.useId()
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Client: ${client ? client.name : "All clients"}`}
      aria-describedby={client ? healthId : undefined}
      data-slot="client-switcher"
      className={cn(
        "flex h-[34px] max-w-[min(16rem,32vw)] min-w-0 shrink-0 items-center gap-2 rounded-md border border-line bg-surface pr-2 pl-1.5 text-ui font-medium text-ink",
        "transition-colors duration-(--np-duration-fast) hover:border-line-strong",
        "focus-halo focus-visible:outline-none",
        "max-md:hidden pointer-coarse:h-11",
        className
      )}
      {...props}
    >
      {client ? (
        <ClientAvatar name={client.name} colour={client.colour} size="xs" />
      ) : (
        <AllClientsMark className="text-ink-muted" />
      )}
      <span aria-hidden className="min-w-0 truncate">
        {client ? client.name : "All clients"}
      </span>
      {client ? (
        <>
          <HealthDot client={client} />
          <span id={healthId} hidden>
            {healthLabel(client.health)}
          </span>
        </>
      ) : null}
      <ChevronsUpDown
        aria-hidden
        className="size-3.5 shrink-0 text-ink-muted"
        strokeWidth={1.75}
      />
    </button>
  )
})

/**
 * The top bar's client switcher: which client the operator is working, on
 * every page, and the one place to change it. Inbox, Listings and Reports
 * follow it through their `?clientId=`; a client's pages switch to the same
 * page of the other client; everywhere else it sets the client the sidebar
 * links carry. See lib/clients/scope.ts for the rules.
 *
 * Hidden while the session sees one client or none: there is nothing to
 * switch. A short list is a menu of radio items; a long one is a searchable
 * list, because scanning forty names by arrow key is not choosing.
 *
 * Desk only (md and up); phones use `ClientScopeChip` + `ClientScopeSheet`.
 */
function ClientSwitcher({ className }: { className?: string }) {
  const { clients, current, select } = useClientSwitch()
  if (!clients || clients.length <= 1) return null
  const client = clients.find((entry) => entry.id === current) ?? null
  return clients.length > SEARCH_THRESHOLD ? (
    <SearchableSwitcher
      clients={clients}
      client={client}
      onSelect={select}
      className={className}
    />
  ) : (
    <MenuSwitcher
      clients={clients}
      client={client}
      onSelect={select}
      className={className}
    />
  )
}

type SwitcherProps = {
  clients: ClientSummary[]
  client: ClientSummary | null
  onSelect: (clientId: string | null) => void
  className?: string
}

function MenuSwitcher({ clients, client, onSelect, className }: SwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<ClientSwitcherTrigger client={client} className={className} />}
      />
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuRadioGroup
          value={client?.id ?? ALL}
          onValueChange={(value: string) =>
            void onSelect(value === ALL ? null : value)
          }
        >
          <DropdownMenuRadioItem value={ALL} closeOnClick>
            <AllClientsOption />
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {clients.map((entry) => (
            <DropdownMenuRadioItem key={entry.id} value={entry.id} closeOnClick>
              <ClientOption client={entry} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The searchable list is cmdk, which brings its own dialog stack with it:
 * loaded on first open (or warmed when the pointer or focus reaches the
 * trigger) so it stays out of every route's first JavaScript. Client-only,
 * because it only ever renders inside an open popover.
 */
const loadClientSearch = () => import("./client-switcher-search")

const ClientSearchList = dynamic(
  () => loadClientSearch().then((module) => module.ClientSearchList),
  {
    ssr: false,
    // The popover's own height while the chunk arrives, rather than a
    // collapsed sliver that jumps open.
    loading: () => <div aria-hidden className="h-44" />,
  }
)

function warmClientSearch() {
  void loadClientSearch()
}

function SearchableSwitcher({
  clients,
  client,
  onSelect,
  className,
}: SwitcherProps) {
  const [open, setOpen] = React.useState(false)
  const choose = (next: string | null) => {
    setOpen(false)
    void onSelect(next)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ClientSwitcherTrigger
            client={client}
            className={className}
            aria-haspopup="dialog"
            onPointerEnter={warmClientSearch}
            onFocus={warmClientSearch}
          />
        }
      />
      <PopoverContent
        align="start"
        aria-label="Switch client"
        className="w-[min(320px,calc(100vw-24px))] p-0"
      >
        <ClientSearchList
          clients={clients}
          current={client?.id ?? null}
          onChoose={choose}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The scope as words, for anything that has to say which client is in
 * scope without being the switcher: the phone More sheet's "Working on:
 * <name>" row. `visible` follows the switcher's rule (a known list of more
 * than one client); `healthWords` is the scoped client's health as a word,
 * never a colour alone.
 */
function useClientScopeLabel(): {
  visible: boolean
  client: ClientSummary | null
  label: string
  healthWords: string | null
} {
  const { clients, current } = useClientSwitch()
  const visible = Boolean(clients && clients.length > 1)
  const client = clients?.find((entry) => entry.id === current) ?? null
  return {
    visible,
    client,
    label: client ? client.name : "All clients",
    healthWords: client ? healthLabel(client.health) : null,
  }
}

/**
 * The phone app bar's leading control: which client is in scope, as a
 * labelled chip that opens `ClientScopeSheet`. Hidden by the same rule as
 * the desk switcher (nothing to switch between). No health dot: in a 52px
 * bar a dot with no room for its word would be colour as the only signal,
 * so health is spelled out in the sheet instead.
 */
function ClientScopeChip({
  onOpen,
  className,
}: {
  onOpen: () => void
  className?: string
}) {
  const { visible, client, label } = useClientScopeLabel()
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Client: ${label}`}
      aria-haspopup="dialog"
      data-slot="client-scope-chip"
      className={cn(
        "flex min-h-11 max-w-[60vw] min-w-0 shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) px-2 text-ui font-medium text-ink",
        "transition-colors duration-(--np-duration-fast) hover:bg-fill active:bg-fill",
        "focus-halo focus-visible:outline-none",
        className
      )}
    >
      {client ? (
        <ClientAvatar name={client.name} colour={client.colour} size="xs" />
      ) : (
        <AllClientsMark className="text-ink-muted" />
      )}
      <span aria-hidden className="min-w-0 truncate">
        {label}
      </span>
      <ChevronDown
        aria-hidden
        className="size-4 shrink-0 text-ink-muted"
        strokeWidth={1.75}
      />
    </button>
  )
}

/**
 * The phone's client picker: a bottom sheet (a transient choice belongs
 * within reach of the thumb), listing All clients and every client with its
 * health in words. Choosing goes through `useClientSwitch().select`, so it
 * follows the same page rules as the desk switcher, including the Inbox's
 * unsaved-reply guard and the editors' leave guard, then closes.
 *
 * Past eight clients a plain search field filters the list. Not cmdk: a
 * native field is all a filter needs, and it keeps cmdk out of the shell.
 */
function ClientScopeSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { clients, current, select } = useClientSwitch()
  const [query, setQuery] = React.useState("")

  // The filter starts empty every time the sheet opens, rather than
  // reopening on a list narrowed to one stale name. Reset whenever `open`
  // turns false, however the sheet was closed (a choice, Escape, or the
  // shell closing it on a route change), during render so the stale words
  // never paint.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setQuery("")
  }

  const choose = (clientId: string | null) => {
    onOpenChange(false)
    void select(clientId)
  }

  const list = clients ?? []
  const searchable = list.length > SEARCH_THRESHOLD
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? list.filter((entry) => entry.name.toLowerCase().includes(needle))
    : list
  const showAll = !needle || "all clients".includes(needle)
  const scoped = list.some((entry) => entry.id === current) ? current : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Working on</SheetTitle>
          <SheetDescription>
            Inbox, Listings and Reports show this client. Choose All clients to
            see everything.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-[max(20px,var(--np-safe-bottom))]">
          {searchable ? (
            // The shared search field: a plain native input (not cmdk),
            // 16px (`text-body`) and 44px tall on touch, so iOS never zooms
            // the page on focus.
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search clients"
              placeholder="Search clients"
              autoComplete="off"
              enterKeyHint="search"
              className="shrink-0"
            />
          ) : null}
          {showAll || matches.length ? (
            <ClientRadioGroup
              current={scoped}
              clients={matches}
              showAll={showAll}
              onChoose={choose}
            />
          ) : (
            <p className="py-6 text-center text-ui text-ink-muted">
              No client matches that.
            </p>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

/**
 * The sheet's list as a radio group: one choice, the checked one is the
 * client in scope. Arrow keys move between rows (one Tab stop for the whole
 * group, the roving-tabindex pattern), and Enter or Space chooses. Arrows
 * only move here rather than also choosing, as a plain radio group would,
 * because choosing navigates and closes the sheet; walking the list must
 * not switch the client at every step.
 */
function ClientRadioGroup({
  clients,
  current,
  showAll,
  onChoose,
}: {
  clients: ClientSummary[]
  current: string | null
  showAll: boolean
  onChoose: (clientId: string | null) => void
}) {
  const ids: (string | null)[] = [
    ...(showAll ? [null] : []),
    ...clients.map((entry) => entry.id),
  ]
  // The Tab stop is the checked row, or the first row while the filter has
  // hidden it.
  const tabStop = ids.includes(current) ? current : ids[0]

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
    const at = radios.indexOf(document.activeElement as HTMLButtonElement)
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
      aria-label="Client"
      onKeyDown={onKeyDown}
      className="-mx-2 flex flex-col"
    >
      {showAll ? (
        <ScopeRadio
          checked={current === null}
          tabbable={tabStop === null}
          onChoose={() => onChoose(null)}
          mark={
            <AllClientsMark className="size-8 rounded-(--np-radius-control) text-ink-muted" />
          }
          name="All clients"
        />
      ) : null}
      {clients.map((entry) => (
        <ScopeRadio
          key={entry.id}
          checked={entry.id === current}
          tabbable={tabStop === entry.id}
          onChoose={() => onChoose(entry.id)}
          mark={<ClientAvatar name={entry.name} colour={entry.colour} />}
          name={entry.name}
          health={entry}
        />
      ))}
    </div>
  )
}

/**
 * One row: mark, name, and the health in words with its tone dot beside
 * them (never the dot alone). The name is the radio's accessible name and
 * the health its description, so a screen reader hears "Harbour Kitchen,
 * radio button, checked, Action needed".
 */
function ScopeRadio({
  checked,
  tabbable,
  onChoose,
  mark,
  name,
  health,
}: {
  checked: boolean
  tabbable: boolean
  onChoose: () => void
  mark: React.ReactNode
  name: string
  health?: ClientSummary
}) {
  const nameId = React.useId()
  const healthId = React.useId()
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-labelledby={nameId}
      aria-describedby={health ? healthId : undefined}
      tabIndex={tabbable ? 0 : -1}
      onClick={onChoose}
      className={cn(
        "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-(--np-radius-control) px-2 py-2 text-left",
        "transition-colors duration-(--np-duration-fast) hover:bg-fill active:bg-fill",
        "focus-halo focus-visible:outline-none",
        checked && "bg-accent-tint"
      )}
    >
      {mark}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          id={nameId}
          className={cn(
            "truncate text-body text-ink",
            checked && "font-medium"
          )}
        >
          {name}
        </span>
        {health ? (
          <span className="flex items-center gap-1.5 text-caption text-ink-muted">
            <HealthDot client={health} />
            <span id={healthId}>{healthLabel(health.health)}</span>
          </span>
        ) : null}
      </span>
      <CurrentMark current={checked} />
    </button>
  )
}

export {
  ClientScopeChip,
  ClientScopeSheet,
  ClientScopeSync,
  ClientSwitcher,
  useClientScopeLabel,
  useClientSwitch,
}
