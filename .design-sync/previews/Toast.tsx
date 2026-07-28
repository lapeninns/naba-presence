import * as React from "react"
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  useToastManager,
} from "NabaReview"
import { CircleCheckIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"

// A toast is normally transient. To get a resting state a static capture can
// see, each cell mounts its OWN manager, seeds it once on mount, and sets
// `timeout={0}` so nothing auto-dismisses.
//
// ToastPortal is deliberately NOT used: it would send the viewport to
// document.body, which is outside the card. Without it the viewport's `fixed`
// positioning resolves against the card's own transformed box, so the toast
// rests in the bottom-right corner of the cell like it would in the app.

type Seed = {
  title: string
  description: string
  type?: "success" | "error" | "warning" | "info"
  actionProps?: { children: React.ReactNode }
}

function ToastIcon({ type }: { type: string | undefined }) {
  if (type === "success") {
    return <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
  }
  if (type === "error") {
    return <OctagonXIcon aria-hidden className="size-4 shrink-0 text-destructive" />
  }
  if (type === "warning") {
    return <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-warning" />
  }
  return null
}

function ToastList({ seeds }: { seeds: Seed[] }) {
  const { toasts, add } = useToastManager()
  const seeded = React.useRef(false)

  React.useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    for (const seed of seeds) {
      add({ ...seed, timeout: 0 })
    }
  }, [add, seeds])

  return (
    <>
      {toasts.map((item) => (
        <Toast key={item.id} toast={item}>
          <ToastContent>
            <ToastIcon type={item.type} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <ToastTitle />
              <ToastDescription />
            </div>
            <ToastAction />
            <ToastClose />
          </ToastContent>
        </Toast>
      ))}
    </>
  )
}

function Stage({ seeds, children }: { seeds: Seed[]; children?: React.ReactNode }) {
  const [manager] = React.useState(() => createToastManager())
  return (
    <ToastProvider toastManager={manager} timeout={0} limit={4}>
      <div className="flex h-56 w-full flex-col gap-1 rounded-2xl bg-muted p-4">
        {children}
      </div>
      <ToastViewport>
        <ToastList seeds={seeds} />
      </ToastViewport>
    </ToastProvider>
  )
}

const REPLY_POSTED: Seed[] = [
  {
    type: "success",
    title: "Reply posted to Google",
    description: "Priya Sharma · Lapen Inn — Central",
  },
]

export function ReplyPosted() {
  return (
    <Stage seeds={REPLY_POSTED}>
      <span className="text-sm font-medium text-foreground">Review queue</span>
      <span className="text-xs text-muted-foreground">
        Confirmation after a reply is pushed to the Business Profile.
      </span>
    </Stage>
  )
}

const SYNC_FAILED: Seed[] = [
  {
    type: "error",
    title: "Sync failed — Riverside",
    description: "The Business Profile token expired 2 days ago.",
    actionProps: { children: "Reconnect" },
  },
]

export function SyncFailedWithAction() {
  return (
    <Stage seeds={SYNC_FAILED}>
      <span className="text-sm font-medium text-foreground">Locations</span>
      <span className="text-xs text-muted-foreground">
        A recoverable failure pairs the message with one action.
      </span>
    </Stage>
  )
}

const ESCALATION: Seed[] = [
  {
    type: "warning",
    title: "2 reviews escalated",
    description: "Unanswered for 48 hours at Lapen Inn — Airport.",
    actionProps: { children: "Review" },
  },
]

export function EscalationWarning() {
  return (
    <Stage seeds={ESCALATION}>
      <span className="text-sm font-medium text-foreground">Escalations</span>
      <span className="text-xs text-muted-foreground">
        Warning tone for something that needs attention but has not failed.
      </span>
    </Stage>
  )
}

const QUEUE: Seed[] = [
  {
    type: "success",
    title: "Reply posted to Google",
    description: "Marco Silva · Lapen Inn — Airport",
  },
  {
    type: "success",
    title: "Reply posted to Google",
    description: "Tom Okafor · Lapen Inn — Riverside",
  },
  {
    type: "warning",
    title: "Draft saved",
    description: "Lena Fischer · Lapen Inn — Central",
  },
]

export function StackedQueue() {
  return (
    <Stage seeds={QUEUE}>
      <span className="text-sm font-medium text-foreground">Bulk reply run</span>
      <span className="text-xs text-muted-foreground">
        Three toasts collapse into a stack; the newest stays legible.
      </span>
    </Stage>
  )
}
