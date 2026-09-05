"use client"

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@/lib/utils"

/**
 * A circle with a hairline edge. The fallback is initials in UI weight on
 * the fill; the edge is a box-shadow so a white photo on a white card still
 * has a rim and the image itself is never inset.
 */
const AVATAR_SIZES = {
  sm: "size-6 text-caption",
  default: "size-9 text-ui",
  lg: "size-12 text-body",
} as const

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & { size?: keyof typeof AVATAR_SIZES }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-(--np-radius-pill) bg-fill font-medium text-ink hairline select-none",
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
