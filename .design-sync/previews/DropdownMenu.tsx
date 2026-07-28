import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "NabaReview"
import {
  ArrowDownUp,
  ChevronDown,
  CornerUpLeft,
  Copy,
  CheckCheck,
  Download,
  Flag,
  Filter,
  Link2,
  Star,
  Trash2,
  Users,
  MoreHorizontal,
} from "lucide-react"

// Base UI, not Radix: the trigger takes `render`, never `asChild`.
// The popup sizes to `--anchor-width`, so an icon trigger needs an explicit
// `min-w-*` on the content or the menu comes out 32px wide.

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={i <= value ? "size-3 fill-rating text-rating" : "size-3 text-muted-foreground/40"}
        />
      ))}
    </span>
  )
}

export function RowActions() {
  return (
    <div className="flex w-full max-w-md items-start justify-between gap-3 rounded-2xl border border-border bg-card p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Priya Sharma</span>
          <Stars value={5} />
        </div>
        <p className="text-sm text-muted-foreground">
          Lapen Inn — Central · <span className="font-mono text-xs">2d</span>
        </p>
      </div>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Review actions">
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem>
            <CornerUpLeft />
            Reply
            <DropdownMenuShortcut className="font-mono">⌘R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CheckCheck />
            Mark handled
            <DropdownMenuShortcut className="font-mono">⌘H</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Flag />
            Escalate
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Link2 />
            Copy review link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2 />
            Delete reply
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function GroupedSections() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <span className="text-sm text-muted-foreground">
        4 reviews selected in the Riverside queue.
      </span>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className="w-fit min-w-56">
              Bulk actions
              <ChevronDown data-icon="inline-end" />
            </Button>
          }
        />
        {/*
          The popup is `max-h-(--available-height)` + `overflow-y-auto`, and this
          component cards at 520x300. Rows past ~200px of menu are scroll-clipped
          with no visible affordance, so keep this menu to two short groups.
        */}
        <DropdownMenuContent>
          {/* GroupLabel throws outside a Group — it must be a Group child. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>4 selected</DropdownMenuLabel>
            <DropdownMenuItem>
              <CornerUpLeft />
              Reply with template
            </DropdownMenuItem>
            <DropdownMenuItem>
              <CheckCheck />
              Mark handled
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Export</DropdownMenuLabel>
            <DropdownMenuItem>
              <Download />
              Download CSV
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Copy />
              Copy review links
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function FilterToggles() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <span className="text-sm text-muted-foreground">
        Checkbox items keep the menu open while the queue narrows.
      </span>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className="w-fit min-w-56">
              <Filter data-icon="inline-start" />
              Filters · 2
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Show reviews</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked>Awaiting reply</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked>Rated 1–2 stars</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem>With photos</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem>Already replied</DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function SortOrder() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <span className="text-sm text-muted-foreground">
        A radio group marks the single active sort.
      </span>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className="w-fit min-w-56">
              <ArrowDownUp data-icon="inline-start" />
              Newest first
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="newest">
            <DropdownMenuLabel>Sort queue by</DropdownMenuLabel>
            <DropdownMenuRadioItem value="newest">Newest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="oldest">Oldest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="lowest">Lowest rating</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="highest">Highest rating</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function NestedSubmenu() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <span className="text-sm text-muted-foreground">
        Routing lives one level down so the top menu stays short.
      </span>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className="w-fit min-w-56">
              Review actions
              <ChevronDown data-icon="inline-end" />
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuItem>
            <CornerUpLeft />
            Reply
          </DropdownMenuItem>
          <DropdownMenuSub defaultOpen>
            <DropdownMenuSubTrigger>
              <Users />
              Assign to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-48">
              <DropdownMenuItem>Priya Sharma</DropdownMenuItem>
              <DropdownMenuItem>Tom Okafor</DropdownMenuItem>
              <DropdownMenuItem>Lena Fischer</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Duty manager on shift</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2 />
            Delete reply
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
