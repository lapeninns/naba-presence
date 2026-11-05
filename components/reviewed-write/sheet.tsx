"use client"

import type { ComponentProps, ReactNode } from "react"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ReviewedWriteSteps,
  type ReviewedWriteStage,
  type ReviewedWriteStepsOptions,
} from "./steps"

/**
 * A reviewed write that interrupts an editor (lodging, services, place
 * actions): a bottom sheet on a phone and a side panel from `sm`, with the
 * steps under the title and the actions pinned in the footer, in the thumb
 * zone. The body scrolls; the footer never does.
 *
 * Calm, words-first: the title in `text-title`, the description muted, the
 * steps under them. The body's own sections draw their hairlines.
 *
 * A sheet opened from state has no trigger for the dialog to hand focus back
 * to, so it can fall to the page on close; pass `finalFocus` (usually from
 * `useOpenerFocus`) to say where it goes.
 */
export function ReviewedWriteSheet({
  open,
  onOpenChange,
  title,
  description,
  stage,
  secondApprover,
  sending,
  outcome,
  footer,
  finalFocus,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly stage?: ReviewedWriteStage
  readonly secondApprover?: boolean
  readonly sending?: ReviewedWriteStepsOptions["sending"]
  readonly outcome?: ReviewedWriteStepsOptions["outcome"]
  readonly footer: ReactNode
  /** Where focus goes once the sheet has closed (Base UI `finalFocus`). */
  readonly finalFocus?: ComponentProps<typeof SheetContent>["finalFocus"]
  readonly children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="wide"
        className="flex flex-col gap-0"
        finalFocus={finalFocus}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
          {stage ? (
            <ReviewedWriteSteps
              stage={stage}
              secondApprover={secondApprover}
              sending={sending}
              outcome={outcome}
              className="mt-2"
            />
          ) : null}
        </SheetHeader>
        <SheetBody>{children}</SheetBody>
        <SheetFooter className="sm:items-center">{footer}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
