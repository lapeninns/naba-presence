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
          : "flex flex-col gap-(--np-list-gap)",
        className
      )}
      {...props}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        return (
          <li
            key={step.id}
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              orientation === "horizontal"
                ? "flex min-w-0 flex-1 flex-col gap-2"
                : "flex items-center gap-3 rounded-(--np-radius-control) px-2.5 py-1.5",
              orientation === "vertical" &&
                step.state === "current" &&
                "bg-accent-tint"
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
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums transition-colors duration-(--np-duration-fast) ease-spring-snappy",
                  step.state === "done" && "bg-accent-tint text-accent-ink",
                  step.state === "current" && "bg-primary text-primary-foreground",
                  step.state === "todo" && "bg-fill text-ink-muted"
                )}
              >
                {step.state === "done" ? (
                  <Check className="size-3.5" strokeWidth={2} />
                ) : (
                  index + 1
                )}
              </span>
              {orientation === "horizontal" && !isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 h-px flex-1",
                    step.state === "done"
                      ? "bg-(--np-accent-vivid)"
                      : "bg-line-subtle"
                  )}
                />
              ) : null}
            </div>
            <div className={cn("min-w-0", orientation === "vertical" && "flex-1")}>
              <p
                className={cn(
                  "truncate text-ui font-medium",
                  step.state === "todo" ? "text-ink-muted" : "text-ink"
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
