"use client"

import { Share2Icon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  setupShareUrl,
  shareLink,
  type ShareOutcome,
} from "@/lib/setup/share-link"

const STATUS: Record<ShareOutcome, string> = {
  shared: "Shared.",
  cancelled: "",
  copied: "Copied. Paste the link to send it.",
  failed: "Couldn’t share or copy. Copy this link:",
}

/**
 * "Share setup link": the setup address (client, step, draft and review
 * included, so the colleague lands on the exact review) through the share
 * sheet on a phone, the clipboard elsewhere, with the outcome in words
 * beside the button.
 *
 * The link is rebuilt from an allow-list (`setupShareUrl`), never the raw
 * address bar, so Google's OAuth return params never leave this browser.
 * When neither share nor copy works, that same allow-listed link is shown to
 * copy by hand, rather than pointing at the address bar.
 */
function ShareSetupLink({
  label = "Share setup link",
  title = "NabaPresence setup",
  text,
}: {
  label?: string
  title?: string
  text?: string
}) {
  const [outcome, setOutcome] = React.useState<ShareOutcome | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [sharedUrl, setSharedUrl] = React.useState("")
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        variant="secondary"
        pending={busy}
        onClick={async () => {
          setBusy(true)
          setOutcome(null)
          const url = setupShareUrl(window.location.href)
          setSharedUrl(url)
          const result = await shareLink({
            url,
            title,
            text,
          })
          setBusy(false)
          setOutcome(result)
        }}
      >
        <Share2Icon aria-hidden />
        {label}
      </Button>
      <span
        role="status"
        className={
          outcome === "failed"
            ? "text-caption text-danger-ink"
            : "text-caption text-ink-muted"
        }
      >
        {outcome ? STATUS[outcome] : ""}
      </span>
      {outcome === "failed" && (
        <span className="w-full text-caption break-all text-ink select-all">
          {sharedUrl}
        </span>
      )}
    </div>
  )
}

export { ShareSetupLink }
