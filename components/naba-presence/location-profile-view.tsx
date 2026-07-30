"use client"

import { useEffect, useState } from "react"

import { formatStorefrontAddress } from "@/components/naba-presence/locations-index-view"
import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type InternalLocation,
  loadInternalLocations,
} from "@/lib/naba-presence-api"

export function LocationProfileView({ locationId }: { locationId: string }) {
  const [location, setLocation] = useState<InternalLocation | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void loadInternalLocations()
      .then(({ locations }) => {
        if (!active) return
        setLocation(
          locations.find((item) => item.locationId === locationId) ?? null
        )
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [locationId, reloadKey])

  if (status === "error") {
    return (
      <LiveDataError
        onRetry={() => {
          setStatus("loading")
          setReloadKey((value) => value + 1)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-(--nr-gap-section)">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Identity NabaPresence currently stores for this location
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {status === "loading" ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : (
            <>
              <ProfileField label="Name" value={location?.name ?? "—"} />
              <ProfileField
                label="Google title"
                value={location?.googleTitle ?? "—"}
              />
              <ProfileField
                label="Address"
                value={formatStorefrontAddress(location?.address ?? null)}
              />
              <ProfileField
                label="Timezone"
                value={location?.timezone ?? "—"}
              />
              <ProfileField
                label="Google resource"
                value={location?.googleLocationName ?? "Not linked"}
              />
              <ProfileField
                label="Verified"
                value={
                  location?.verified === null || location === null
                    ? "—"
                    : location.verified
                      ? "Yes"
                      : "No"
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>Editing is not available yet</AlertTitle>
        <AlertDescription>
          Description, website, phone, categories, and hours are not stored
          durably yet. Editing this location&apos;s Google profile from
          NabaPresence arrives with the profile dual-sync workstream; until
          then, change these in Google Business Profile.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words text-sm font-medium">{value}</span>
    </div>
  )
}
