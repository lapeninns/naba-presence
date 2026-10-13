"use client"

import { ImagesIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import { Empty } from "@/components/ui/empty"
import { FileCard } from "@/components/ui/file-card"
import { Stepper } from "@/components/ui/stepper"
import { Textarea } from "@/components/ui/textarea"
import {
  TypedConfirmation,
  confirmationMatches,
} from "@/components/ui/typed-confirmation"

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

const CATEGORIES = ["Pub", "Gastropub", "Hotel", "Inn", "Restaurant"]

/** A remote search: "Searching…" alone while in flight, never "No matches." beside it. */
function ComboboxEmptyDemo() {
  const [query, setQuery] = React.useState("")
  const searching = query.length > 0 && query.length < 3
  const results = searching
    ? []
    : CATEGORIES.filter((name) =>
        name.toLowerCase().includes(query.toLowerCase())
      )
  return (
    <Combobox
      items={results}
      filter={null}
      search="always"
      value={null}
      inputValue={query}
      onInputValueChange={(value) => setQuery(value)}
    >
      <ComboboxInput
        aria-label="Search categories"
        placeholder="Search categories…"
        wrapperClassName="max-w-sm"
      />
      <ComboboxContent
        emptyText={searching ? null : "No categories match that search."}
      >
        {searching ? (
          <div className="px-2 py-2 text-ui text-ink-muted">Searching…</div>
        ) : (
          results.map((name) => (
            <ComboboxItem key={name} value={name}>
              {name}
            </ComboboxItem>
          ))
        )}
      </ComboboxContent>
    </Combobox>
  )
}

/** The button arms with exactly the rule the "Matches" line uses. */
function TypedConfirmationDemo() {
  const [typed, setTyped] = React.useState("")
  const expected = "Camden Hotel"
  const armed = confirmationMatches(typed, expected, "trimmed-insensitive")
  return (
    <div className="grid max-w-sm gap-3">
      <TypedConfirmation
        expected={expected}
        match="trimmed-insensitive"
        value={typed}
        onValueChange={setTyped}
        description="Case and outer spaces are ignored; inner spaces must match."
      />
      <Button variant="danger" disabled={!armed}>
        Remove Camden Hotel
      </Button>
    </div>
  )
}

export function NmDrop3Demo() {
  const [description, setDescription] = React.useState("")
  return (
    <div className="flex flex-col gap-8">
      <DemoSection title="Combobox · empty text follows the search">
        <ComboboxEmptyDemo />
      </DemoSection>

      <DemoSection title="Textarea · one growing line, 44px on touch">
        <Textarea
          aria-label="Item description"
          autoSize
          minRows={1}
          maxRows={6}
          placeholder="Describe the dish"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="max-w-sm"
        />
      </DemoSection>

      <DemoSection title="Typed confirmation · trimmed, case-insensitive">
        <TypedConfirmationDemo />
      </DemoSection>

      <DemoSection title="Empty · error with actions outside the alert">
        <Empty
          variant="error"
          role="alert"
          framed
          title="We couldn't load this listing"
          description="Google didn't answer in time. Nothing was changed."
          actions={
            <>
              <Button>Try again</Button>
              <Button variant="ghost">Go to Inbox</Button>
            </>
          }
        />
      </DemoSection>

      <DemoSection title="Stepper · quiet, words first">
        <Stepper
          variant="quiet"
          aria-label="Verification"
          className="max-w-sm"
          steps={[
            {
              id: "start",
              label: "Request a code",
              state: "done",
              meta: "By post · 14 Oct",
            },
            {
              id: "pin",
              label: "Enter the PIN",
              state: "current",
              meta: "Arrives in about 5 days",
            },
            { id: "outcome", label: "Verified on Google", state: "todo" },
            {
              id: "video",
              label: "Video verification",
              state: "skipped",
              stateLabel: "Not needed for this listing",
            },
          ]}
        />
      </DemoSection>

      <DemoSection title="Button · block labels wrap">
        <div className="grid max-w-80 gap-2">
          <Button block>
            Request a verification code by post to this venue
          </Button>
          <Button block variant="secondary" size="sm">
            Keep the current opening hours and close this message
          </Button>
        </div>
      </DemoSection>

      <DemoSection title="File cards · attachments">
        <ul
          aria-label="Photos to upload"
          className="grid max-w-xl gap-2 sm:grid-cols-2"
        >
          <FileCard
            name="terrace-summer-evening-with-the-long-table-set-for-twelve.jpg"
            size={3_400_000}
            state="Ready"
            fallbackIcon={<ImagesIcon aria-hidden className="size-4" />}
            onRemove={() => {}}
          />
          <FileCard
            name="bar.jpg"
            size={840_000}
            state="Uploading"
            progress={{ value: 40, status: "Uploading", figure: "40%" }}
            onRemove={() => {}}
          />
          <FileCard
            name="menu.pdf"
            size={12_000_000}
            state="Refused"
            refusal="Google takes photos up to 5 MB. This one is 12.0 MB."
            onRemove={() => {}}
          />
        </ul>
      </DemoSection>
    </div>
  )
}
