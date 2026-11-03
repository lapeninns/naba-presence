import {
  BadgeCheckIcon,
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleMinusIcon,
  GitCompareIcon,
  HardDriveIcon,
  HourglassIcon,
  OctagonXIcon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon,
  Undo2Icon,
  UserCheckIcon,
  type LucideIcon,
} from "lucide-react"
import * as React from "react"

import type { StatusGlyph as StatusGlyphName } from "@/lib/editors/outcome"
import { cn } from "@/lib/utils"

/**
 * The lucide shape for each state glyph named in lib/editors/outcome.ts.
 * Pills, the change track and the outcome notice all draw from here, so a
 * state has one shape wherever it appears.
 */
export const STATUS_GLYPH_ICON: Record<StatusGlyphName, LucideIcon> = {
  "circle-dashed": CircleDashedIcon,
  "hard-drive": HardDriveIcon,
  "octagon-x": OctagonXIcon,
  "user-check": UserCheckIcon,
  "undo-2": Undo2Icon,
  "circle-check": CircleCheckIcon,
  send: SendIcon,
  "refresh-cw": RefreshCwIcon,
  hourglass: HourglassIcon,
  "badge-check": BadgeCheckIcon,
  "circle-help": CircleHelpIcon,
  ban: BanIcon,
  "triangle-alert": TriangleAlertIcon,
  "git-compare": GitCompareIcon,
  "circle-minus": CircleMinusIcon,
}

/**
 * A state's glyph, decorative: the words beside it carry the meaning.
 * Status glyphs draw at stroke 2 (SYSTEM §8).
 */
function StatusGlyph({
  glyph,
  className,
  ...props
}: Omit<React.ComponentProps<LucideIcon>, "ref"> & {
  glyph: StatusGlyphName
}) {
  const Icon = STATUS_GLYPH_ICON[glyph]
  return (
    <Icon
      aria-hidden
      data-glyph={glyph}
      strokeWidth={2}
      className={cn("size-3.5 shrink-0", className)}
      {...props}
    />
  )
}

export { StatusGlyph }
