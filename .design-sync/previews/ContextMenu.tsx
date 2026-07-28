import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "NabaReview"
import {
  CheckCheck,
  CornerUpLeft,
  Flag,
  Link2,
  Star,
  Tag,
  Trash2,
  Users,
} from "lucide-react"

// WHY THE OFFSETS BELOW — do not copy them into product code.
// Base UI anchors a context menu to the pointer: the anchor rect is only set by
// a real `contextmenu` / long-press event. A statically-open menu therefore has
// a 0x0 anchor at the viewport origin and lands in the top-left corner. The
// `sideOffset` / `alignOffset` pair below stands in for the click point so each
// story shows the menu where a right-click on that surface would put it. In the
// product you render `<ContextMenuContent>` with no offsets at all.
//
// `ContextMenuLabel` is Base UI's GroupLabel: it THROWS outside a
// `ContextMenuGroup` (or radio group), which renders the whole story blank.

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

export function ReviewCardMenu() {
  return (
    <ContextMenu defaultOpen>
      <ContextMenuTrigger className="flex w-full max-w-md flex-col gap-2 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Lena Fischer</span>
          <Stars value={2} />
        </div>
        <p className="text-sm text-muted-foreground">
          Room was not ready until 6pm and nobody called ahead. The staff were
          apologetic but the wait ruined our evening.
        </p>
        <span className="font-mono text-xs text-muted-foreground">
          Riverside · 5d ago
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56" sideOffset={168} alignOffset={72}>
        <ContextMenuItem>
          <CornerUpLeft />
          Reply
          <ContextMenuShortcut className="font-mono">⌘R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <CheckCheck />
          Mark handled
        </ContextMenuItem>
        <ContextMenuItem>
          <Flag />
          Escalate
        </ContextMenuItem>
        <ContextMenuItem>
          <Link2 />
          Copy review link
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 />
          Delete reply
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ColumnToggles() {
  return (
    <ContextMenu defaultOpen>
      <ContextMenuTrigger className="flex w-full max-w-md flex-col gap-2 rounded-2xl border border-dashed border-border bg-muted p-4">
        <span className="text-sm font-medium text-foreground">Reply queue header</span>
        <span className="text-sm text-muted-foreground">
          Right-click a column heading to choose what the queue shows. Every
          toggle here is also in the queue’s Columns menu.
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56" sideOffset={196} alignOffset={56}>
        <ContextMenuGroup>
          <ContextMenuLabel>Columns</ContextMenuLabel>
          <ContextMenuCheckboxItem checked>Rating</ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked>Location</ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked>Age</ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem>Reply author</ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem>Photos</ContextMenuCheckboxItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function RoutingSubmenu() {
  return (
    <ContextMenu defaultOpen>
      <ContextMenuTrigger className="flex w-full max-w-md flex-col gap-2 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Tom Okafor</span>
          <Stars value={4} />
        </div>
        <p className="text-sm text-muted-foreground">
          Great location and a genuinely helpful night porter. Breakfast could
          start earlier for early flights.
        </p>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56" sideOffset={152} alignOffset={64}>
        <ContextMenuGroup>
          <ContextMenuItem>
            <CornerUpLeft />
            Reply
          </ContextMenuItem>
          <ContextMenuItem>
            <Tag />
            Add tag
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSub defaultOpen>
          <ContextMenuSubTrigger>
            <Users className="mr-2" />
            Assign to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-48">
            <ContextMenuItem>Priya Sharma</ContextMenuItem>
            <ContextMenuItem>Lena Fischer</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>Duty manager on shift</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 />
          Delete reply
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
