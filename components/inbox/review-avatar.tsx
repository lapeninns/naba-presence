"use client"

import { UserIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/**
 * Decorative identity beside the reviewer's accessible name, in both panes.
 *
 * Neutral on purpose: the Avatar primitive's `--np-avatar-bg` circle with
 * `--np-avatar-ink` initials. Tinting it by a hash of the name put the
 * info, success and warning hues on rows where those colours mean a status
 * (design rule D3), so a reviewer could read as "failed" or "done".
 *
 * `size` is the primitive's: the list uses `default` (32px), the thread
 * keeps `lg` (44px).
 */
function ReviewAvatar({
  name,
  anonymous,
  photoUrl,
  size = "lg",
  className,
}: {
  name: string
  anonymous: boolean
  photoUrl?: string | null
  size?: "sm" | "default" | "lg"
  className?: string
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase()

  return (
    <Avatar
      size={size}
      aria-hidden
      data-reviewer-avatar=""
      className={cn("tracking-normal", className)}
    >
      {!anonymous && photoUrl ? (
        <AvatarImage src={photoUrl} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback>
        {anonymous ? (
          <UserIcon aria-hidden strokeWidth={1.75} className="size-4" />
        ) : (
          initials
        )}
      </AvatarFallback>
    </Avatar>
  )
}

export { ReviewAvatar }
