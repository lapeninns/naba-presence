"use client"

import { Button } from "@/components/ui/button"
import { showToast, toast, toastProgress } from "@/components/ui/toast"
import { describeOutcome, outcomeToast } from "@/lib/editors/outcome"

// Toast's manager API (`toast.add`) is imperative, so demonstrating it needs
// a click handler — unlike Dialog/Sheet, whose triggers manage open state
// internally. Isolating that handler in its own "use client" component (
// rather than putting `onClick` directly on /design-system's page.tsx) keeps
// the page itself a server component, matching every other primitive
// specimen on this page. One button per tone; the words are the outcome
// vocabulary's, so the specimen never shows a tone the product would not.
export function ToastDemo() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          showToast({ title: "Review marked done", undo: { onUndo: () => {} } })
        }
      >
        Neutral · Undo
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          showToast({ ...outcomeToast({ outcome: "saved_locally" }) })
        }
      >
        Neutral · saved here
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const publishing = toastProgress("Sending to Google…", {
            kind: "google",
          })
          window.setTimeout(
            () =>
              publishing.success(describeOutcome("confirmed_applied").title, {
                type: "success",
                link: { href: "https://business.google.com/" },
              }),
            1500
          )
        }}
      >
        Success · Google phases
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          showToast({
            kind: "google",
            ...outcomeToast({ outcome: "awaiting_confirmation" }),
          })
        }
      >
        Info
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          toast.add({
            title: "Sync may be stale",
            description: "Reconnect to refresh review data.",
            type: "warning",
          })
        }
      >
        Warning
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          showToast({ kind: "google", ...outcomeToast({ outcome: "failed" }) })
        }
      >
        Error
      </Button>
    </div>
  )
}
