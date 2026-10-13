"use client"

import { UserIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/** Decorative identity beside the reviewer's accessible name, in both panes. */
function ReviewAvatar({
  name,
  anonymous,
  photoUrl,
}: {
  name: string
  anonymous: boolean
  photoUrl?: string | null
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
      size="lg"
      aria-hidden
      data-reviewer-avatar=""
      data-avatar-tone={anonymous ? "neutral" : String(name.length % 3)}
    >
      {!anonymous && photoUrl ? (
        <AvatarImage src={photoUrl} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback>
        {anonymous ? <UserIcon aria-hidden strokeWidth={1.75} className="size-4" /> : initials}
      </AvatarFallback>
    </Avatar>
  )
}

export { ReviewAvatar }
