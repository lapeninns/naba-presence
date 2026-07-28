import {
  Label,
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "NabaReview"

export function LocationPicker() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <Label htmlFor="location">Location</Label>
      <NativeSelect id="location" defaultValue="riverside" className="w-full">
        <NativeSelectOption value="all">All locations</NativeSelectOption>
        <NativeSelectOption value="central">Lapen Inn — Central</NativeSelectOption>
        <NativeSelectOption value="riverside">Lapen Inn — Riverside</NativeSelectOption>
        <NativeSelectOption value="airport">Lapen Inn — Airport</NativeSelectOption>
      </NativeSelect>
      <p className="text-sm text-muted-foreground">
        Scopes the reply queue to one Google Business Profile.
      </p>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="role-default">Team role (default)</Label>
        <NativeSelect id="role-default" defaultValue="admin">
          <NativeSelectOption value="owner">Owner</NativeSelectOption>
          <NativeSelectOption value="admin">Admin</NativeSelectOption>
          <NativeSelectOption value="member">Member</NativeSelectOption>
          <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="role-sm">Team role (sm)</Label>
        <NativeSelect id="role-sm" size="sm" defaultValue="viewer">
          <NativeSelectOption value="owner">Owner</NativeSelectOption>
          <NativeSelectOption value="admin">Admin</NativeSelectOption>
          <NativeSelectOption value="member">Member</NativeSelectOption>
          <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
        </NativeSelect>
      </div>
    </div>
  )
}

export function FilterBar() {
  return (
    <div className="flex w-full flex-col gap-3">
      <span className="text-sm font-medium text-foreground">Review queue filters</span>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bar-property" className="text-xs text-muted-foreground">
            Property
          </Label>
          <NativeSelect id="bar-property" size="sm" defaultValue="central">
            <NativeSelectOptGroup label="City">
              <NativeSelectOption value="central">Central</NativeSelectOption>
              <NativeSelectOption value="riverside">Riverside</NativeSelectOption>
            </NativeSelectOptGroup>
            <NativeSelectOptGroup label="Transit">
              <NativeSelectOption value="airport">Airport</NativeSelectOption>
            </NativeSelectOptGroup>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bar-rating" className="text-xs text-muted-foreground">
            Rating
          </Label>
          <NativeSelect id="bar-rating" size="sm" defaultValue="low">
            <NativeSelectOption value="any">Any rating</NativeSelectOption>
            <NativeSelectOption value="low">1–2 stars</NativeSelectOption>
            <NativeSelectOption value="high">4–5 stars</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bar-status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <NativeSelect id="bar-status" size="sm" defaultValue="awaiting">
            <NativeSelectOption value="awaiting">Awaiting reply</NativeSelectOption>
            <NativeSelectOption value="replied">Replied</NativeSelectOption>
            <NativeSelectOption value="escalated">Escalated</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
    </div>
  )
}

export function States() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="state-disabled">Google account</Label>
        <NativeSelect id="state-disabled" className="w-full" defaultValue="lapen" disabled>
          <NativeSelectOption value="lapen">Lapen Inns Group</NativeSelectOption>
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          Disabled — only one account is connected.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="state-invalid">Reply template</Label>
        <NativeSelect id="state-invalid" className="w-full" defaultValue="" aria-invalid>
          <NativeSelectOption value="">Select a template…</NativeSelectOption>
          <NativeSelectOption value="warm">Warm and personal</NativeSelectOption>
          <NativeSelectOption value="formal">Formal brand voice</NativeSelectOption>
        </NativeSelect>
        <p className="text-sm text-destructive">Pick a template before publishing.</p>
      </div>
    </div>
  )
}
