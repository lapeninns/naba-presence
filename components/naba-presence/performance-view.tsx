"use client"

import { AnalyticsView } from "@/components/naba-presence/analytics-view"
import {
  EmptyData,
  PageFrame,
  PageHeader,
} from "@/components/naba-presence/shared"
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
          <EmptyData
            message={
              googlePerformanceEnabled
                ? "Google performance ingestion is enabled, but this view has not shipped yet."
                : "Google performance ingestion is not enabled yet."
            }
          />
        </TabsContent>
      </Tabs>
    </PageFrame>
  )
}
