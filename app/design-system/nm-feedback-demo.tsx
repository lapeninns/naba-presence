"use client"

import {
  ArchiveIcon,
  CheckIcon,
  EllipsisIcon,
  SendIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyIllustration } from "@/components/ui/empty"
import { SelectionBar, SelectionBarTile } from "@/components/ui/selection-bar"
import { showToast, toastProgress } from "@/components/ui/toast"

function DemoSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-ui font-semibold text-ink-muted">{title}</h3>
      {children}
    </div>
  )
}

/** Toast phases: progress, then the result in the same toast. */
function ToastPhasesDemo() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const saving = toastProgress("Marking 3 reviews done…")
          window.setTimeout(
            () =>
              saving.success("3 reviews marked done", {
                undo: {
                  onUndo: () => showToast({ title: "Back in Needs reply" }),
                },
              }),
            1200
          )
        }}
      >
        Local: progress, then Undo
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const publishing = toastProgress("Publishing reply…", {
            kind: "google",
          })
          window.setTimeout(
            () =>
              publishing.success("Reply published", {
                link: { href: "https://business.google.com/" },
              }),
            1500
          )
        }}
      >
        Google: progress, then View
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const publishing = toastProgress("Publishing reply…", {
            kind: "google",
          })
          window.setTimeout(
            () =>
              publishing.error("Reply not published", {
                description: "Google refused it. The draft is kept here.",
              }),
            1500
          )
        }}
      >
        Google: progress, then failure
      </Button>
    </div>
  )
}

/** A selection of five rows, and the bar that acts on it. */
function SelectionBarDemo() {
  const [count, setCount] = React.useState(2)
  const [docked, setDocked] = React.useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCount((value) => Math.min(value + 1, 5))}
        >
          Select one more
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDocked((value) => !value)}
        >
          {docked ? "Show inline" : "Dock on a phone"}
        </Button>
        {count === 0 ? (
          <Button variant="outline" size="sm" onClick={() => setCount(2)}>
            Start a selection
          </Button>
        ) : null}
      </div>
      <SelectionBar
        visible={count > 0}
        count={count}
        countLabel={`${count} ${count === 1 ? "review" : "reviews"} selected`}
        onCancel={() => setCount(0)}
        dock={docked}
        notes={
          count > 2
            ? `${count - 2} of these are not ready for your approval, so Approve will skip them.`
            : undefined
        }
      >
        <SelectionBarTile icon={<CheckIcon aria-hidden />} label="Done" />
        <SelectionBarTile icon={<TagIcon aria-hidden />} label="Tag" />
        <SelectionBarTile icon={<ArchiveIcon aria-hidden />} label="Archive" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SelectionBarTile
                icon={<EllipsisIcon aria-hidden />}
                label="More"
              />
            }
          />
          <DropdownMenuContent side="top" align="end">
            <DropdownMenuItem variant="destructive">
              <Trash2Icon aria-hidden />
              Remove from list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SelectionBarTile
          tone="charcoal"
          icon={<SendIcon aria-hidden />}
          label="Approve"
        />
      </SelectionBar>
    </div>
  )
}

/**
 * The Notion Mail feedback primitives on /design-system: the empty state
 * with and without its illustration, the SelectionBar, and toast phases.
 */
export function NmFeedbackDemo() {
  return (
    <div className="flex flex-col gap-8">
      <DemoSection title="Empty state · illustration">
        <div className="grid gap-4 md:grid-cols-2">
          <Empty
            framed
            illustration={<EmptyIllustration name="inbox-zero" />}
            title="All caught up"
            description="No reviews need a reply. New ones sync every 15 min."
            action={<Button variant="secondary">Open all reviews</Button>}
          />
          <Empty
            framed
            illustration={<EmptyIllustration name="search" />}
            title="No reviews match “parking”"
            description="Try fewer words, or clear the filters."
          />
        </div>
      </DemoSection>
      <DemoSection title="Empty state · glyph variants">
        <div className="grid gap-4 md:grid-cols-2">
          <Empty
            framed
            size="sm"
            title="No posts scheduled"
            description="Scheduled posts appear here until they go live."
          />
          <Empty
            framed
            size="sm"
            variant="forbidden"
            title="Only owners can see billing"
            description="Ask an owner of this workspace for access."
          />
        </div>
      </DemoSection>
      <DemoSection title="Selection bar">
        <SelectionBarDemo />
      </DemoSection>
      <DemoSection title="Toast phases">
        <ToastPhasesDemo />
      </DemoSection>
    </div>
  )
}
