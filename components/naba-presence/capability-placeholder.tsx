"use client"

import { Lock } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"

export function CapabilityPlaceholder({
  capability,
  flag,
  enabled,
  description,
}: {
  capability: string
  flag: string
  enabled: boolean
  description: string
}) {
  return (
    <Empty className="min-h-[320px]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lock aria-hidden />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>
          {capability}
        </EmptyTitle>
        <EmptyDescription className="flex flex-col items-center gap-3">
          <span>{description}</span>
          <span>
            {enabled
              ? "This capability is enabled but its implementation has not shipped yet."
              : "This capability is not enabled."}{" "}
            It is controlled by <Kbd>{flag}</Kbd>.
          </span>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
