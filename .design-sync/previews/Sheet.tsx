import {
  Badge,
  Button,
  Checkbox,
  Label,
  Separator,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "NabaReview"
import { ListFilter, Star } from "lucide-react"

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={i <= value ? "size-4 fill-rating text-rating" : "size-4 text-muted-foreground/40"}
        />
      ))}
    </span>
  )
}

const RATINGS = [
  { stars: 5, count: 61, on: false },
  { stars: 4, count: 28, on: false },
  { stars: 3, count: 14, on: true },
  { stars: 2, count: 17, on: true },
  { stars: 1, count: 8, on: true },
]

const QUEUE = [
  { name: "Priya Sharma", location: "Central", rating: 5, status: "Replied" },
  { name: "Tom Okafor", location: "Airport", rating: 4, status: "Awaiting reply" },
  { name: "Lena Fischer", location: "Riverside", rating: 2, status: "Escalated" },
  { name: "Marco Silva", location: "Airport", rating: 5, status: "Replied" },
]

/**
 * The canonical Sheet: a right-side panel of filters that keeps the review
 * queue behind it. Header and footer are fixed; only the middle column scrolls,
 * and the backdrop blurs the page rather than replacing it.
 */
export function ReviewFilters() {
  return (
    <Sheet defaultOpen>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-medium">Review queue</span>
          <SheetTrigger render={<Button variant="outline" />}>
            <ListFilter />
            Filters
          </SheetTrigger>
        </div>
        <div className="flex flex-col border-t border-border">
          {QUEUE.map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between gap-4 border-b border-border py-3"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.location}</span>
              </span>
              <Stars value={r.rating} />
              <span className="w-28 text-right text-xs text-muted-foreground">
                {r.status}
              </span>
            </div>
          ))}
        </div>
      </div>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Filter reviews</SheetTitle>
          <SheetDescription>
            Narrows the queue only — scheduled replies are unaffected.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Rating
            </span>
            {RATINGS.map((r) => (
              <Label key={r.stars} className="justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Checkbox defaultChecked={r.on} />
                  <Stars value={r.stars} />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {r.count}
                </span>
              </Label>
            ))}
          </div>
          <Separator />
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Status
            </span>
            <Label className="gap-2">
              <Checkbox defaultChecked />
              Awaiting reply
            </Label>
            <Label className="gap-2">
              <Checkbox defaultChecked />
              Escalated
            </Label>
            <Label className="gap-2">
              <Checkbox />
              Replied
            </Label>
          </div>
          <Separator />
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Location
            </span>
            <Label className="gap-2">
              <Checkbox defaultChecked />
              Central
            </Label>
            <Label className="gap-2">
              <Checkbox defaultChecked />
              Riverside
            </Label>
            <Label className="gap-2">
              <Checkbox />
              Airport
            </Label>
          </div>
        </div>
        <SheetFooter>
          <Button>Show 39 reviews</Button>
          <SheetClose render={<Button variant="ghost" />}>Reset filters</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * A detail pane: the same right-side surface used to read one review and its
 * published reply without leaving the queue.
 */
export function ReviewDetailPane() {
  return (
    <Sheet defaultOpen>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Priya Sharma</SheetTitle>
          <SheetDescription>
            Lapen Inn — Central · <span className="font-mono">2024-05-13</span>
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
          <div className="flex items-center justify-between gap-2">
            <Stars value={5} />
            <Badge variant="secondary">Replied</Badge>
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            Stayed two nights and the front desk could not have been kinder. The room
            was spotless and breakfast was genuinely good.
          </p>
          <Separator />
          <div className="flex flex-col gap-2 rounded-2xl bg-muted p-3">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Your reply
            </span>
            <p className="text-sm leading-relaxed text-foreground">
              Thank you Priya — I have passed this to Amara and the breakfast team.
              We would love to see you back at Central.
            </p>
            <span className="font-mono text-xs text-muted-foreground">
              Posted 2024-05-13 16:02
            </span>
          </div>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Review ID</dt>
              <dd className="font-mono">GBP-4471-088</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Time to reply</dt>
              <dd className="font-mono text-success">3h 12m</dd>
            </div>
          </dl>
        </div>
        <SheetFooter>
          <Button variant="outline">Edit reply</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * `side="bottom"` gives an auto-height bar — the right shape for actions on a
 * multi-select, where a full-height panel would be far too much surface.
 */
export function BulkActionsBottom() {
  return (
    <Sheet defaultOpen>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>7 reviews selected</SheetTitle>
          <SheetDescription>
            Across Central and Riverside · 5 awaiting reply, 2 escalated.
          </SheetDescription>
        </SheetHeader>
        <SheetFooter className="flex-row justify-end">
          <SheetClose render={<Button variant="ghost" />}>Clear selection</SheetClose>
          <Button variant="outline">Assign to me</Button>
          <Button>Draft 7 replies</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
