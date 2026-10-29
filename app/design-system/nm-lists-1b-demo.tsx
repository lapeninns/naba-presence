"use client"

import { BellIcon, MailIcon, StarIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import { Input } from "@/components/ui/input"
import { ListRow, ListRows } from "@/components/ui/list-row"
import {
  SettingsGroup,
  SettingsGroupAction,
  SettingsRow,
} from "@/components/ui/settings-row"
import { StatusPill } from "@/components/ui/status-pill"

/** Neutral initials, standing in for the shared avatar in this demo. */
function Initials({ name }: { name: string }) {
  const letters = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
  return (
    <span
      aria-hidden
      className="grid size-(--np-avatar-list) place-items-center rounded-full bg-avatar-bg text-caption font-semibold text-avatar-ink"
    >
      {letters}
    </span>
  )
}

function DemoSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="text-section font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

const EVENTS = [
  { key: "review", label: "New review", icon: <StarIcon /> },
  { key: "reply", label: "Reply published", icon: <MailIcon /> },
  { key: "failed", label: "Publishing failed", icon: <BellIcon /> },
]

type Client = {
  id: string
  name: string
  health: "Healthy" | "Needs attention"
  open: string
  sync: string
}

const CLIENTS: Client[] = [
  {
    id: "c1",
    name: "Old Crown Group",
    health: "Healthy",
    open: "3 need reply",
    sync: "Synced 2h ago",
  },
  {
    id: "c2",
    name: "Barley Mow",
    health: "Needs attention",
    open: "1 failed",
    sync: "Synced 1d ago",
  },
]

const CLIENT_COLUMNS: DataTableColumn<Client>[] = [
  {
    id: "avatar",
    header: "",
    priority: "leading",
    cell: (row) => <Initials name={row.name} />,
  },
  {
    id: "name",
    header: "Client",
    priority: "primary",
    cell: (row) => (
      <a href={`#${row.id}`} className="text-ink no-underline focus-halo">
        {row.name}
      </a>
    ),
  },
  {
    id: "health",
    header: "Health",
    priority: "secondary",
    cell: (row) => (
      <StatusPill tone={row.health === "Healthy" ? "healthy" : "at-risk"}>
        {row.health}
      </StatusPill>
    ),
  },
  {
    id: "open",
    header: "Open work",
    priority: "trailing",
    cell: (row) => (
      <span className="text-caption text-ink-muted tabular-nums">
        {row.open}
      </span>
    ),
  },
  {
    id: "sync",
    header: "Last sync",
    priority: "meta",
    label: "",
    cell: (row) => row.sync,
  },
]

type Filter = { key: string; label: string }

const INITIAL_FILTERS: Filter[] = [
  { key: "rating", label: "Rating: 1–2 stars" },
  { key: "venue", label: "Venue: The Old Crown" },
  { key: "written", label: "With text" },
]

/**
 * FOUNDATION Drop 1b list additions: SettingsGroup slots (id/heading,
 * caption, actions, card footer), the inline-field SettingsRow with a
 * "Changed" word, ListRow footer actions, the FilterChip strip's focus
 * handoff and alert counts, and DataTable `responsive="list"`.
 */
function NmLists1bDemo() {
  const [events, setEvents] = React.useState<Record<string, boolean>>({
    review: true,
    reply: false,
    failed: true,
  })
  const [name, setName] = React.useState("The Old Crown")
  const [filters, setFilters] = React.useState(INITIAL_FILTERS)
  const [bucket, setBucket] = React.useState("all")
  const searchRef = React.useRef<HTMLButtonElement>(null)
  const allOn = Object.values(events).every(Boolean)

  return (
    <div data-slot="nm-lists-1b-demo" className="flex min-w-0 flex-col gap-8">
      <DemoSection title="Settings group: card with a footer">
        <SettingsGroup
          id="demo-notifications"
          label="Notifications per event"
          headingAs="h3"
          caption="Saved for every venue you manage."
          card
          action={
            <SettingsGroupAction
              onClick={() =>
                setEvents((current) =>
                  Object.fromEntries(
                    Object.keys(current).map((key) => [key, !allOn])
                  )
                )
              }
            >
              {allOn ? "Turn all off" : "Turn all on"}
            </SettingsGroupAction>
          }
          footer={<Button size="sm">Save</Button>}
        >
          {EVENTS.map((event) => (
            <SettingsRow
              key={event.key}
              icon={event.icon}
              label={event.label}
              checked={events[event.key] ?? false}
              onCheckedChange={(next) =>
                setEvents((current) => ({ ...current, [event.key]: next }))
              }
            />
          ))}
        </SettingsGroup>
      </DemoSection>

      <DemoSection title="Settings row: inline field">
        <SettingsGroup label="Business information" headingAs="h3">
          <SettingsRow
            label="Business name"
            description="As it appears on Google."
            changed={name !== "The Old Crown" ? "Changed" : undefined}
            controlId="demo-business-name"
            control={
              <Input
                id="demo-business-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-describedby="demo-business-name-description"
              />
            }
          />
        </SettingsGroup>
      </DemoSection>

      <DemoSection title="List row with footer actions">
        <ListRows aria-label="Suggestions" bleed>
          <ListRow
            emphasis="neutral"
            leading={<Initials name="Google" />}
            title="Google suggested new hours"
            meta="9:10"
            preview="Mon–Fri 11:00–23:00 (was 12:00–23:00)"
            footer={
              <>
                <Button size="sm" variant="tinted">
                  Accept
                </Button>
                <Button size="sm" variant="ghost">
                  Ignore
                </Button>
              </>
            }
          />
        </ListRows>
      </DemoSection>

      <DemoSection title="Filter chip strip: focus handoff and alert counts">
        <FilterChipStrip aria-label="Filter by health" role="group">
          {[
            { key: "all", label: "All", count: 12 },
            { key: "attention", label: "Needs attention", count: 2 },
            { key: "healthy", label: "Healthy", count: 10 },
          ].map((chip) => (
            <FilterChip
              key={chip.key}
              pressed={bucket === chip.key}
              count={chip.count}
              countTone={chip.key === "attention" ? "alert" : "default"}
              onClick={() => setBucket(chip.key)}
            >
              {chip.label}
            </FilterChip>
          ))}
        </FilterChipStrip>
        <FilterChipStrip
          aria-label="Applied filters"
          role="group"
          onEmpty={() => searchRef.current?.focus()}
        >
          {filters.map((filter) => (
            <FilterChip
              key={filter.key}
              onRemove={() =>
                setFilters((current) =>
                  current.filter((item) => item.key !== filter.key)
                )
              }
            >
              {filter.label}
            </FilterChip>
          ))}
        </FilterChipStrip>
        <Button
          ref={searchRef}
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setFilters(INITIAL_FILTERS)}
        >
          Reset filters
        </Button>
      </DemoSection>

      <DemoSection title="Data table as list rows on a phone">
        <DataTable
          caption="Clients"
          columns={CLIENT_COLUMNS}
          rows={CLIENTS}
          rowId={(row) => row.id}
          onRowClick={() => {}}
          responsive="list"
          surface
        />
      </DemoSection>
    </div>
  )
}

export { NmLists1bDemo }
