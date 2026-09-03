import { Check } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

export type Step = {
  id: string
  label: string
  state: "done" | "current" | "todo"
  /** One short line: who, when, or why this step is where it is. */
  meta?: string
}

/**
 * Progress through an ordered flow: the setup wizard, and the reply lifecycle
 * in the review pane.
 *
 * `ol` with `aria-current="step"` on the active item, which is the whole
 * accessible contract — the connecting lines and the tick are decorative, and
 * every state is also stated in the label or its meta line rather than being
 * carried by colour.
 */
function Stepper({
  steps,
  orientation = "horizontal",
  className,
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & {
  steps: Step[]
  orientation?: "horizontal" | "vertical"
}) {
  return (
    <ol
      data-slot="stepper"
      data-orientation={orientation}
      className={cn(
        orientation === "horizontal"
          ? "flex items-start gap-0 overflow-x-auto"
          : "flex flex-col gap-0.5",
        className
      )}
      {...props}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        return (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              orientation === "horizontal"
                ? "flex min-w-0 flex-1 flex-col gap-1.5"
                : "flex items-center gap-2.5 rounded-(--np-radius-control) px-2.5 py-1.5",
              orientation === "vertical" &&
                step.state === "current" &&
                "border border-line bg-surface"
            )}
          >
            <div
              className={cn(
                "flex items-center",
                orientation === "vertical" && "shrink-0"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
                  step.state === "done" && "bg-primary text-primary-foreground",
                  step.state === "current" &&
                    "border-2 border-[var(--np-accent)] bg-accent-tint text-accent-ink",
                  step.state === "todo" &&
                    "border border-[var(--np-line-strong)] text-ink-faint"
                )}
              >
                {step.state === "done" ? <Check className="size-3" /> : index + 1}
              </span>
              {orientation === "horizontal" && !isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-1.5 h-0.5 flex-1",
                    step.state === "done" ? "bg-[var(--np-accent)]" : "bg-line"
                  )}
                />
              ) : null}
            </div>
            <div className={cn("min-w-0", orientation === "vertical" && "flex-1")}>
              <p
                className={cn(
                  "truncate text-caption font-medium",
                  step.state === "todo" ? "text-ink-faint" : "text-ink"
                )}
              >
                {step.label}
              </p>
              {step.meta ? (
                <p className="truncate text-caption text-ink-muted">{step.meta}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export { Stepper }
