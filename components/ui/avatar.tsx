"use client"

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@/lib/utils"

/**
 * A neutral avatar: a circle on `--np-avatar-bg` (the fill grey) with
 * initials in `--np-avatar-ink` (the secondary ink). Never a status hue:
 * colour on an avatar would read as a state it does not have.
 *
 * Sizes:
 *   sm       24px, for dense tables
 *   default  32px (`md` is the same size, by its design-system name)
 *   list     `--np-avatar-list` (36px touch, 32px desk), the leading
 *            avatar of a `ListRow`; the row is the target, so it may sit
 *            under 44px
 *   lg       44px, the thread and reviewer avatar
 *   xl       64px, the profile header (Settings, account switcher)
 *
 * `shape="square"` is the rounded square used for locations and
 * organisations. `ring` draws a hairline inside the edge, for a logo or a
 * photo on a white ground that would otherwise lose its outline.
 *
 * Initials read the type roles, so nothing drops below the 12px floor: the
 * 24px avatar takes the caption size with no added tracking (two capitals
 * still fit inside it), the 44px avatar the title size.
 */
const AVATAR_SIZES = {
  sm: "size-6 text-caption tracking-normal",
  default: "size-8 text-caption",
  md: "size-8 text-caption",
  list: "size-(--np-avatar-list) text-caption",
  lg: "size-11 text-title",
  xl: "size-16 text-section",
} as const

export type AvatarSize = keyof typeof AVATAR_SIZES

function Avatar({
  className,
  size = "default",
  shape = "circle",
  ring = false,
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: AvatarSize
  shape?: "circle" | "square"
  /** A hairline inside the edge, for logos and light photos. */
  ring?: boolean
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-ring={ring ? "" : undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-avatar-bg font-semibold tracking-[0.02em] text-avatar-ink select-none",
        shape === "square"
          ? "rounded-(--np-radius-control)"
          : "rounded-(--np-radius-pill)",
        // An inset ring sits over the image, so the edge survives a white logo.
        ring &&
          "after:pointer-events-none after:absolute after:inset-0 after:border after:border-line after:content-['']",
        ring &&
          (shape === "square"
            ? "after:rounded-(--np-radius-control)"
            : "after:rounded-(--np-radius-pill)"),
        AVATAR_SIZES[size],
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("size-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center uppercase",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
