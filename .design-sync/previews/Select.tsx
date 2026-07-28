import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "NabaReview"

// `items` is what lets a CLOSED trigger show the label instead of the raw
// value — Base UI only mounts SelectItem children while the popup is open.
const LOCATIONS = [
  { value: "all", label: "All locations" },
  { value: "central", label: "Lapen Inn — Central" },
  { value: "riverside", label: "Lapen Inn — Riverside" },
  { value: "airport", label: "Lapen Inn — Airport" },
]

const TONES = [
  { value: "warm", label: "Warm and personal" },
  { value: "neutral", label: "Neutral and factual" },
  { value: "formal", label: "Formal brand voice" },
]

export function LocationFilter() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <Label htmlFor="location">Location</Label>
      <Select items={LOCATIONS} defaultValue="riverside">
        <SelectTrigger id="location" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCATIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        Scopes the reply queue to one Google Business Profile.
      </p>
    </div>
  )
}

export function Placeholder() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <Label htmlFor="tone">Reply tone</Label>
      <Select items={TONES}>
        <SelectTrigger id="tone" className="w-full">
          <SelectValue placeholder="Select a tone" />
        </SelectTrigger>
        <SelectContent>
          {TONES.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        Unset fields show the placeholder in muted foreground.
      </p>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="size-default">Status (default)</Label>
        <Select
          items={{ awaiting: "Awaiting reply", replied: "Replied", escalated: "Escalated" }}
          defaultValue="awaiting"
        >
          <SelectTrigger id="size-default" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="awaiting">Awaiting reply</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="size-sm">Status (sm)</Label>
        <Select
          items={{ awaiting: "Awaiting reply", replied: "Replied", escalated: "Escalated" }}
          defaultValue="escalated"
        >
          <SelectTrigger id="size-sm" size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="awaiting">Awaiting reply</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function States() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="owner">Assigned owner</Label>
        <Select items={{ priya: "Priya Sharma" }} defaultValue="priya" disabled>
          <SelectTrigger id="owner" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priya">Priya Sharma</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Disabled — the profile is read-only.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="template">Reply template</Label>
        <Select items={TONES}>
          <SelectTrigger id="template" className="w-full" aria-invalid>
            <SelectValue placeholder="Select a template" />
          </SelectTrigger>
          <SelectContent>
            {TONES.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-destructive">Pick a template before publishing.</p>
      </div>
    </div>
  )
}

// The popup only mounts while open, so a static card can only show the trigger.
// The grouped markup still ships here as the composition to copy.
export function GroupedInToolbar() {
  return (
    <div className="flex w-full flex-col gap-3">
      <span className="text-sm font-medium text-foreground">Escalation routing</span>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="grouped" className="text-muted-foreground">
          Route to
        </Label>
        <Select
          items={{
            priya: "Priya Sharma",
            tom: "Tom Okafor",
            lena: "Lena Fischer",
            duty: "Duty manager on shift",
          }}
          defaultValue="tom"
        >
          <SelectTrigger id="grouped">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Reply team</SelectLabel>
              <SelectItem value="priya">Priya Sharma</SelectItem>
              <SelectItem value="tom">Tom Okafor</SelectItem>
              <SelectItem value="lena">Lena Fischer</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Rotas</SelectLabel>
              <SelectItem value="duty">Duty manager on shift</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm">
          Apply
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        SelectGroup + SelectLabel head the reply team and the on-shift rota inside
        the popup.
      </p>
    </div>
  )
}
