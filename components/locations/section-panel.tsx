"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Empty } from "@/components/ui/empty"

// One sub-resource of the industry/administration GET is a { data, error } pair.
// A failing sub-resource shows its own honest panel (never the raw Google error
// string, per §7); an empty one shows a "nothing set" note; otherwise its editor.
export function SectionPanel({
  title, result, children,
}: {
  title: string
  result: { data: unknown; error: string | null }
  children: (data: unknown) => React.ReactNode
}) {
  if (result.error) {
    return (
      <Alert variant="warning">
        <AlertDescription>We couldn&apos;t load {title.toLowerCase()} from Google right now. Try refreshing in a moment.</AlertDescription>
      </Alert>
    )
  }
  if (result.data == null) {
    return <Empty title={`No ${title.toLowerCase()} set`} description="There is nothing to manage here yet." />
  }
  return <>{children(result.data)}</>
}
