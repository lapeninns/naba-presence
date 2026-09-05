"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * Wrap a region (or the app) once. Tooltips inside share one short delay,
 * and once one is showing its neighbours open instantly, the way the
 * platform's toolbar tips do.
 */
function TooltipProvider({
  delay = 300,
  closeDelay = 100,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} {...props} />
  )
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

type PositionProps = Pick<
  TooltipPrimitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>

/**
 * A small dark pill. Caption is the floor (12px), never smaller; the fade
 * is quick and springs from the anchor side.
 */
function TooltipContent({
  className,
  children,
  side = "top",
  align = "center",
  sideOffset = 6,
  alignOffset,
  ...props
}: TooltipPrimitive.Popup.Props & PositionProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "max-w-xs origin-(--transform-origin) rounded-(--np-radius-pill) bg-ink px-2.5 py-1 text-caption font-medium text-ink-inverse shadow-(--np-shadow-raised) outline-none text-balance",
            "transition-[opacity,scale] duration-(--np-duration-fast) ease-spring data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-instant:duration-0",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent }
