import { Toggle } from "NabaReview"
import { Bold, Italic, Link2, Sparkles, Star, Underline } from "lucide-react"

export function ReplyFormatting() {
  return (
    <div className="flex w-fit items-center gap-0.5 rounded-2xl border border-border bg-card p-1">
      <Toggle defaultPressed aria-label="Bold">
        <Bold />
      </Toggle>
      <Toggle aria-label="Italic">
        <Italic />
      </Toggle>
      <Toggle aria-label="Underline">
        <Underline />
      </Toggle>
      <Toggle aria-label="Insert booking link">
        <Link2 />
      </Toggle>
      <Toggle defaultPressed aria-label="Suggested reply">
        <Sparkles />
      </Toggle>
    </div>
  )
}

export function QueueFilters() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle variant="outline" defaultPressed>
        <Star data-icon="inline-start" className="fill-rating text-rating" />
        5 stars
      </Toggle>
      <Toggle variant="outline">Awaiting reply</Toggle>
      <Toggle variant="outline">Has photos</Toggle>
      <Toggle variant="outline" defaultPressed>
        Riverside
      </Toggle>
    </div>
  )
}

export function Variants() {
  return (
    <div className="flex flex-wrap items-end gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">default · off</span>
        <Toggle>Awaiting reply</Toggle>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">default · pressed</span>
        <Toggle defaultPressed>Awaiting reply</Toggle>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">outline · off</span>
        <Toggle variant="outline">Awaiting reply</Toggle>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">outline · pressed</span>
        <Toggle variant="outline" defaultPressed>
          Awaiting reply
        </Toggle>
      </div>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle variant="outline" size="sm" defaultPressed>
        sm
      </Toggle>
      <Toggle variant="outline" size="default" defaultPressed>
        default
      </Toggle>
      <Toggle variant="outline" size="lg" defaultPressed>
        lg
      </Toggle>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle variant="outline" disabled>
        Awaiting reply
      </Toggle>
      <Toggle variant="outline" disabled defaultPressed>
        Riverside
      </Toggle>
      <Toggle disabled aria-label="Bold">
        <Bold />
      </Toggle>
    </div>
  )
}
