"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

// Toast's manager API (`toast.add`) is imperative, so demonstrating it needs
// a click handler — unlike Dialog/Sheet, whose triggers manage open state
// internally. Isolating that handler in its own "use client" component (
// rather than putting `onClick` directly on /design-system's page.tsx) keeps
// the page itself a server component, matching every other primitive
// specimen on this page.
export function ToastDemo() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          toast.add({
            title: "Reply published",
            description: "Your response is now live on Google.",
            type: "success",
          })
        }
      >
        Success
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
          toast.add({
            title: "Draft saved",
            description: "Publishing resumes when you're ready.",
            type: "info",
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
            title: "Publish failed",
            description: "Check the connection and try again.",
            type: "error",
          })
        }
      >
        Error
      </Button>
    </div>
  )
}
