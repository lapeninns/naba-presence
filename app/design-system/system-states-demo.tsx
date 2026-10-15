import { SupportDetails } from "@/components/editors/support-details"
import { Card, CardContent } from "@/components/ui/card"
import { QueryPending } from "@/components/ui/query-states"

/**
 * System states: a pending state draws exactly ONE loading indicator, and a
 * system page folds the machine detail (the address they asked for) behind
 * "Details for support" instead of printing it.
 */
export function SystemStatesDemo() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="gap-2.5" aria-busy="true">
        <CardContent>
          <p className="mb-2 text-caption text-ink-muted">
            Rows at the content&rsquo;s height: the sentence, no spinner
          </p>
          <QueryPending label="Loading reviews…" />
        </CardContent>
      </Card>
      <Card className="gap-2.5" aria-busy="true">
        <CardContent>
          <p className="mb-2 text-caption text-ink-muted">
            No rows to stand in: the sentence and the spinner
          </p>
          <QueryPending label="Checking the connection…" skeleton={null} />
        </CardContent>
      </Card>
      <Card className="gap-2.5" aria-busy="true">
        <CardContent>
          <p className="mb-2 text-caption text-ink-muted">
            Machine detail behind a disclosure
          </p>
          <SupportDetails
            items={["/clients/00000000-0000-4000-8000-000000000000"]}
          />
        </CardContent>
      </Card>
    </div>
  )
}
