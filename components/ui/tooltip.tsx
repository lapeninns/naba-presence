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

/**
 * A tooltip is supplementary: it never opens on touch, and a screen reader
 * may never hear it. The trigger has to carry its own accessible name (its
 * text, `aria-label`, or `aria-labelledby`), and anything a touch user needs
 * to act has to be visible without hovering. In development a trigger with
 * no name of its own is reported.
 */
function TooltipTrigger({ ref, ...props }: TooltipPrimitive.Trigger.Props) {
  const checkName = React.useCallback(
    (node: HTMLButtonElement | null) => {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
      if (process.env.NODE_ENV === "production" || !node) return
      const named =
        node.getAttribute("aria-label") ||
        node.getAttribute("aria-labelledby") ||
        node.textContent?.trim()
      if (!named)
        console.warn(
          "TooltipTrigger has no accessible name of its own; the tooltip is not one.",
          node
        )
    },
    [ref]
  )
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      ref={checkName}
      {...props}
    />
  )
}

type PositionProps = Pick<
  TooltipPrimitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>

/**
 * A small, calm charcoal label (the counter-surface, like toasts): caption
 * text in the on-charcoal ink, control radius, flat (no shadow), on the
 * tooltip layer above every overlay. In the dark theme charcoal is a raised
 * grey above the canvas, with light text. Never
 * the only home of information a touch user needs; a tooltip does not open
 * on touch (see TooltipTrigger).
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
        className="z-tooltip"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "max-w-xs origin-(--transform-origin) rounded-(--np-radius-control) bg-charcoal px-2 py-1 text-caption font-medium text-balance text-ink-on-charcoal outline-none",
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
