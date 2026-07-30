"use client"

import { AnalyticsView } from "@/components/naba-presence/analytics-view"
import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { PageFrame, PageHeader } from "@/components/naba-presence/shared"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

export function PerformanceView({
  googlePerformanceEnabled,
}: {
  googlePerformanceEnabled: boolean
}) {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Performance"
        description="Reply operations today, and Google presence metrics once ingestion is enabled."
      />
      <Tabs defaultValue="reply">
        <TabsList>
          <TabsTrigger value="reply" className="text-foreground">
            Reply performance
          </TabsTrigger>
          <TabsTrigger value="google" className="text-foreground">
            Google performance
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reply">
          <AnalyticsView />
        </TabsContent>
        <TabsContent value="google">
          <CapabilityPlaceholder
            capability="Google performance"
            flag="GBP_PERFORMANCE_ENABLED"
            enabled={googlePerformanceEnabled}
            description="Impressions, searches, calls, direction requests, and website clicks from the Business Profile Performance API."
          />
        </TabsContent>
      </Tabs>
    </PageFrame>
  )
}
