import { Button } from "NabaReview"
import { Check, Download, Plus, Reply, Trash2 } from "lucide-react"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Post reply</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="outline">Preview</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete review</Button>
      <Button variant="link">View on Google</Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">xs</Button>
      <Button size="sm">sm</Button>
      <Button size="default">default</Button>
      <Button size="lg">lg</Button>
    </div>
  )
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <Reply />
        Reply
      </Button>
      <Button variant="outline">
        <Download />
        Export CSV
      </Button>
      <Button variant="secondary">
        Mark handled
        <Check />
      </Button>
      <Button variant="destructive">
        <Trash2 />
        Delete
      </Button>
    </div>
  )
}

export function IconOnly() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-xs" aria-label="Add location">
        <Plus />
      </Button>
      <Button size="icon-sm" variant="outline" aria-label="Reply">
        <Reply />
      </Button>
      <Button size="icon" variant="ghost" aria-label="Export">
        <Download />
      </Button>
      <Button size="icon-lg" variant="secondary" aria-label="Delete">
        <Trash2 />
      </Button>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Post reply</Button>
      <Button variant="outline" disabled>
        Preview
      </Button>
      <Button variant="destructive" disabled>
        Delete review
      </Button>
    </div>
  )
}
