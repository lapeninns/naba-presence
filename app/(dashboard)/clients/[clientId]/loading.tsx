import { HubSkeleton } from "@/components/clients/client-hub"

// A plain `div`, not `PageFrame`: the hub owns the one `<main>` once it has
// streamed in. The same paddings and width as the hub's `PageFrame`, and the
// hub's own loading shape, the one it draws while its query is pending, so
// the swap from this to the hub's pending state does not jump.
export default function Loading() {
  return (
    <div className="@container mx-auto flex w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)">
      <HubSkeleton />
    </div>
  )
}
