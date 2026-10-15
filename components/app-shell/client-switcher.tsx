"use client"

import { ChevronsUpDown } from "lucide-react"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { healthLabel } from "@/lib/clients/health"
import { syncClientScope } from "@/lib/clients/scope"
import type { ClientSummary } from "@/lib/contracts/clients"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { usePageClientScope, useRememberedClient } from "./client-context"
import {
  AllClientsMark,
  AllClientsOption,
  ClientOption,
  HealthDot,
} from "./client-scope-rows"
import { LocationMark, ScopeSheet } from "./scope-sheet"
import {
  SEARCH_THRESHOLD,
  announceSwitch,
  useClientScopeLabel,
  useClientSwitch,
  useScopeLabel,
  type ScopeLabel,
} from "./scope-sheet-model"

const ALL = "__all__"

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
  // The toast names the new scope once the switch has happened (not when a
  // page or an editor's leave prompt declines it).
  const onSelect = (next: string | null) => {
    const name = next
      ? (clients.find((entry) => entry.id === next)?.name ?? next)
      : "All clients"
    return select(next, () => announceSwitch(name))
  }
  return clients.length > SEARCH_THRESHOLD ? (
    <SearchableSwitcher
      clients={clients}
      client={client}
      onSelect={onSelect}
      className={className}
    />
  ) : (
    <MenuSwitcher
      clients={clients}
      client={client}
      onSelect={onSelect}
      className={className}
    />
  )
}

type SwitcherProps = {
  clients: ClientSummary[]
  client: ClientSummary | null
  onSelect: (clientId: string | null) => Promise<void>
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
          <DropdownMenuRadioItem
            value={ALL}
            closeOnClick
            indicatorPosition="end"
          >
            <AllClientsOption />
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {clients.map((entry) => (
            <DropdownMenuRadioItem
              key={entry.id}
              value={entry.id}
              closeOnClick
              indicatorPosition="end"
            >
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
 * The phone app bar's scope trigger, after Notion Mail's trailing account
 * avatar: the scope's mark (the client's avatar, a location pin, or the
 * neutral "everything" mark) in a 44px hit area, with the scope's name
 * beside it, truncated with the full name in `title` (`labelled={false}`
 * leaves only the mark: the app bar does that on a client's own page, where
 * the title already says which client). Opens `ClientScopeSheet`.
 *
 * Hidden when there is nothing to switch: agency, one client or none (or the
 * list unknown); business, one location or none. The accessible name says
 * what it holds: "Client: Harbour Kitchen", or in business mode "Location:
 * The Bell" (a business never sees "client"). No health dot: health is
 * spelled out in the sheet, never a colour alone in a 52px bar.
 */
function ClientScopeChip({
  onOpen,
  className,
  mode = "agency",
  labelled = true,
}: {
  onOpen: () => void
  className?: string
  mode?: WorkspaceMode
  labelled?: boolean
}) {
  const scope = useScopeLabel(mode)
  if (!scope.visible) return null
  const noun = mode === "business" ? "Location" : "Client"
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${noun}: ${scope.label}`}
      aria-haspopup="dialog"
      data-slot="client-scope-chip"
      data-mode={mode}
      className={cn(
        "flex min-h-11 max-w-[60vw] min-w-11 shrink items-center justify-center gap-2 rounded-(--np-radius-pill) text-ui font-medium text-ink",
        labelled ? "pr-2 pl-1.5" : "px-1.5",
        "transition-colors duration-(--np-duration-fast) hover:bg-fill active:bg-fill",
        "focus-halo focus-visible:outline-none",
        className
      )}
    >
      <ScopeMark scope={scope} />
      {labelled ? (
        <span
          aria-hidden
          title={scope.label}
          className="max-w-28 min-w-0 truncate"
        >
          {scope.label}
        </span>
      ) : null}
    </button>
  )
}

/** The trigger's 32px mark for whatever is in scope. */
function ScopeMark({ scope }: { scope: ScopeLabel }) {
  if (scope.mode === "business") {
    return scope.location ? (
      <LocationMark />
    ) : (
      <AllClientsMark className="size-8 rounded-(--np-radius-control) text-ink-muted" />
    )
  }
  return scope.client ? (
    <ClientAvatar name={scope.client.name} colour={scope.client.colour} />
  ) : (
    <AllClientsMark className="size-8 rounded-(--np-radius-control) text-ink-muted" />
  )
}

/**
 * The phone's scope picker (scope-sheet.tsx): a bottom sheet titled
 * "Working on". Agency: All clients and each client, each client's
 * locations one push away. Business (`mode="business"`): All locations and
 * each location. Choosing a client goes through `useClientSwitch().select`,
 * so it follows the same page rules as the desk switcher, including the
 * Inbox's unsaved-reply guard and the editors' leave guard; choosing a
 * location goes through the leave guard too. A toast names the new scope.
 */
function ClientScopeSheet({
  open,
  onOpenChange,
  mode = "agency",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: WorkspaceMode
}) {
  return <ScopeSheet open={open} onOpenChange={onOpenChange} mode={mode} />
}

export {
  ClientScopeChip,
  ClientScopeSheet,
  ClientScopeSync,
  ClientSwitcher,
  useClientScopeLabel,
  useClientSwitch,
  useScopeLabel,
}
export type { ScopeLabel }
