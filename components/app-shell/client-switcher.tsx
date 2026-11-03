"use client"

import { ChevronDown, ChevronsUpDown } from "lucide-react"
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
import { syncClientScope } from "@/lib/clients/scope"
import { destinationForPath } from "@/lib/navigation/destinations"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import type { ClientSummary } from "@/lib/contracts/clients"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { usePageClientScope, useRememberedClient } from "./client-context"
import {
  AllClientsMark,
  AllClientsOption,
  ClientOption,
} from "./client-scope-rows"
import { BusinessScopeList, LocationMark, ScopeSheet } from "./scope-sheet"
import {
  SEARCH_THRESHOLD,
  announceSwitch,
  useClientScopeLabel,
  useClientSwitch,
  useScopeControl,
  useScopeLabel,
  type ScopeControl,
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

/** The three sizes of the one scope control (DIRECTION §7.3). */
type ScopeVariant = "sidebar" | "pill" | "chip"

const TRIGGER_CLASS: Record<ScopeVariant, string> = {
  // The desk sidebar's "Working on" button: two lines, full width.
  sidebar: cn(
    "flex min-h-14 w-full min-w-0 items-center gap-2.5 rounded-(--np-radius-control) border border-line bg-surface p-2 text-left",
    "transition-colors duration-(--np-duration-fast) hover-fine:hover:border-line-strong aria-expanded:bg-fill"
  ),
  // The tablet top bar's pill: one line, the words after the name.
  pill: cn(
    "flex h-11 max-w-[45vw] min-w-0 shrink items-center gap-2 rounded-(--np-radius-pill) border border-line bg-surface pr-3 pl-1.5 text-left desk:h-9 lg:max-w-md",
    "transition-colors duration-(--np-duration-fast) hover-fine:hover:border-line-strong aria-expanded:bg-fill"
  ),
  // The phone app bar's chip: the name only; the words are in its name.
  chip: cn(
    "flex min-h-11 max-w-full min-w-11 shrink items-center gap-1.5 rounded-(--np-radius-pill) border border-line bg-surface py-1 pr-2 pl-1 text-left",
    "transition-colors duration-(--np-duration-fast) active:bg-fill aria-expanded:bg-fill"
  ),
}

/** The scope's mark: the client's avatar, a location pin, or "everything". */
function ScopeMark({
  control,
  size = "sm",
}: {
  control: ScopeControl
  size?: "xs" | "sm"
}) {
  const box = size === "xs" ? "size-6" : "size-8"
  if (control.mode === "agency" && control.client) {
    return (
      <ClientAvatar
        name={control.client.name}
        colour={control.client.colour}
        size={size}
      />
    )
  }
  if (control.mode === "business" && control.location) {
    return <LocationMark className={box} />
  }
  return (
    <AllClientsMark
      className={cn(box, "rounded-(--np-radius-control) text-ink-muted")}
    />
  )
}

/** The tone dot that repeats the words beside it. Never alone. */
function ToneDot({ tone }: { tone: ScopeControl["tone"] }) {
  return (
    <span
      aria-hidden
      data-slot="scope-health-dot"
      className={cn("size-2 shrink-0 rounded-full", TONE_CLASSES[tone].dot)}
    />
  )
}

/**
 * What the control draws, at its size. The words are drawn for the eye and
 * hidden from assistive technology: the control's accessible name already
 * carries them (`control.name`), so they are heard once.
 */
function ScopeFace({
  control,
  variant,
  interactive,
}: {
  control: ScopeControl
  variant: ScopeVariant
  interactive: boolean
}) {
  const Chevron = variant === "sidebar" ? ChevronsUpDown : ChevronDown
  return (
    <>
      <ScopeMark control={control} size={variant === "pill" ? "xs" : "sm"} />
      {variant === "sidebar" ? (
        <span aria-hidden className="flex min-w-0 flex-1 flex-col">
          <span
            title={control.title}
            className="truncate text-ui font-semibold text-ink"
          >
            {control.title}
          </span>
          {control.detail ? (
            <span className="flex min-w-0 items-start gap-1.5 text-caption text-ink-muted">
              <span className="flex h-(--np-text-caption-lh) items-center">
                <ToneDot tone={control.tone} />
              </span>
              <span data-slot="scope-detail" className="line-clamp-2">
                {control.detail}
              </span>
            </span>
          ) : null}
        </span>
      ) : (
        <span aria-hidden className="flex min-w-0 flex-1 items-center gap-2">
          <span
            title={control.title}
            className="min-w-0 shrink truncate text-ui font-medium text-ink"
          >
            {control.title}
          </span>
          {control.detail ? <ToneDot tone={control.tone} /> : null}
          {variant === "pill" && control.detail ? (
            <span
              data-slot="scope-detail"
              title={control.detail}
              className="min-w-0 shrink-2 truncate text-caption text-ink-muted"
            >
              {control.detail}
            </span>
          ) : null}
        </span>
      )}
      {interactive ? (
        <Chevron
          aria-hidden
          className="size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
        />
      ) : null}
    </>
  )
}

/**
 * The control as a button: it opens the shared picker (a menu or a
 * searchable list on a desk or tablet, the "Working on" sheet on a phone).
 * Its accessible name is `control.name`, which starts "Working on" and
 * carries the health words.
 */
const ScopeTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    control: ScopeControl
    variant: ScopeVariant
  }
>(function ScopeTrigger({ control, variant, className, ...props }, ref) {
  return (
    // The menu or popover trigger's props go first, so its own
    // `data-slot` never replaces the control's.
    <button
      {...props}
      ref={ref}
      type="button"
      aria-label={control.name}
      data-slot="scope-control"
      data-variant={variant}
      data-mode={control.mode}
      data-tone={control.tone}
      className={cn(
        TRIGGER_CLASS[variant],
        "focus-halo focus-visible:outline-none",
        className
      )}
    >
      <ScopeFace control={control} variant={variant} interactive />
    </button>
  )
})

/**
 * The control when there is nothing to switch (one client, one location):
 * it still says what is in scope and how it is, but it is not a button.
 */
function ScopeStatic({
  control,
  variant,
  className,
}: {
  control: ScopeControl
  variant: ScopeVariant
  className?: string
}) {
  return (
    <div
      data-slot="scope-control"
      data-variant={variant}
      data-mode={control.mode}
      data-tone={control.tone}
      data-static="true"
      className={cn(
        TRIGGER_CLASS[variant],
        "border-transparent bg-transparent",
        className
      )}
    >
      <span className="sr-only">{control.name}</span>
      <ScopeFace control={control} variant={variant} interactive={false} />
    </div>
  )
}

/**
 * Whether the page ignores the scope (`scoped: false` in the destination
 * registry: Notifications, Team, Settings). Those pages show no scope
 * control at any size (DIRECTION §4), so nothing suggests the page follows
 * it.
 */
function useOrgWidePage(): boolean {
  return destinationForPath(usePathname())?.scoped === false
}

/**
 * The one scope control, at one of its three sizes (DIRECTION §7.3, D8):
 *
 * - `sidebar`: the desk sidebar's "Working on" button (from `wide`): the
 *   scope's mark, its name, and its listings and health in words beneath,
 *   with the tone dot. It opens a menu, or a searchable list past eight.
 * - `pill`: the tablet top bar's pill (768 to 1180): the same on one line.
 * - `chip`: the phone app bar's chip: the mark and the name; the words are
 *   in its accessible name and in the "Working on" sheet it opens.
 *
 * An agency chooses a client (then, on a phone, a location); a business
 * reads its own name with All locations or one location, never "client".
 * Every size names the scope with its health in words, which is what the
 * retired health chip said. Hidden on organisation-wide pages and while
 * the list that decides it is unknown; drawn but inert when there is
 * nothing to switch.
 */
function ScopeControlView({
  variant,
  mode,
  organisationName,
  onOpenSheet,
  className,
}: {
  variant: ScopeVariant
  mode: WorkspaceMode
  organisationName: string | null
  /** The phone chip opens the "Working on" sheet the shell owns. */
  onOpenSheet?: () => void
  className?: string
}) {
  const control = useScopeControl(mode, organisationName)
  const orgWide = useOrgWidePage()
  if (orgWide || !control.ready) return null
  const inner = !control.switchable ? (
    <ScopeStatic
      control={control}
      variant={variant}
      className={variant === "sidebar" ? undefined : className}
    />
  ) : variant === "chip" ? (
    <ScopeTrigger
      control={control}
      variant="chip"
      aria-haspopup="dialog"
      onClick={onOpenSheet}
      className={className}
    />
  ) : mode === "business" ? (
    <BusinessScopePopover
      control={control}
      variant={variant}
      className={variant === "sidebar" ? undefined : className}
    />
  ) : (
    <ClientSwitcher
      control={control}
      variant={variant}
      className={variant === "sidebar" ? undefined : className}
    />
  )
  if (variant !== "sidebar") return inner
  // The sidebar says what the button is above it, as the concept does;
  // the words are already the start of the button's accessible name.
  return (
    <div data-slot="sidebar-scope" className={cn("flex flex-col", className)}>
      <span
        aria-hidden
        className="px-1 pb-1 text-caption font-medium text-ink-muted"
      >
        Working on
      </span>
      {inner}
    </div>
  )
}

/**
 * A business's desk picker: the same list the phone sheet shows (All
 * locations and each location, a search field past eight), in a popover
 * under the control.
 */
function BusinessScopePopover({
  control,
  variant,
  className,
}: {
  control: ScopeControl
  variant: ScopeVariant
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ScopeTrigger
            control={control}
            variant={variant}
            aria-haspopup="dialog"
            className={className}
          />
        }
      />
      <PopoverContent
        align="start"
        aria-label="Working on"
        className="flex max-h-[min(70vh,--spacing(120))] w-80 flex-col gap-2 overflow-y-auto p-2"
      >
        <BusinessScopeList open={open} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * An agency's desk picker: which client the operator is working, on every
 * scoped page, and the one place to change it. Inbox, Listings and Reports
 * follow it through their `?clientId=`; a client's pages switch to the same
 * page of the other client; everywhere else it sets the client the
 * navigation links carry. See lib/clients/scope.ts for the rules (the
 * address always wins).
 *
 * A short list is a menu of radio items; a long one is a searchable list,
 * because scanning forty names by arrow key is not choosing. With no
 * `control` (tests, older callers) it draws the pill and reads the scope
 * itself.
 */
function ClientSwitcher({
  className,
  control: given,
  variant = "pill",
}: {
  className?: string
  control?: ScopeControl
  variant?: ScopeVariant
}) {
  const { clients, current, select } = useClientSwitch()
  const own = useScopeControl("agency", null)
  const control = given ?? own
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
  const props = {
    clients,
    client,
    onSelect,
    className,
    control,
    variant,
  }
  return clients.length > SEARCH_THRESHOLD ? (
    <SearchableSwitcher {...props} />
  ) : (
    <MenuSwitcher {...props} />
  )
}

type SwitcherProps = {
  clients: ClientSummary[]
  client: ClientSummary | null
  onSelect: (clientId: string | null) => Promise<void>
  className?: string
  control: ScopeControl
  variant: ScopeVariant
}

function MenuSwitcher({
  clients,
  client,
  onSelect,
  className,
  control,
  variant,
}: SwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ScopeTrigger
            control={control}
            variant={variant}
            className={className}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-80">
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
  control,
  variant,
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
          <ScopeTrigger
            control={control}
            variant={variant}
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
        className="w-[min(--spacing(80),calc(100vw-var(--np-overlay-gutter)*2))] p-0"
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
 * The phone app bar's scope chip (`ScopeControlView` at `chip` size), kept
 * under the name the app bar and the tests import. Opens the "Working on"
 * sheet (`ClientScopeSheet`).
 */
function ClientScopeChip({
  onOpen,
  className,
  mode = "agency",
  organisationName = null,
}: {
  onOpen: () => void
  className?: string
  mode?: WorkspaceMode
  organisationName?: string | null
}) {
  return (
    <ScopeControlView
      variant="chip"
      mode={mode}
      organisationName={organisationName}
      onOpenSheet={onOpen}
      className={className}
    />
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
  ScopeControlView,
  useOrgWidePage,
  useClientScopeLabel,
  useClientSwitch,
  useScopeLabel,
}
export type { ScopeControl, ScopeLabel, ScopeVariant }
