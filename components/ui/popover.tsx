"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import {
  MenuCloseProvider,
  MenuSheetCancel,
  MenuSheetTitle,
  menuSheetPopupClassName,
  menuSheetPositionerClassName,
  menuSheetScrimClassName,
  useMenuActions,
  useMenuSheet,
} from "@/components/ui/menu-surface"
import { cn } from "@/lib/utils"

/**
 * A panel anchored to its trigger on the desk; on a phone the same content
 * rises as a bottom sheet with a Close under it (see menu-surface), since
 * a 360px panel beside a 44px trigger leaves a phone nowhere to put it.
 */
function Popover({ actionsRef, ...props }: PopoverPrimitive.Root.Props) {
  const { actions, close } = useMenuActions(actionsRef)
  return (
    <MenuCloseProvider close={close}>
      <PopoverPrimitive.Root
        data-slot="popover"
        actionsRef={actions}
        {...props}
      />
    </MenuCloseProvider>
  )
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
        <path d="M0 10 L10 0 L20 10 Z" className="fill-surface" />
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
  showArrow = false,
  title,
  ...props
}: PopoverPrimitive.Popup.Props &
  PositionProps & {
    /** Draw an arrow pointing at the anchor. Off by default (reference `.popover` has none). */
    showArrow?: boolean
    /** A heading for the phone's sheet. */
    title?: React.ReactNode
  }) {
  const sheet = useMenuSheet()
  if (sheet) {
    // The content keeps its own layout (a search field and list, a short
    // form); the sheet adds the scrim, the bottom edge and a way out. The
    // caller's className reaches the scrolling body, where its padding
    // means what it meant in the panel; its desk width does not apply.
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Backdrop className={menuSheetScrimClassName} />
        <PopoverPrimitive.Positioner className={menuSheetPositionerClassName}>
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            data-presentation="sheet"
            className={menuSheetPopupClassName}
            {...props}
          >
            {title ? <MenuSheetTitle>{title}</MenuSheetTitle> : null}
            <div
              data-slot="popover-sheet-body"
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4 text-ui text-ink",
                className,
                "w-full! max-w-none! min-w-0!"
              )}
            >
              {children}
            </div>
            <MenuSheetCancel label="Close" />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    )
  }
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-popover outline-none"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          data-presentation="popover"
          className={cn(
            // Reference `.popover`: surface, hairline edge, card radius, pop
            // shadow, 16px inside, min(360px, 100vw - 24px) wide.
            "w-[min(360px,calc(100vw-24px))] origin-(--transform-origin) rounded-(--np-radius-card) border border-line bg-surface p-4 text-ui text-ink shadow-np-pop outline-none",
            "transition-[opacity,scale] duration-(--np-duration-overlay) ease-spring data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard",
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
      className={cn("mt-1 text-ui text-ink-muted", className)}
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
