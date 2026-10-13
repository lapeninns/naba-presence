"use client"

import { InboxIcon, PlusIcon, StarIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
import { ListRow, ListRowTag, ListRows } from "@/components/ui/list-row"
import { ViewHeader } from "@/components/ui/view-header"
import { StatusPill } from "@/components/ui/status-pill"
import { Tabs, TabsList, TabsTab, TextTabs } from "@/components/ui/tabs"
import { FilterButton, Toolbar } from "@/components/ui/toolbar"

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

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StarIcon aria-hidden className="size-3.5 fill-current text-rating" />
      {value}★
    </span>
  )
}

type Filter = { key: string; label: string }

const INITIAL_FILTERS: Filter[] = [
  { key: "rating", label: "Rating: 1–2 stars" },
  { key: "venue", label: "Venue: The Old Crown" },
  { key: "written", label: "Written review: With text" },
]

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

/**
 * Notion Mail list primitives (Drop 1): ListRow, ViewHeader, Toolbar with
 * search mode, FilterChip strip and text tabs.
 */
function NmListDemo() {
  const [selected, setSelected] = React.useState("r2")
  const [query, setQuery] = React.useState("")
  const [filters, setFilters] = React.useState(INITIAL_FILTERS)
  const [quick, setQuick] = React.useState<string[]>(["needs-reply"])
  const [searchMode, setSearchMode] = React.useState(false)

  const toggleQuick = (key: string) =>
    setQuick((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    )

  return (
    <div data-slot="nm-list-demo" className="flex min-w-0 flex-col gap-8">
      <DemoSection title="Page header">
        <div className="flex flex-col gap-4 rounded-(--np-radius-card) border border-line-subtle p-4">
          <ViewHeader
            titleAs="p"
            icon={<InboxIcon />}
            title="Inbox"
            count="12"
            countLabel="12 need a reply"
            actions={
              <Button size="icon" variant="ghost" aria-label="New post">
                <PlusIcon aria-hidden />
              </Button>
            }
          />
          <ViewHeader
            titleAs="p"
            back={{ href: "/design-system", label: "Inbox" }}
            title="Review from Jane Smith"
          />
        </div>
      </DemoSection>

      <DemoSection title="Toolbar">
        <div className="rounded-(--np-radius-card) border border-line-subtle px-4">
          <Toolbar
            sticky={false}
            searchLabel="Search reviews"
            searchPlaceholder="Search reviews…"
            searchValue={query}
            onSearchChange={setQuery}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            filter={<FilterButton count={filters.length} />}
            chips={filters.map((filter) => (
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
            resultsLabel={query ? `Results for “${query}”` : "24 reviews"}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setSearchMode(true)}
        >
          Preview phone search mode
        </Button>
      </DemoSection>

      <DemoSection title="Filter chips">
        <FilterChipStrip aria-label="Quick filters" role="group">
          {[
            ["needs-reply", "Needs reply"],
            ["low", "1–2★"],
            ["text", "With text"],
            ["photos", "With photos"],
            ["translated", "Translated"],
            ["this-week", "This week"],
          ].map(([key, label]) => (
            <FilterChip
              key={key}
              pressed={quick.includes(key)}
              onClick={() => toggleQuick(key)}
            >
              {label}
            </FilterChip>
          ))}
        </FilterChipStrip>
      </DemoSection>

      <DemoSection title="Text tabs">
        <TextTabs
          aria-label="Queues"
          items={[
            {
              href: "/design-system#needs-reply",
              label: "Needs reply",
              count: 12,
              current: true,
            },
            { href: "/design-system#drafts", label: "Drafts", count: 3 },
            {
              href: "/design-system#approval",
              label: "Awaiting approval",
              count: 1,
            },
            { href: "/design-system#scheduled", label: "Scheduled" },
            { href: "/design-system#published", label: "Published" },
            { href: "/design-system#all", label: "All" },
          ]}
        />
        <Tabs defaultValue="overview">
          <TabsList variant="text">
            <TabsTab value="overview">Overview</TabsTab>
            <TabsTab value="activity">Activity</TabsTab>
            <TabsTab value="settings">Settings</TabsTab>
          </TabsList>
        </Tabs>
      </DemoSection>

      <DemoSection title="List rows">
        <div className="overflow-hidden rounded-(--np-radius-card) border border-line-subtle">
          <ListRows aria-label="Reviews">
            <ListRow
              leading={<Initials name="Amelia Hart" />}
              title="Amelia Hart"
              emphasis="unread"
              unreadLabel="Needs reply"
              meta="9:10"
              subtitle={
                <>
                  <Stars value={2} /> · The Old Crown
                </>
              }
              trailing={<StatusPill tone="warning">Needs reply</StatusPill>}
              preview="The food was lovely but we waited forty minutes for a table we had booked a week in advance."
              selected={selected === "r1"}
              onClick={() => setSelected("r1")}
            />
            <ListRow
              leading={<Initials name="Tom Price" />}
              title="Tom Price"
              meta="Yesterday"
              subtitle={
                <>
                  <Stars value={5} /> · The Railway
                </>
              }
              trailing={<StatusPill tone="success">Replied</StatusPill>}
              preview="Great Sunday roast, friendly staff, will be back."
              tags={
                <>
                  <ListRowTag tone="green">Food</ListRowTag>
                  <ListRowTag tone="blue">Staff</ListRowTag>
                </>
              }
              selected={selected === "r2"}
              onClick={() => setSelected("r2")}
            />
            <ListRow
              leading={<Initials name="Priya Nair" />}
              title="Priya Nair"
              meta="12 Oct"
              subtitle="4★ · The Bell"
              preview="A link row: the whole row is the link."
              href="/design-system#review-3"
            />
            <ListRow
              interactive={false}
              title="Weekly summary"
              emphasis="neutral"
              meta="Mon"
              preview="A non-interactive row, for rows that carry their own controls."
            />
          </ListRows>
        </div>
      </DemoSection>
    </div>
  )
}

export { NmListDemo }
