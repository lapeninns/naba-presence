"use client"

import { AnalyticsView } from "@/components/naba-presence/analytics-view"
import { PresenceAnalyticsView } from "@/components/naba-presence/presence-analytics-view"
import { PageFrame, PageHeader } from "@/components/naba-presence/shared"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

export function PerformanceView() {
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
          <PresenceAnalyticsView />
        </TabsContent>
      </Tabs>
    </PageFrame>
  )
}
