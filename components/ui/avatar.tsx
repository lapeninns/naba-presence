"use client"

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@/lib/utils"

/**
 * Reference `.avatar`: a circle on the hover-fill grey with initials in the
 * strong secondary ink. Sizes 24 / 32 / 44. `shape="square"` is the 8px
 * rounded square used for locations and organisations.
 *
 * Initials read the type roles, so nothing drops below the 12px floor: the
 * 24px avatar takes the caption size with no added tracking (two capitals
 * still fit inside it), the 44px avatar the title size.
 */
const AVATAR_SIZES = {
  sm: "size-6 text-caption tracking-normal",
  default: "size-8 text-caption",
  lg: "size-11 text-title",
} as const

function Avatar({
  className,
  size = "default",
  shape = "circle",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: keyof typeof AVATAR_SIZES
  shape?: "circle" | "square"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-fill font-semibold tracking-[0.02em] text-ink-secondary select-none",
        shape === "square"
          ? "rounded-(--np-radius-control)"
          : "rounded-(--np-radius-pill)",
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
