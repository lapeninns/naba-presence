import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Textarea,
} from "NabaReview"
import { Star } from "lucide-react"

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

/**
 * The composer a manager opens from the review queue. `defaultOpen` keeps the
 * surface visible; in the product the trigger drives it (see TriggerInContext).
 */
export function ReplyComposer() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reply to Lena Fischer</DialogTitle>
          <DialogDescription>
            Replies are public on Google and usually appear under the review within
            a few minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-muted p-3">
            <div className="flex items-center justify-between gap-2">
              <Stars value={1} />
              <span className="font-mono text-xs text-muted-foreground">
                14 May · Riverside
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              Room was not ready until 6pm and nobody called ahead. The late checkout
              we paid for was never applied.
            </p>
          </div>
          <Textarea
            className="min-h-24"
            defaultValue="Lena, I am sorry your room was not ready — that is not the standard we hold at Riverside. I have refunded the late checkout and our duty manager will call you today."
          />
          <p className="text-xs text-muted-foreground">
            Draft saved 2 minutes ago ·{" "}
            <span className="font-mono">188/4096</span> characters
          </p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Post reply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A read-only detail surface. `showCloseButton={false}` drops the corner ✕ and
 * `DialogFooter showCloseButton` supplies the single explicit dismiss instead.
 */
export function ReviewDetail() {
  return (
    <Dialog defaultOpen>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Review from Tom Okafor</DialogTitle>
          <DialogDescription>
            Synced from Google Business Profile. Edits made on Google overwrite this
            record.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Stars value={4} />
            <Badge variant="secondary">Awaiting reply</Badge>
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            Great location for an early flight and the shuttle ran every 20 minutes.
            Breakfast closed at 9 which was tight for us.
          </p>
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Location</dt>
              <dd className="font-medium">Lapen Inn — Airport</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Received</dt>
              <dd className="font-mono">2024-05-12 07:41</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Review ID</dt>
              <dd className="font-mono">GBP-4471-092</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Owner</dt>
              <dd className="font-medium">Unassigned</dd>
            </div>
          </dl>
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The trigger is a Base UI `render` prop — never `asChild`. Shown in the row
 * context it actually ships in, with the dialog closed.
 */
export function TriggerInContext() {
  return (
    <div className="flex max-w-sm items-center justify-between gap-3 rounded-2xl border border-border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">Marco Silva</span>
        <span className="text-xs text-muted-foreground">
          Awaiting reply · Airport · <span className="font-mono">3d</span>
        </span>
      </div>
      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>
          Write reply
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reply to Marco Silva</DialogTitle>
            <DialogDescription>
              Replies are public on Google and cannot be edited after 24 hours.
            </DialogDescription>
          </DialogHeader>
          <Textarea className="min-h-24" placeholder="Write your reply…" />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button>Post reply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
