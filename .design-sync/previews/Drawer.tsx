import {
  Badge,
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Separator,
  Textarea,
} from "NabaReview"
import { CornerDownRight, Send, Star, TriangleAlert, UserPlus } from "lucide-react"

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
 * The mobile counterpart to the reply Dialog. `showSwipeHandle` adds the grab
 * bar that tells a touch user the sheet is dismissible by dragging down.
 */
export function MobileReplyComposer() {
  return (
    <Drawer defaultOpen showSwipeHandle>
      <div className="flex max-w-sm flex-col gap-3 rounded-2xl border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Priya Sharma</span>
          <Badge variant="secondary">Replied</Badge>
        </div>
        <Stars value={5} />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Stayed two nights and the front desk could not have been kinder. The room
          was spotless and breakfast was genuinely good.
        </p>
        <DrawerTrigger render={<Button variant="outline" />}>
          <Send />
          Reply
        </DrawerTrigger>
      </div>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Reply to Priya Sharma</DrawerTitle>
          <DrawerDescription>
            Lapen Inn — Central · public on Google
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <Stars value={5} />
            <span className="font-mono text-xs text-muted-foreground">2d ago</span>
          </div>
          <Textarea
            className="min-h-24"
            defaultValue="Thank you Priya — I have passed this to Amara and the breakfast team. We would love to see you back at Central."
          />
        </div>
        <DrawerFooter>
          <Button>Post reply</Button>
          <DrawerClose render={<Button variant="ghost" />}>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

const ACTIONS = [
  {
    icon: TriangleAlert,
    title: "Escalate to duty manager",
    hint: "Pages the Riverside on-call rota",
    danger: true,
  },
  {
    icon: UserPlus,
    title: "Assign to me",
    hint: "Moves it out of the shared queue",
    danger: false,
  },
  {
    icon: CornerDownRight,
    title: "Draft a reply",
    hint: "Opens the composer with the 2-star template",
    danger: false,
  },
]

/**
 * A short action list. The drawer sizes to its content, so a three-item triage
 * sheet stays at the bottom of the screen instead of stretching to fill it.
 */
export function EscalationTriage() {
  return (
    <Drawer defaultOpen>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Escalated review</DrawerTitle>
          <DrawerDescription>
            Lena Fischer · Riverside · unanswered for{" "}
            <span className="font-mono">5d</span>
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-1 p-4">
          <Separator />
          {ACTIONS.map((a) => (
            <Button
              key={a.title}
              variant="ghost"
              className="h-auto w-full justify-start gap-3 rounded-2xl p-3 text-left font-normal"
            >
              <a.icon
                className={a.danger ? "text-destructive" : "text-muted-foreground"}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">{a.title}</span>
                <span className="text-xs text-muted-foreground">{a.hint}</span>
              </span>
            </Button>
          ))}
        </div>
        <DrawerFooter>
          <DrawerClose render={<Button variant="outline" />}>Close</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/**
 * `swipeDirection="right"` swings the drawer onto the right edge and switches
 * it to the horizontal axis — a full-height panel dismissed by swiping right.
 */
export function SideDrawer() {
  return (
    <Drawer defaultOpen swipeDirection="right" showSwipeHandle>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Tom Okafor</DrawerTitle>
          <DrawerDescription>
            Lapen Inn — Airport · <span className="font-mono">2024-05-12</span>
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <Stars value={4} />
            <Badge variant="secondary">Awaiting reply</Badge>
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            Great location for an early flight and the shuttle ran every 20 minutes.
            Breakfast closed at 9 which was tight for us.
          </p>
          <Separator />
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Review ID</dt>
              <dd className="font-mono">GBP-4471-092</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Waiting</dt>
              <dd className="font-mono text-destructive">3d 04h</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="font-medium">Unassigned</dd>
            </div>
          </dl>
          <Separator />
          <div className="flex flex-col gap-2 rounded-2xl bg-muted p-3">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Internal note
            </span>
            <p className="text-sm leading-relaxed text-foreground">
              Breakfast now closes at 10:00 from 1 June — worth mentioning in the
              reply.
            </p>
            <span className="font-mono text-xs text-muted-foreground">
              Amara O. · 2024-05-13
            </span>
          </div>
        </div>
        <DrawerFooter>
          <Button>Write reply</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
