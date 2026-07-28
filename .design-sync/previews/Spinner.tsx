import { Button, Spinner } from "NabaReview"
import { CheckCircle2, Clock } from "lucide-react"

export function Default() {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      Syncing reviews…
    </span>
  )
}

export function InButton() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>
        <Spinner data-icon="inline-start" />
        Publishing reply…
      </Button>
      <Button variant="outline" disabled>
        <Spinner data-icon="inline-start" />
        Importing
      </Button>
      <Button variant="ghost" size="sm" disabled>
        <Spinner data-icon="inline-start" />
        Verifying
      </Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-end gap-6">
      {[
        { cls: "size-3", label: "12" },
        { cls: "size-4", label: "16" },
        { cls: "size-6", label: "24" },
        { cls: "size-8", label: "32" },
      ].map((s) => (
        <div key={s.label} className="flex flex-col items-center gap-2">
          <Spinner className={s.cls} />
          <span className="font-mono text-xs text-muted-foreground">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

export function LoadingPanel() {
  return (
    <div className="flex max-w-md flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card p-6 text-center">
      <Spinner className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Importing reviews from Google Business Profile…
      </p>
      <p className="font-mono text-xs text-muted-foreground">412 of 1,280</p>
    </div>
  )
}

export function InlineStatus() {
  return (
    <div className="flex max-w-md flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-success" />
        <span className="font-medium">Lapen Inn Central</span>
        <span className="ml-auto text-xs text-muted-foreground">Synced 4m ago</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Spinner className="text-primary" />
        <span className="font-medium">Lapen Inn Riverside</span>
        <span className="ml-auto text-xs text-muted-foreground">Syncing…</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Clock className="size-4 text-muted-foreground" />
        <span className="font-medium">Lapen Inn Airport</span>
        <span className="ml-auto text-xs text-muted-foreground">Queued</span>
      </div>
    </div>
  )
}
