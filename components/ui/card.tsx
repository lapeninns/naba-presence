import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A card in the grouped-background model: white on the soft grey canvas, with
 * no border and no shadow. The surface itself is the boundary.
 *
 * `inset` turns the card into an iOS inset-group container whose direct
 * children are rows: the vertical padding and the gap collapse to zero and
 * the rows are divided by hairlines. Prefer `GroupedList` for settings-style
 * rows; `inset` exists for a card that mixes a header with a list body.
 */
function Card({
  className,
  size = "default",
  inset = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  inset?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-inset={inset || undefined}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-(--np-radius-card) bg-surface py-(--card-spacing) text-body text-ink [--card-spacing:var(--np-card-pad)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[inset]:gap-0 data-[inset]:divide-y data-[inset]:divide-line-subtle data-[inset]:py-0 *:[img:first-child]:rounded-t-(--np-radius-card) *:[img:last-child]:rounded-b-(--np-radius-card)",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 px-(--card-spacing) group-data-[inset]/card:py-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:border-line-subtle [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({
  as: Heading = "h3",
  className,
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" | "h4" }) {
  return (
    <Heading
      data-slot="card-title"
      className={cn("text-title font-semibold text-ink", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-ui text-ink-muted", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center px-(--card-spacing) group-data-[inset]/card:py-(--card-spacing) [.border-t]:border-line-subtle [.border-t]:pt-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
