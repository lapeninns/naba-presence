"use client"

import { Unplug } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { cn } from "@/lib/utils"

/** Where the saved lodging and service work sits on the profile page. */
export const PROFILE_SAVED_WORK_ID = "profile-saved-work"

/**
 * The profile body when Google can't be reached for this listing.
 *
 * Reading the profile compares NabaPresence's copy with Google's live one,
 * so while the login is broken (or no longer manages the listing) that read
 * cannot finish. The header already says "Unknown — can't reach Google";
 * a spinner and skeletons underneath it looked like a page still loading
 * and explained nothing. This says why, what fixes it, and that saved work
 * is still here.
 */
export function ProfileUnreachable({ summary }: { summary: ListingSummary }) {
  const accessLost =
    summary.freshness?.reason === "listing_access_lost" &&
    !(
      summary.connection &&
      (summary.connection.status !== "active" ||
        summary.connection.reconnectRequired)
    )
  const account = summary.connection?.googleEmail

  return (
    <div
      data-slot="profile-unreachable"
      role="status"
      className="rounded-(--np-radius-card) border border-line bg-surface"
    >
      <Empty
        icon={<Unplug aria-hidden />}
        title="Google can’t be reached for this listing"
        description={
          accessLost
            ? "The Google login works, but it no longer manages this listing, so the business profile can’t be read. Someone at the business has to restore manager access on Google. Nothing here was changed, and saved work below is still available."
            : `The Google login${account ? ` (${account})` : ""} for this listing needs reconnecting, so the business profile can’t be read or compared with Google. Nothing here was changed, and saved work below is still available.`
        }
        action={
          <>
            {accessLost ? null : (
              <Link
                href="/settings/connections"
                className={cn(buttonVariants())}
              >
                Reconnect in Settings
              </Link>
            )}
            <a
              href={`#${PROFILE_SAVED_WORK_ID}`}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              See saved work
            </a>
          </>
        }
      />
    </div>
  )
}
