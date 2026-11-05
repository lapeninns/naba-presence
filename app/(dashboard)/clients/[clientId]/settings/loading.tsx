import {
  SettingsHeaderSkeleton,
  SettingsSkeleton,
} from "@/components/clients/client-settings"

// Without this file the settings page streams in behind the hub's skeleton
// (the parent segment's loading.tsx) and then jumps to a narrower form. A
// plain `div`, not `PageFrame`, so there is still only one `<main>`:
// `PageFrame`'s default gutters and max width around the header outline and
// the settings body's own loading shape.
export default function Loading() {
  return (
    <div className="@container mx-auto flex w-full max-w-(--np-page-default-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)">
      <SettingsHeaderSkeleton />
      <SettingsSkeleton />
    </div>
  )
}
