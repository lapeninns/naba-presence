"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/**
 * The arrow is an SVG rather than a rotated box so only its two outer edges
 * carry the hairline; the fill reads the popover material token, which
 * swaps to its opaque twin under reduced transparency exactly as the panel
 * does. Base UI places it and stamps `data-side`; the offsets below tuck the
 * inner edge under the panel by a pixel.
 */
function PopoverArrow({ className, ...props }: PopoverPrimitive.Arrow.Props) {
  return (
    <PopoverPrimitive.Arrow
      data-slot="popover-arrow"
      className={cn(
        "data-[side=bottom]:top-[-9px] data-[side=left]:right-[-14px] data-[side=left]:rotate-90 data-[side=right]:left-[-14px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-9px] data-[side=top]:rotate-180",
        className
      )}
      {...props}
    >
      <svg
        width="20"
        height="10"
        viewBox="0 0 20 10"
        fill="none"
        aria-hidden="true"
        className="block"
      >
        <path d="M0 10 L10 0 L20 10 Z" className="fill-(--np-material-popover)" />
        <path
          d="M0 10 L10 0 L20 10"
          className="stroke-line"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </PopoverPrimitive.Arrow>
  )
}

type PositionProps = Pick<
  PopoverPrimitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
>

function PopoverContent({
  className,
  children,
  side = "bottom",
  align = "center",
  sideOffset = 8,
  alignOffset,
  anchor,
  showArrow = true,
  ...props
}: PopoverPrimitive.Popup.Props &
  PositionProps & {
    /** Draw the arrow pointing at the anchor. Off for menus-in-disguise. */
    showArrow?: boolean
  }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 outline-none"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "material-popover w-72 origin-(--transform-origin) rounded-(--np-radius-card) p-4 text-body text-ink shadow-(--np-shadow-pop) outline-none",
            "transition-[opacity,scale] duration-(--np-duration-overlay) ease-spring data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard",
            className
          )}
          {...props}
        >
          {showArrow ? <PopoverArrow /> : null}
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-title font-semibold text-ink", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("mt-1 text-body text-ink-muted", className)}
      {...props}
    />
  )
}

function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
}
