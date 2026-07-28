import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  KbdGroup,
} from "NabaReview"
import {
  ArrowDown,
  ArrowUp,
  Command,
  CornerDownLeft,
  Option,
  Search,
  Send,
} from "lucide-react"

export function Keys() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Kbd>⌘</Kbd>
      <Kbd>⇧</Kbd>
      <Kbd>⌥</Kbd>
      <Kbd>K</Kbd>
      <Kbd>J</Kbd>
      <Kbd>⏎</Kbd>
      <Kbd>Esc</Kbd>
      <Kbd>Tab</Kbd>
      <Kbd>Space</Kbd>
    </div>
  )
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Kbd>
        <Command />
      </Kbd>
      <Kbd>
        <Option />
      </Kbd>
      <Kbd>
        <CornerDownLeft />
      </Kbd>
      <Kbd>
        <ArrowUp />
      </Kbd>
      <Kbd>
        <ArrowDown />
      </Kbd>
    </div>
  )
}

export function Chords() {
  return (
    <div className="flex flex-wrap items-center gap-6">
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>⏎</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>⇧</Kbd>
        <Kbd>⌘</Kbd>
        <Kbd>E</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>
          <Command />
        </Kbd>
        <span className="text-xs text-muted-foreground">then</span>
        <Kbd>G</Kbd>
      </KbdGroup>
    </div>
  )
}

const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "Open command menu", keys: ["⌘", "K"] },
  { label: "Post reply", keys: ["⌘", "⏎"] },
  { label: "Next review in queue", keys: ["J"] },
  { label: "Previous review", keys: ["K"] },
  { label: "Escalate to duty manager", keys: ["⇧", "⌘", "E"] },
  { label: "Dismiss draft", keys: ["Esc"] },
]

export function ShortcutList() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">Reviewer queue</div>
      {SHORTCUTS.map((s) => (
        <div key={s.label} className="flex items-center justify-between gap-4">
          <span className="text-sm text-foreground">{s.label}</span>
          <KbdGroup>
            {s.keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </KbdGroup>
        </div>
      ))}
    </div>
  )
}

export function InlineHints() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <InputGroup>
        <InputGroupAddon>
          <Search className="size-4 text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search reviews, locations…" />
        <InputGroupAddon align="inline-end">
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </InputGroupAddon>
      </InputGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button>
          <Send />
          Post reply
          <KbdGroup>
            <Kbd className="bg-primary-foreground text-primary">⌘</Kbd>
            <Kbd className="bg-primary-foreground text-primary">⏎</Kbd>
          </KbdGroup>
        </Button>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          or press
          <Kbd>Esc</Kbd>
          to discard
        </span>
      </div>
    </div>
  )
}
