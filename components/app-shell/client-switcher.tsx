"use client"

import { Building2, CheckIcon, ChevronsUpDown } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
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
import { healthLabel, healthTone } from "@/lib/clients/health"
import {
  clientPageKind,
  clientSwitchTarget,
  currentClientId,
  syncClientScope,
} from "@/lib/clients/scope"
import type { ClientSummary } from "@/lib/contracts/clients"
import { useClients } from "@/lib/queries/use-clients"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

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
      setRemembered(next)
      if (!target) return
      if (target.mode === "push") router.push(target.href)
      else router.replace(target.href, { scroll: false })
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

function HealthDot({ client }: { client: ClientSummary }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        TONE_CLASSES[healthTone(client.health)].dot
      )}
    />
  )
}

/** One row of the list: the client's mark, name and health. */
function ClientOption({ client }: { client: ClientSummary }) {
  return (
    <>
      <ClientAvatar name={client.name} colour={client.colour} size="xs" />
      <span className="min-w-0 flex-1 truncate">{client.name}</span>
      <HealthDot client={client} />
      <span className="sr-only">, {healthLabel(client.health)}</span>
    </>
  )
}

function AllClientsOption() {
  return (
    <>
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-(--np-radius-tag) bg-fill"
      >
        <Building2 className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate">All clients</span>
    </>
  )
}

/**
 * The trigger: the current client's mark, name and health dot, or All
 * clients. 34px where a cursor drives it, 44px on touch. Below 640px the
 * name folds away and the mark alone shows; the accessible name always
 * says "Client: …".
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
        "max-sm:size-11 max-sm:max-w-none max-sm:justify-center max-sm:p-0 pointer-coarse:h-11",
        className
      )}
      {...props}
    >
      {client ? (
        <ClientAvatar name={client.name} colour={client.colour} size="xs" />
      ) : (
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-(--np-radius-tag) bg-fill"
        >
          <Building2 className="size-3.5 text-ink-muted" strokeWidth={1.75} />
        </span>
      )}
      <span aria-hidden className="min-w-0 truncate max-sm:hidden">
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
        className="size-3.5 shrink-0 text-ink-muted max-sm:hidden"
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

/** The menu's check column, for the searchable list (aria-current says it). */
function CurrentMark({ current }: { current: boolean }) {
  return (
    <CheckIcon
      aria-hidden
      strokeWidth={2}
      className={cn("size-4 text-accent-ink!", !current && "invisible")}
    />
  )
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
          />
        }
      />
      <PopoverContent
        align="start"
        aria-label="Switch client"
        className="w-[min(320px,calc(100vw-24px))] p-0"
      >
        {/* cmdk names the field and the list from `label`. The filter
            matches names only: an item's value is its id, which would
            otherwise match any search that happens to be hex. */}
        <Command
          label="Search clients"
          filter={(_value, search, keywords) =>
            (keywords ?? []).some((keyword) =>
              keyword.toLowerCase().includes(search.trim().toLowerCase())
            )
              ? 1
              : 0
          }
          className="rounded-(--np-radius-card)"
        >
          <CommandInput placeholder="Search clients" className="h-11 text-ui" />
          <CommandList className="max-h-[min(50vh,24rem)]">
            <CommandEmpty>No client matches that.</CommandEmpty>
            <CommandItem
              value={ALL}
              keywords={["All clients"]}
              aria-current={client === null ? "true" : undefined}
              onSelect={() => choose(null)}
            >
              <CurrentMark current={client === null} />
              <AllClientsOption />
            </CommandItem>
            <CommandSeparator />
            {clients.map((entry) => (
              <CommandItem
                key={entry.id}
                value={entry.id}
                keywords={[entry.name]}
                aria-current={entry.id === client?.id ? "true" : undefined}
                onSelect={() => choose(entry.id)}
              >
                <CurrentMark current={entry.id === client?.id} />
                <ClientOption client={entry} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { ClientScopeSync, ClientSwitcher, useClientSwitch }
