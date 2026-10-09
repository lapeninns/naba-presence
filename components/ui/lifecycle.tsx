import * as React from "react"

import { cn } from "@/lib/utils"

export type LifecycleState = "done" | "current" | "todo" | "failed" | "skipped"

export type LifecycleStage = {
  id: string
  /** The stage in words: "Received", "Drafted", "Published". */
  label: string
  state: LifecycleState
  /** One short line: who, when, or why ("2 checks failed"). */
  meta?: React.ReactNode
}

const STATE_WORD: Record<LifecycleState, string> = {
  done: "done",
  current: "current step",
  todo: "not started",
  failed: "failed",
  skipped: "skipped",
}

/**
 * A record's stages in order (reference `.lifecycle`): a horizontal track of
 * up to five stages with a 12px node each — done is a filled ok node with an
 * ok rule after it, current an accent ring with a halo, failed a filled
 * danger node, skipped a dashed ring, to-do an empty ring. When its OWN
 * container is narrower than 520px it turns vertical, with the rule running
 * down the left.
 *
 * Each stage's state is also spoken ("Verified, failed") by a visually
 * hidden word, so the node colour is never the only signal. Pass `aria-label`
 * to name the list ("Reply lifecycle").
 */
function Lifecycle({
  stages,
  className,
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & {
  stages: LifecycleStage[]
}) {
  return (
    <div className="@container/lifecycle min-w-0">
      <ol
        data-slot="lifecycle"
        className={cn(
          "grid list-none [grid-template-columns:repeat(var(--lc-n),minmax(0,1fr))] gap-0 @max-[520px]/lifecycle:grid-cols-1 @max-[520px]/lifecycle:gap-2.5",
          className
        )}
        style={{ "--lc-n": stages.length } as React.CSSProperties}
        {...props}
      >
        {stages.map((stage, index) => {
          const isLast = index === stages.length - 1
          return (
            <li
              key={stage.id}
              data-state={stage.state}
              aria-current={stage.state === "current" ? "step" : undefined}
              className="relative flex min-w-0 flex-col gap-0.5 pt-[18px] pr-2 @max-[520px]/lifecycle:pt-0 @max-[520px]/lifecycle:pr-0 @max-[520px]/lifecycle:pl-[22px]"
            >
              {/* The rule to the next stage. */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-[5px] right-0 left-0 h-0.5 @max-[520px]/lifecycle:top-[14px] @max-[520px]/lifecycle:right-auto @max-[520px]/lifecycle:-bottom-3 @max-[520px]/lifecycle:left-[5px] @max-[520px]/lifecycle:h-auto @max-[520px]/lifecycle:w-0.5",
                  stage.state === "done" ? "bg-success-solid" : "bg-line",
                  isLast && "@max-[520px]/lifecycle:hidden"
                )}
              />
              {/* The node. */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 left-0 size-3 rounded-full border-2 bg-surface",
                  stage.state === "done" &&
                    "border-success-solid bg-success-solid",
                  stage.state === "current" &&
                    "border-primary shadow-[0_0_0_3px_var(--np-accent-tint)]",
                  stage.state === "failed" &&
                    "border-danger-solid bg-danger-solid",
                  stage.state === "skipped" &&
                    "border-dashed border-line-strong",
                  stage.state === "todo" && "border-line-strong"
                )}
              />
              <span
                className={cn(
                  "text-[12.5px] leading-4 font-semibold text-ink",
                  (stage.state === "todo" || stage.state === "skipped") &&
                    "font-medium text-ink-muted"
                )}
              >
                {stage.label}
                <span className="sr-only">, {STATE_WORD[stage.state]}</span>
              </span>
              {stage.meta ? (
                <span className="truncate text-[11.5px] leading-[15px] text-ink-muted @max-[520px]/lifecycle:whitespace-normal">
                  {stage.meta}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export { Lifecycle }
