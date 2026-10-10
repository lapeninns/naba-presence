"use client"

import { CopyIcon, LockIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { listingHref } from "@/lib/listings/areas"
import { GATED_SECTION_TITLE } from "@/lib/locations/gating"
import { cn } from "@/lib/utils"

export type ConsoleKind = "people" | "verification"

const DENIED_COPY: Record<ConsoleKind, { title: string; why: string }> = {
  people: {
    title: "Only owners and admins can see who has access",
    why: "People with access on Google decide who can change or delete the listing, so this page is limited to owners and admins.",
  },
  verification: {
    title: "Only owners and admins can manage verification",
    why: "Verification decides who Google trusts to speak for the business, so starting or completing it is limited to owners and admins.",
  },
}

/**
 * The page a member or viewer sees instead of a console. It never fires the
 * owner/admin-only GET. "Copy an access request" copies a sentence to the
 * clipboard for the person to paste to an owner or admin; nothing is sent.
 */
export function AdministrationDenied({
  kind,
  locationId,
  locationName,
}: {
  kind: ConsoleKind
  locationId: string
  locationName: string
}) {
  const copy = DENIED_COPY[kind]
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle")
  const area = kind === "people" ? "People with access" : "Verification"
  const request = `Hi — could you give me access to ${area}${locationName ? ` for ${locationName}` : ""} in NabaPresence? It’s limited to owners and admins.`

  return (
    <div className="rounded-(--np-radius-card) border border-line bg-surface">
      <Empty
        icon={<LockIcon />}
        titleAs="h2"
        title={copy.title}
        description={`${GATED_SECTION_TITLE}. ${copy.why}`}
        action={
          <>
            <Link
              href={listingHref(locationId)}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Back to listing
            </Link>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(request)
                  setCopied("copied")
                } catch {
                  setCopied("manual")
                }
              }}
            >
              <CopyIcon aria-hidden />
              Copy an access request
            </Button>
          </>
        }
      />
      <p
        role="status"
        className={cn(
          "px-5 text-center text-caption break-words text-ink-muted",
          copied !== "idle" && "-mt-4 pb-8"
        )}
      >
        {copied === "copied"
          ? "Copied. Paste it to an owner or admin — nothing was sent."
          : copied === "manual"
            ? `Copy this and send it to an owner or admin: “${request}”`
            : ""}
      </p>
    </div>
  )
}
