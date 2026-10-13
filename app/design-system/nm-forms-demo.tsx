"use client"

import * as React from "react"

import { Banner } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DiffView } from "@/components/ui/diff-view"
import {
  Field,
  FieldCounter,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Timeline } from "@/components/ui/timeline"
import { TypedConfirmation } from "@/components/ui/typed-confirmation"
import { ValidationSummary } from "@/components/ui/validation-summary"

function DemoSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-caption font-medium text-ink-muted">{title}</h3>
      {children}
    </div>
  )
}

const DIFF_ROWS = [
  { field: "Phone", before: "01223 277 217", after: "01223 277 218" },
  { field: "Website", before: "", after: "https://example.com" },
  {
    field: "Name",
    before: "The Old Crown",
    after: "The Old Crown",
    state: "unchanged" as const,
  },
]

/** A validation summary whose second field lives behind a disclosure. */
function ValidationNavigateDemo() {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="flex flex-col gap-3">
      <ValidationSummary
        autoFocus={false}
        errors={[
          { fieldId: "nm-demo-email", message: "Enter an email address" },
          {
            fieldId: "nm-demo-hidden",
            message: "Add an opening time (inside “More hours”)",
          },
        ]}
        onNavigate={(fieldId) => {
          if (fieldId === "nm-demo-hidden") setOpen(true)
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nm-demo-email">Email</Label>
        <Input id="nm-demo-email" type="email" aria-invalid />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        More hours
      </Button>
      {open ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nm-demo-hidden">Opens at</Label>
          <Input id="nm-demo-hidden" aria-invalid />
        </div>
      ) : null}
    </div>
  )
}

export function NmFormsDemo() {
  const [search, setSearch] = React.useState("parking")
  const [reply, setReply] = React.useState("Thanks for visiting!")
  return (
    <div className="flex flex-col gap-8">
      <DemoSection title="Fields · email step">
        <div className="grid max-w-md gap-4">
          <Field>
            <FieldLabel>Work email</FieldLabel>
            <Input type="email" placeholder="you@venue.co.uk" />
            <FieldDescription>We send a sign-in code to it.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel optional>Reply</FieldLabel>
            <Input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
            <FieldCounter count={reply.length} max={40}>
              {reply.length} / 40 characters
            </FieldCounter>
          </Field>
          <Input
            type="search"
            aria-label="Search reviews"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </DemoSection>
      <DemoSection title="Validation summary · opens the field’s container">
        <div className="max-w-md">
          <ValidationNavigateDemo />
        </div>
      </DemoSection>
      <DemoSection title="Typed confirmation · fallback">
        <div className="max-w-md">
          <TypedConfirmation
            expected={null}
            fallbackExpected="The Old Crown"
            description="The Google email for this connection is unknown, so type its name."
          />
        </div>
      </DemoSection>
      <DemoSection title="Progress · status word">
        <div className="grid max-w-md gap-4">
          <Progress label="Import" status="Waiting for Google" />
          <Progress
            label="Import"
            status="Importing reviews"
            figure="3 of 12"
            value={3}
            max={12}
          />
          <Progress label="Import" status="Paused" tone="bad" />
        </div>
      </DemoSection>
      <DemoSection title="Diff · card and flat">
        <div className="grid gap-4 md:grid-cols-2">
          <DiffView caption="Changes to publish" rows={DIFF_ROWS} />
          <DiffView
            caption="Changes to publish"
            rows={DIFF_ROWS}
            variant="flat"
          />
        </div>
      </DemoSection>
      <DemoSection title="Timeline · sans times">
        <Timeline
          className="max-w-md"
          entries={[
            {
              id: "1",
              title: "Reply published",
              when: "2 h ago",
              tone: "healthy",
            },
            { id: "2", title: "Draft saved", when: "3 h ago", tone: "accent" },
          ]}
        />
      </DemoSection>
      <DemoSection title="Banners and role badge">
        <div className="flex flex-col gap-3">
          <Banner tone="announcement">
            Replies now publish in under a minute. <a href="#">Learn more</a>
          </Banner>
          <Banner tone="warn">Reconnect Google to keep replies in sync.</Banner>
          <div className="flex gap-2">
            <Badge variant="role">Owner</Badge>
            <Badge variant="role">Member</Badge>
          </div>
        </div>
      </DemoSection>
    </div>
  )
}
