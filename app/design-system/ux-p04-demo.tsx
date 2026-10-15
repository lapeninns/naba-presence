"use client"

import * as React from "react"

import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
import { TabNav, type TabNavItem } from "@/components/ui/tabs"

/**
 * Navigation-strip primitives (P04): the desk overflow ("More") on TabNav,
 * the 44px tab floor, the one zero rule and `FilterChip`'s `hideWhenZero`.
 * Hash links stand in for routes so the demo never leaves the page.
 */

const AREAS = [
  "Overview",
  "Profile",
  "Hours",
  "Photos",
  "Menu",
  "Posts",
  "Reviews",
  "Questions",
  "Suggestions",
  "Verification",
  "Review & publish",
]

function areaItems(current: string): TabNavItem[] {
  return AREAS.map((label) => ({
    href: `#ds-p04-${label.toLowerCase().replace(/\W+/g, "-")}`,
    label,
    current: label === current,
  }))
}

function DemoSection({
  title,
  note,
  children,
}: {
  title: string
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-title font-semibold text-ink">{title}</h3>
        {note ? <p className="text-caption text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </div>
  )
}

const BUCKETS = [
  { value: "all", label: "All", count: 12 },
  { value: "attention", label: "Needs attention", count: 3 },
  { value: "publish", label: "To publish", count: 0 },
  { value: "unlinked", label: "Not linked", count: 0 },
  { value: "synced", label: "In sync", count: 9 },
]

function HideWhenZeroDemo() {
  const [value, setValue] = React.useState("all")
  return (
    <FilterChipStrip aria-label="Filter by status" role="group">
      {BUCKETS.map((bucket) => (
        <FilterChip
          key={bucket.value}
          pressed={value === bucket.value}
          count={bucket.count}
          hideWhenZero
          onClick={() => setValue(bucket.value)}
        >
          {bucket.label}
        </FilterChip>
      ))}
    </FilterChipStrip>
  )
}

function SelectedZeroDemo() {
  return (
    <>
      <FilterChipStrip aria-label="Empty buckets" role="group">
        <FilterChip pressed count={0} hideWhenZero>
          To publish
        </FilterChip>
        <FilterChip count={0} hideWhenZero>
          Not linked
        </FilterChip>
        <FilterChip count={0}>In sync</FilterChip>
      </FilterChipStrip>
      <p className="text-caption text-ink-muted">
        To publish is pressed, so it stays. Not linked is empty and hidden. In
        sync is empty but did not opt in, so it stays, with no figure.
      </p>
    </>
  )
}

export function UxP04Demo() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <DemoSection
        title="Tab strip overflow"
        note='overflow="more": on a desk the tabs that do not fit go into More. Phones and tablets scroll.'
      >
        <div className="flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-5">
          <p className="text-caption text-ink-muted">
            Current tab inside the row.
          </p>
          <TabNav
            aria-label="Listing areas, wide"
            items={areaItems("Hours")}
            overflow="more"
          />
          <p className="text-caption text-ink-muted">
            A narrower strip: the current tab (Suggestions) stays in the row,
            the rest wait in More.
          </p>
          <TabNav
            aria-label="Listing areas, narrow"
            items={areaItems("Suggestions")}
            overflow="more"
            className="max-w-xl"
          />
        </div>
      </DemoSection>

      <DemoSection
        title="Tab floor and the zero rule"
        note="No tab is under 44px wide on touch. A zero draws no figure."
      >
        <div className="flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-5">
          <TabNav
            aria-label="Short tabs"
            variant="text"
            items={[
              { href: "#ds-p04-all", label: "All", current: true },
              { href: "#ds-p04-new", label: "New", count: 4 },
              { href: "#ds-p04-failed", label: "Failed", count: 0 },
              { href: "#ds-p04-done", label: "Done", count: 0 },
            ]}
          />
        </div>
      </DemoSection>

      <DemoSection
        title="Hide empty buckets"
        note="hideWhenZero drops a bucket with nothing in it, unless it is pressed."
      >
        <div className="flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-5">
          <HideWhenZeroDemo />
          <SelectedZeroDemo />
        </div>
      </DemoSection>
    </div>
  )
}
