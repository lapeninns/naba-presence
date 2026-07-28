import {
  Badge,
  Button,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Textarea,
} from "NabaReview"
import { Star } from "lucide-react"

// react-resizable-panels v4: the group prop is `orientation` (not `direction`),
// and a NUMERIC `defaultSize` means PIXELS — percentages have to be strings.
// The group is height:100%/width:100% inline, so the shell below owns the size;
// without an explicit height the whole group collapses to nothing.

function Shell({
  children,
  height = "h-72",
}: {
  children: React.ReactNode
  height?: string
}) {
  return (
    <div
      className={`w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card ${height}`}
    >
      {children}
    </div>
  )
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={
            i <= value ? "size-3 fill-rating text-rating" : "size-3 text-muted-foreground/40"
          }
        />
      ))}
    </span>
  )
}

const QUEUE = [
  { name: "Lena Fischer", location: "Central", rating: 2, age: "5d", active: true },
  { name: "Tom Okafor", location: "Riverside", rating: 4, age: "3d" },
  { name: "Priya Sharma", location: "Riverside", rating: 5, age: "2d" },
  { name: "Marco Silva", location: "Airport", rating: 5, age: "1w" },
]

export function QueueAndReplyEditor() {
  return (
    <Shell>
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="38" minSize="25" className="flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Queue
            </span>
            <Badge variant="secondary">4</Badge>
          </div>
          <div className="flex flex-col">
            {QUEUE.map((r) => (
              <div
                key={r.name}
                className={`flex flex-col gap-1 border-b border-border px-3 py-2 ${
                  r.active ? "bg-muted/50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.age}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Stars value={r.rating} />
                  <span className="truncate text-[11px] text-muted-foreground">{r.location}</span>
                </div>
              </div>
            ))}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="62" className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium text-foreground">Lena Fischer</span>
              <div className="flex items-center gap-2">
                <Stars value={2} />
                <span className="text-xs text-muted-foreground">Central &middot; 5 days ago</span>
              </div>
            </div>
            <Badge variant="destructive">Escalated</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            The lift was out both mornings and nobody at the desk could say when it would be
            fixed.
          </p>
          <Textarea
            className="min-h-16"
            defaultValue="Lena — the lift was under an emergency repair that weekend and the service contract has since been re-scoped. Please ask for me by name on your next stay."
          />
          <div className="flex items-center gap-2">
            <Button size="sm">Post reply</Button>
            <Button size="sm" variant="ghost">
              Save draft
            </Button>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Shell>
  )
}

export function DetailOverNotes() {
  return (
    <Shell>
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize="58" className="flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium text-foreground">Tom Okafor</span>
              <div className="flex items-center gap-2">
                <Stars value={4} />
                <span className="text-xs text-muted-foreground">
                  Riverside &middot; 3 days ago
                </span>
              </div>
            </div>
            <Badge variant="secondary">Awaiting reply</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Quiet floor, quick breakfast, and the desk held my bags all afternoon. Only gripe is
            that the room key needed re-cutting twice.
          </p>
          <div className="mt-auto flex items-center gap-4 pt-2 text-xs text-muted-foreground">
            <span>
              Published <span className="font-mono">25 Apr 08:12</span>
            </span>
            <span>
              Review ID <span className="font-mono">rv_8fd21c</span>
            </span>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="42" className="flex flex-col gap-2 p-4">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Internal notes
          </span>
          <p className="text-sm text-muted-foreground">
            Key encoder on floor 2 has failed twice this month &mdash; maintenance ticket
            <span className="font-mono"> MT-4471</span> is open. Mention the fix, not the
            ticket, in the public reply.
          </p>
          <span className="mt-auto text-[11px] text-muted-foreground">
            Added by Lena Fischer &middot; <span className="font-mono">26 Apr</span>
          </span>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Shell>
  )
}

export function ThreeColumnWorkspace() {
  return (
    <Shell height="h-64">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="24" minSize="15" className="flex flex-col p-3">
          <span className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Locations
          </span>
          <div className="flex flex-col gap-1 text-sm">
            <span className="rounded-xl bg-muted px-2 py-1 font-medium text-foreground">
              Central
            </span>
            <span className="px-2 py-1 text-muted-foreground">Riverside</span>
            <span className="px-2 py-1 text-muted-foreground">Airport</span>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize="36" minSize="20" className="flex flex-col p-3">
          <span className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Reviews
          </span>
          <div className="flex flex-col gap-2">
            {QUEUE.slice(0, 3).map((r) => (
              <div key={r.name} className="flex flex-col gap-0.5">
                <span className="truncate text-sm text-foreground">{r.name}</span>
                <Stars value={r.rating} />
              </div>
            ))}
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize="40" className="flex flex-col gap-2 p-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Detail
          </span>
          <span className="text-sm font-medium text-foreground">Lena Fischer</span>
          <Stars value={2} />
          <p className="text-xs text-muted-foreground">
            The lift was out both mornings and nobody at the desk could say when it would be
            fixed.
          </p>
          <span className="mt-auto text-[11px] text-success">Draft ready to post</span>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Shell>
  )
}
