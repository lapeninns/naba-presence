import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Kbd,
} from "NabaReview"
import { CircleAlert, Copy, Link2, Search, Send, Sparkles } from "lucide-react"

export function ReviewSearch() {
  return (
    <InputGroup className="max-w-sm">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        defaultValue="spotless"
        placeholder="Search reviews"
        aria-label="Search reviews"
      />
      <InputGroupAddon align="inline-end">
        <Kbd>⌘K</Kbd>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function ReplyComposer() {
  return (
    <InputGroup className="max-w-md">
      <InputGroupAddon align="block-start" className="border-b">
        <InputGroupText>
          <Sparkles />
          Suggested reply · Priya Sharma, Central
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupTextarea
        rows={3}
        aria-label="Reply text"
        defaultValue="Thank you for the kind words, Priya. I'll pass them on to the front desk team — we hope to welcome you back to Lapen Inn Central soon."
      />
      <InputGroupAddon align="block-end" className="border-t">
        <InputGroupText className="font-mono text-xs">134 / 350</InputGroupText>
        <InputGroupButton variant="default" className="ml-auto">
          <Send />
          Post reply
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function WithTrailingButton() {
  return (
    <InputGroup className="max-w-sm">
      <InputGroupAddon>
        <Link2 />
      </InputGroupAddon>
      <InputGroupInput
        readOnly
        defaultValue="g.page/r/lapen-riverside/review"
        aria-label="Review link"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Copy review link">
          <Copy />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function TextPrefix() {
  return (
    <InputGroup className="max-w-sm">
      <InputGroupAddon>
        <InputGroupText className="font-mono">maps.app.goo.gl/</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        defaultValue="lapen-airport"
        aria-label="Short link slug"
      />
    </InputGroup>
  )
}

export function Invalid() {
  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <InputGroup>
        <InputGroupAddon>
          <CircleAlert className="text-destructive" />
        </InputGroupAddon>
        <InputGroupInput
          aria-invalid
          defaultValue="ops@lapeninns"
          aria-label="Digest recipient"
        />
      </InputGroup>
      <span className="text-xs text-destructive">
        Enter a valid email address for the daily review digest.
      </span>
    </div>
  )
}
