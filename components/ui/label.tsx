"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A form label. Beside a disabled control (a `peer` input, or inside a
 * `group` marked `data-disabled="true"`) it turns to the disabled ink, which
 * still reads at 4.5:1, instead of fading to an unreadable 50% opacity.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-ui leading-none font-medium text-ink select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-disabled-ink peer-disabled:cursor-not-allowed peer-disabled:text-disabled-ink",
        className
      )}
      {...props}
    />
  )
}

export { Label }
