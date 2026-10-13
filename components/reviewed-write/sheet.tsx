"use client"

import type { ReactNode } from "react"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ReviewedWriteSteps, type ReviewedWriteStage } from "./steps"

/**
 * A reviewed write that interrupts an editor (lodging, services, place
 * actions): a bottom sheet on a phone and a side panel from `sm`, with the
 * steps under the title and the actions pinned in the footer, in the thumb
 * zone. The body scrolls; the footer never does.
 *
 * Calm, words-first: the title in `text-title`, the description muted, the
 * steps under them. The body's own sections draw their hairlines.
 */
export function ReviewedWriteSheet({
  open,
  onOpenChange,
  title,
  description,
  stage,
  secondApprover,
  footer,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly stage?: ReviewedWriteStage
  readonly secondApprover?: boolean
  readonly footer: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="wide" className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle className="text-title">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
          {stage ? (
            <ReviewedWriteSteps
              stage={stage}
              secondApprover={secondApprover}
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
