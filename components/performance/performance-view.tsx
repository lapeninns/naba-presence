"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"
import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"
import { KeywordsTab } from "@/components/performance/keywords-tab"

const TABS = [
  { value: "reply", label: "Reply performance" },
  { value: "google", label: "Google performance" },
  { value: "keywords", label: "Keywords" },
] as const

type TabValue = (typeof TABS)[number]["value"]

function isTab(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value)
}

export function PerformanceView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("tab")
  const active: TabValue = isTab(param) ? param : "reply"

  function selectTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "reply") params.delete("tab")
    else params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <Tabs value={active} onValueChange={selectTab}>
      <TabsList>
        {TABS.map((tab) => (
          <TabsTab key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTab>
        ))}
      </TabsList>
      <TabsPanel value="reply">
        <ReplyPerformanceTab />
      </TabsPanel>
      <TabsPanel value="google">
        <GooglePerformanceTab />
      </TabsPanel>
      <TabsPanel value="keywords">
        <KeywordsTab />
      </TabsPanel>
    </Tabs>
  )
}
