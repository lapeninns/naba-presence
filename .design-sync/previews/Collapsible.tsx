import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Switch,
} from "NabaReview"
import { ChevronDownIcon, ChevronUpIcon, CornerDownRight, Star } from "lucide-react"

// The DS ships Collapsible unstyled (three bare Base UI parts), so a preview has
// to supply the shell. The chevron pair is the same trick accordion.tsx uses:
// Base UI puts aria-expanded on the trigger, so the open/closed icons swap
// without any JS.
function DisclosureChevron() {
  return (
    <>
      <ChevronDownIcon className="size-4 group-aria-expanded/accordion-trigger:hidden" />
      <ChevronUpIcon className="hidden size-4 group-aria-expanded/accordion-trigger:inline" />
    </>
  )
}

function OptionRow({
  label,
  hint,
  defaultChecked,
}: {
  label: string
  hint: string
  defaultChecked?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  )
}

export function AdvancedSyncOptions() {
  return (
    <Collapsible
      defaultOpen
      className="w-full max-w-md rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-foreground">
            Google Business Profile sync
          </span>
          <span className="text-xs text-muted-foreground">
            Central &middot; last run <span className="font-mono">09:41</span>
          </span>
        </div>
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="sm" className="group/accordion-trigger" />
          }
        >
          Advanced
          <DisclosureChevron />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
        <OptionRow
          label="Pull unreplied reviews only"
          hint="Skips reviews already answered in Google's own console."
          defaultChecked
        />
        <OptionRow
          label="Import star-only ratings"
          hint="Ratings with no written text still count toward the average."
          defaultChecked
        />
        <OptionRow
          label="Retry failed pulls"
          hint="Up to 3 attempts before the location is marked stale."
        />
        <p className="text-xs text-muted-foreground">
          Changes apply at the next scheduled run. Retention is capped at 24 months.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ReviewThread() {
  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Priya Sharma</span>
        <span className="inline-flex items-center gap-0.5" aria-label="5 of 5 stars">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} aria-hidden className="size-3.5 fill-rating text-rating" />
          ))}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">Riverside</span>
      </div>
      <p className="mt-2 text-sm text-foreground">
        Late check-in was handled without a fuss and the river-side room was exactly what the
        photos promised.
      </p>

      <Collapsible defaultOpen className="mt-3 border-t border-border pt-3">
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="sm" className="group/accordion-trigger" />
          }
        >
          3 earlier replies
          <DisclosureChevron />
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3 flex flex-col gap-3 border-l border-border pl-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CornerDownRight className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Lena Fischer</span>
              <span className="font-mono text-[11px] text-muted-foreground">12 Apr</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Thank you, Priya — I passed this to the night team who checked you in.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CornerDownRight className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Priya Sharma</span>
              <span className="font-mono text-[11px] text-muted-foreground">13 Apr</span>
            </div>
            <p className="text-sm text-muted-foreground">
              One note — the lift was out on the Saturday morning.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CornerDownRight className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Lena Fischer</span>
              <span className="font-mono text-[11px] text-muted-foreground">13 Apr</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Noted and logged with maintenance — the service contract has been re-scoped.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function ClosedAndOpen() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Collapsible className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">Airport</span>
            <span className="text-xs text-muted-foreground">Collapsed &mdash; defaults</span>
          </div>
          <CollapsibleTrigger
            render={
              <Button variant="outline" size="sm" className="group/accordion-trigger" />
            }
          >
            Details
            <DisclosureChevron />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          Hourly sync, replies owned by Marco Silva.
        </CollapsibleContent>
      </Collapsible>

      <Collapsible defaultOpen className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">Riverside</span>
            <span className="text-xs text-muted-foreground">Expanded &mdash; overridden</span>
          </div>
          <CollapsibleTrigger
            render={
              <Button variant="outline" size="sm" className="group/accordion-trigger" />
            }
          >
            Details
            <DisclosureChevron />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Sync interval</span>
            <span className="font-mono">15 min</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Escalation</span>
            <Badge variant="secondary">Duty manager</Badge>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
