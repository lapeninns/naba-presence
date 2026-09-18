"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { ClientSelect } from "@/components/performance/client-select"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"
import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"
import { KeywordsTab } from "@/components/performance/keywords-tab"

const TABS = [
  { value: "reply", label: "Reply performance", compactLabel: "Replies" },
  { value: "google", label: "Google performance", compactLabel: "Google" },
  { value: "keywords", label: "Keywords", compactLabel: "Keywords" },
] as const

type TabValue = (typeof TABS)[number]["value"]

function isTab(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value)
}

/**
 * Three reports, each its own section with its own range, so these stay Tabs
 * rather than a segmented control: they are not three views of one dataset.
 */
export function PerformanceView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("tab")
  const active: TabValue = isTab(param) ? param : "reply"
  const clientId = searchParams.get("clientId") ?? undefined

  function replaceParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function selectTab(next: string) {
    replaceParams((params) => {
      if (next === "reply") params.delete("tab")
      else params.set("tab", next)
    })
  }

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {/* The client scope belongs above the tabs: it applies to all three, and
          picking it per tab would let two of them disagree about whose numbers
          are on screen. */}
      <div className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad) sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-ui font-medium text-ink">Reporting scope</p>
          <p className="text-caption text-ink-muted">
            Choose the client whose performance you want to review.
          </p>
        </div>
        <ClientSelect
          value={clientId}
          onChange={(next) =>
            replaceParams((params) => {
              if (next) params.set("clientId", next)
              else params.delete("clientId")
            })
          }
        />
      </div>
      <Tabs value={active} onValueChange={selectTab}>
        {/* `fill`: three equal columns on a phone, the ordinary row from
            `sm`. The rule now lives on TabsList, so any short tab row gets
            the same narrow-screen behaviour without restating it. */}
        <TabsList fill>
          {TABS.map((tab) => (
            <TabsTab key={tab.value} value={tab.value} aria-label={tab.label}>
              <span className="sm:hidden">{tab.compactLabel}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="reply">
          <ReplyPerformanceTab clientId={clientId} />
        </TabsPanel>
        <TabsPanel value="google">
          <GooglePerformanceTab clientId={clientId} />
        </TabsPanel>
        <TabsPanel value="keywords">
          <KeywordsTab clientId={clientId} />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
