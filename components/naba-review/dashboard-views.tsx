"use client"

import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  Link2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Unplug,
} from "lucide-react"
import { useEffect, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  beginGoogleConnect,
  activateGoogleAccounts,
  addMember,
  type BackfillProgress,
  cancelBackfill,
  configureGoogleNotifications,
  createPrivacyRequest,
  disconnectGoogle,
  discoverGoogleAccounts,
  discoverGoogleLocations,
  type GoogleAccount,
  type GoogleConnection,
  type GoogleLocation,
  linkGoogleLocation,
  loadBackfillProgress,
  loadConnections,
  loadInternalLocations,
  loadMembers,
  loadSettings,
  type InternalLocation,
  type OrganisationMember,
  type OrganisationSettings,
  runBackfill,
  saveLocationAssignments,
  saveSettings,
  updateMember,
} from "@/lib/naba-review-api"
import { LiveDataError } from "@/components/naba-review/shared"

function readControlValue(event: { currentTarget: unknown }) {
  return (event.currentTarget as { value: string }).value
}

function formatAddress(
  address: GoogleLocation["storefrontAddress"] | null | undefined
) {
  if (!address) return ""
  return [
    ...(address.addressLines ?? []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(", ")
}

function formatGoogleAddress(location: GoogleLocation) {
  return formatAddress(location.storefrontAddress)
}

function isLocationCandidate(
  googleLocation: GoogleLocation,
  internalLocation: InternalLocation
) {
  const titleMatch =
    internalLocation.name.trim().toLowerCase() ===
    (googleLocation.title ?? googleLocation.name).trim().toLowerCase()
  const googleAddress = formatAddress(googleLocation.storefrontAddress)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
  const internalAddress = formatAddress(internalLocation.address)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
  return (
    titleMatch ||
    (Boolean(googleAddress) &&
      Boolean(internalAddress) &&
      googleAddress === internalAddress)
  )
}

export function ConnectionsView({ onNavigate }: { onNavigate?: () => void }) {
  const [connections, setConnections] = useState<GoogleConnection[]>([])
  const [locations, setLocations] = useState<GoogleLocation[]>([])
  const [accounts, setAccounts] = useState<GoogleAccount[]>([])
  const [backfillProgress, setBackfillProgress] =
    useState<BackfillProgress | null>(null)
  const [settings, setSettings] = useState<OrganisationSettings | null>(null)
  const [internalLocations, setInternalLocations] = useState<
    InternalLocation[]
  >([])
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({})
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([])
  const [locationQuery, setLocationQuery] = useState("")
  const [verificationFilter, setVerificationFilter] = useState("all")
  const [pubsubTopic, setPubsubTopic] = useState("")
  const [message, setMessage] = useState("")
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading")
  const [isPending, startTransition] = useTransition()
  const connection =
    connections.find((item) => item.status === "active") ?? connections[0]
  const linkedExternalIds = new Set(
    internalLocations
      .map((location) => location.externalLocationId)
      .filter((id): id is string => Boolean(id))
  )
  const activeAccount = accounts.find((account) => account.isActive)
  const importItems = backfillProgress?.items ?? []
  const importComplete =
    linkedExternalIds.size > 0 &&
    importItems.length > 0 &&
    importItems.every((item) => item.status === "succeeded")
  const setupComplete =
    connection?.status === "active" &&
    Boolean(activeAccount) &&
    linkedExternalIds.size > 0 &&
    importComplete &&
    Boolean(settings)

  useEffect(() => {
    let active = true
    async function loadConnectionWorkspace() {
      try {
        const [
          connectionResult,
          locationResult,
          backfillResult,
          settingsResult,
        ] = await Promise.all([
          loadConnections(),
          loadInternalLocations(),
          loadBackfillProgress(),
          loadSettings(),
        ])
        if (!active) return
        setConnections(connectionResult.connections)
        setInternalLocations(locationResult.locations)
        setBackfillProgress(backfillResult.progress)
        setSettings(settingsResult.settings)
        setLoadState("ready")

        const activeConnection = connectionResult.connections.find(
          (item) => item.status === "active"
        )
        if (activeConnection) {
          try {
            const accountResult = await discoverGoogleAccounts()
            if (!active) return
            setAccounts(accountResult.accounts)
            if (accountResult.accounts.some((account) => account.isActive)) {
              const locationDiscovery = await discoverGoogleLocations()
              if (!active) return
              setLocations(locationDiscovery.locations)
              const alreadyLinked = new Set(
                locationResult.locations
                  .map((location) => location.externalLocationId)
                  .filter((id): id is string => Boolean(id))
              )
              setSelectedLocationIds(
                locationDiscovery.locations
                  .filter(
                    (location) =>
                      location.verified && !alreadyLinked.has(location.id)
                  )
                  .map((location) => location.id)
              )
            }
          } catch (error) {
            if (!active) return
            setMessage(
              error instanceof Error
                ? `Your connection is saved, but Google discovery needs attention: ${error.message}`
                : "Your connection is saved, but Google discovery could not refresh."
            )
          }
        }
      } catch (error) {
        if (!active) return
        setLoadState("unavailable")
        setMessage(
          error instanceof Error
            ? error.message
            : "Connection setup is temporarily unavailable."
        )
      }
    }
    void loadConnectionWorkspace()
    return () => {
      active = false
    }
  }, [])

  function connect() {
    setMessage("")
    startTransition(async () => {
      try {
        const { authorizationUrl } = await beginGoogleConnect()
        window.location.assign(authorizationUrl)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Connect failed.")
      }
    })
  }

  function discover() {
    setMessage("")
    startTransition(async () => {
      try {
        if (!accounts.length) {
          const result = await discoverGoogleAccounts()
          setAccounts(result.accounts)
          const firstAccount = result.accounts[0]
          if (result.accounts.length === 1 && firstAccount?.id) {
            const activated = await activateGoogleAccounts([firstAccount.id])
            setAccounts(activated.accounts)
            const discovered = await discoverGoogleLocations()
            setLocations(discovered.locations)
            setSelectedLocationIds(
              discovered.locations
                .filter(
                  (location) =>
                    location.verified && !linkedExternalIds.has(location.id)
                )
                .map((location) => location.id)
            )
            setMessage("Google account found. Choose the locations to import.")
          } else {
            setMessage(
              `${result.accounts.length} Google account${result.accounts.length === 1 ? "" : "s"} found. Choose the account this workspace should use.`
            )
          }
          return
        }
        const result = await discoverGoogleLocations()
        setLocations(result.locations)
        setSelectedLocationIds(
          result.locations
            .filter(
              (location) =>
                location.verified && !linkedExternalIds.has(location.id)
            )
            .map((location) => location.id)
        )
        setMessage(
          `${result.locations.length} Google location${result.locations.length === 1 ? "" : "s"} found.`
        )
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Discovery failed.")
      }
    })
  }

  function toggleAccount(account: GoogleAccount) {
    setMessage("")
    startTransition(async () => {
      try {
        const activeIds = accounts
          .filter((item) =>
            item.id === account.id ? !item.isActive : item.isActive
          )
          .map((item) => item.id)
        const result = await activateGoogleAccounts(activeIds)
        setAccounts(result.accounts)
        setLocations([])
        setMessage(
          activeIds.length
            ? "Account selected. We’ll now find its locations."
            : "No Google accounts are active."
        )
        if (activeIds.length) {
          const discovered = await discoverGoogleLocations()
          setLocations(discovered.locations)
          setSelectedLocationIds(
            discovered.locations
              .filter(
                (location) =>
                  location.verified && !linkedExternalIds.has(location.id)
              )
              .map((location) => location.id)
          )
        }
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Account selection failed."
        )
      }
    })
  }

  function configureNotifications() {
    const activeAccount = accounts.find((account) => account.isActive)
    if (!activeAccount) {
      setMessage("Activate a Google account before configuring notifications.")
      return
    }
    setMessage("")
    startTransition(async () => {
      try {
        await configureGoogleNotifications(activeAccount.id, pubsubTopic)
        setConnections(
          (current) =>
            current?.map((item) =>
              item.id === connection?.id
                ? {
                    ...item,
                    notificationsEnabled: Boolean(pubsubTopic),
                  }
                : item
            ) ?? []
        )
        setMessage(
          pubsubTopic
            ? "NEW_REVIEW and UPDATED_REVIEW notifications enabled."
            : "Google notifications disabled."
        )
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Notification configuration failed."
        )
      }
    })
  }

  function importSelectedLocations() {
    const selectedLocations = locations.filter((location) =>
      selectedLocationIds.includes(location.id)
    )
    if (!selectedLocations.length) {
      setMessage("Choose at least one verified location to continue.")
      return
    }
    setMessage("")
    startTransition(async () => {
      try {
        let latestProgress = backfillProgress
        for (const location of selectedLocations) {
          const locationId = linkTargets[location.id] || undefined
          const confirmRelink = locationId
            ? window.confirm(
                `Use the existing “${internalLocations.find((item) => item.locationId === locationId)?.name ?? "location"}” record for ${location.title ?? location.name}?`
              )
            : false
          if (locationId && !confirmRelink) continue
          await linkGoogleLocation(location, { locationId, confirmRelink })
          const backfill = await runBackfill(location.id)
          latestProgress = backfill.progress
        }
        if (latestProgress) setBackfillProgress(latestProgress)
        const refreshed = await loadInternalLocations()
        setInternalLocations(refreshed.locations)
        setSelectedLocationIds([])
        setMessage(
          `${selectedLocations.length} location${selectedLocations.length === 1 ? "" : "s"} linked. Historical reviews are importing now.`
        )
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Import failed.")
      }
    })
  }

  function continueBackfill(externalLocationId: string) {
    setMessage("")
    startTransition(async () => {
      try {
        const result = await runBackfill(externalLocationId)
        setBackfillProgress(result.progress)
        setMessage(
          result.batches.every((batch) => batch.complete)
            ? "Historical review import complete."
            : "Another batch was imported. Continue when you’re ready."
        )
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Import could not continue."
        )
      }
    })
  }

  function cancelBackfillContinuation(externalLocationId: string) {
    setMessage("")
    startTransition(async () => {
      try {
        const result = await cancelBackfill(externalLocationId)
        setBackfillProgress(result.progress)
        setMessage("Historical import paused. You can resume it later.")
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Import could not be paused."
        )
      }
    })
  }

  function disconnect() {
    if (!connection) return
    setMessage("")
    startTransition(async () => {
      try {
        await disconnectGoogle(connection.id)
        setConnections(
          (current) =>
            current?.map((item) =>
              item.id === connection.id
                ? { ...item, status: "disconnected" }
                : item
            ) ?? []
        )
        setMessage(
          "Google disconnected. Policy cleanup is scheduled within 7 days."
        )
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Disconnect failed."
        )
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-5 py-7 md:px-8 md:py-9">
      <div className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          Merchant setup
        </Badge>
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          {setupComplete
            ? "Google Business Profile"
            : "Connect Google Business Profile"}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {setupComplete
            ? "Your locations, review history, and reply policy are ready."
            : "Set up your review workspace in a few guided steps. You stay in control of every location we import."}
        </p>
      </div>

      <SetupProgress
        connected={connection?.status === "active"}
        locationsChosen={linkedExternalIds.size > 0}
        importComplete={importComplete}
        policyReady={Boolean(settings) && importComplete}
      />

      {loadState === "loading" ? (
        <ConnectionSetupSkeleton />
      ) : loadState === "unavailable" ? (
        <Alert variant="destructive">
          <Info />
          <AlertTitle>We couldn’t load connection setup</AlertTitle>
          <AlertDescription>
            {message || "Refresh the page to try again."}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Link2 className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate">
                      {connection?.googleEmail ?? "Connect your Google account"}
                    </CardTitle>
                    <CardDescription>
                      {connection
                        ? `Connected ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(connection.createdAt))}`
                        : "Use the Google account that manages your Business Profile."}
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant={
                    connection?.reconnectRequired ? "destructive" : "secondary"
                  }
                >
                  {connection?.reconnectRequired
                    ? "Reconnect"
                    : connection?.status === "active"
                      ? "Connected"
                      : "Not connected"}
                </Badge>
              </CardHeader>
              {!connection ? (
                <CardFooter>
                  <Button onClick={connect} disabled={isPending}>
                    {isPending ? <Spinner /> : <ExternalLink />}
                    Connect Google
                  </Button>
                </CardFooter>
              ) : null}
            </Card>

            {connection ? (
              <Card>
                <CardHeader>
                  <CardTitle>Choose your Google account</CardTitle>
                  <CardDescription>
                    Only locations owned or managed by the active account can be
                    imported.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {accounts.length ? (
                    accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                          <Building2 className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {account.accountName ?? account.googleAccountName}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {account.googleAccountName}
                            {account.role ? ` · ${account.role}` : ""}
                          </p>
                        </div>
                        <Button
                          variant={account.isActive ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => toggleAccount(account)}
                          disabled={isPending}
                          aria-pressed={account.isActive}
                        >
                          {account.isActive ? (
                            <CheckCircle2 data-icon="inline-start" />
                          ) : null}
                          {account.isActive ? "Selected" : "Use account"}
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5">
                      <p className="text-sm font-medium">
                        No Google Business accounts found yet
                      </p>
                      <p className="text-sm text-muted-foreground">
                        We’ll check the connected Google account for profiles
                        you can manage.
                      </p>
                      <Button
                        variant="outline"
                        onClick={discover}
                        disabled={isPending}
                      >
                        {isPending ? <Spinner /> : <RefreshCw />}
                        Find my accounts
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {activeAccount ? (
              <Card>
                <CardHeader>
                  <CardTitle>Choose locations to import</CardTitle>
                  <CardDescription>
                    Verified locations can sync reviews and publish approved
                    replies. Existing links are kept intact.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                  {locations.length ? (
                    <>
                      <div className="grid gap-2 border-b pb-4 sm:grid-cols-[1fr_180px]">
                        <Input
                          value={locationQuery}
                          onChange={(event) =>
                            setLocationQuery(readControlValue(event))
                          }
                          placeholder="Search locations"
                          aria-label="Search Google locations"
                        />
                        <NativeSelect
                          value={verificationFilter}
                          onValueChange={setVerificationFilter}
                          aria-label="Filter by verification state"
                        >
                          <NativeSelectOption value="all">
                            All locations
                          </NativeSelectOption>
                          <NativeSelectOption value="verified">
                            Verified
                          </NativeSelectOption>
                          <NativeSelectOption value="unverified">
                            Needs verification
                          </NativeSelectOption>
                        </NativeSelect>
                      </div>
                      {locations
                        .filter((location) => {
                          const matchesText = (location.title ?? location.name)
                            .toLowerCase()
                            .includes(locationQuery.trim().toLowerCase())
                          const matchesVerification =
                            verificationFilter === "all" ||
                            (verificationFilter === "verified"
                              ? location.verified
                              : !location.verified)
                          return matchesText && matchesVerification
                        })
                        .map((location, index) => {
                          const isLinked = linkedExternalIds.has(location.id)
                          const isSelected = selectedLocationIds.includes(
                            location.id
                          )
                          return (
                            <div key={location.id}>
                              {index ? <Separator /> : null}
                              <div className="flex gap-3 py-4">
                                <Checkbox
                                  className="mt-1"
                                  checked={isLinked || isSelected}
                                  disabled={isLinked || !location.verified}
                                  onCheckedChange={(checked) =>
                                    setSelectedLocationIds((current) =>
                                      checked
                                        ? [...current, location.id]
                                        : current.filter(
                                            (id) => id !== location.id
                                          )
                                    )
                                  }
                                  aria-label={`Select ${location.title ?? location.name}`}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium">
                                      {location.title ?? location.name}
                                    </p>
                                    <Badge
                                      variant={
                                        location.verified
                                          ? "secondary"
                                          : "outline"
                                      }
                                    >
                                      {isLinked
                                        ? "Imported"
                                        : location.verified
                                          ? "Verified"
                                          : "Verification required"}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {formatGoogleAddress(location) ||
                                      location.accountName}
                                  </p>
                                  {!isLinked && location.verified ? (
                                    <NativeSelect
                                      className="mt-3 max-w-sm"
                                      value={linkTargets[location.id] ?? ""}
                                      onValueChange={(value) =>
                                        setLinkTargets((current) => ({
                                          ...current,
                                          [location.id]: value,
                                        }))
                                      }
                                      aria-label={`Workspace location for ${location.title ?? location.name}`}
                                    >
                                      <NativeSelectOption value="">
                                        Create a new workspace location
                                      </NativeSelectOption>
                                      {internalLocations
                                        .filter(
                                          (internal) =>
                                            !internal.externalLocationId
                                        )
                                        .map((internal) => (
                                          <NativeSelectOption
                                            key={internal.locationId}
                                            value={internal.locationId}
                                          >
                                            {internal.name}
                                            {isLocationCandidate(
                                              location,
                                              internal
                                            )
                                              ? " · suggested"
                                              : ""}
                                          </NativeSelectOption>
                                        ))}
                                    </NativeSelect>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                    </>
                  ) : (
                    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5">
                      <p className="text-sm font-medium">
                        No locations discovered
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Refresh after a profile is added or your Google access
                        changes.
                      </p>
                      <Button
                        variant="outline"
                        onClick={discover}
                        disabled={isPending}
                      >
                        {isPending ? <Spinner /> : <RefreshCw />}
                        Find locations
                      </Button>
                    </div>
                  )}
                </CardContent>
                {locations.length ? (
                  <CardFooter className="flex-col items-stretch justify-between gap-3 border-t sm:flex-row sm:items-center">
                    <p className="text-xs text-muted-foreground">
                      {selectedLocationIds.length
                        ? `${selectedLocationIds.length} verified location${selectedLocationIds.length === 1 ? "" : "s"} selected`
                        : linkedExternalIds.size
                          ? `${linkedExternalIds.size} location${linkedExternalIds.size === 1 ? "" : "s"} already imported`
                          : "Choose a verified location to continue"}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={discover}
                        disabled={isPending}
                      >
                        <RefreshCw data-icon="inline-start" />
                        Refresh
                      </Button>
                      {selectedLocationIds.length ? (
                        <Button
                          onClick={importSelectedLocations}
                          disabled={isPending}
                        >
                          {isPending ? <Spinner /> : <Download />}
                          Import reviews
                        </Button>
                      ) : null}
                    </div>
                  </CardFooter>
                ) : null}
              </Card>
            ) : null}

            {importItems.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Historical review import</CardTitle>
                  <CardDescription>
                    Imports run in safe batches so a large review history cannot
                    overwhelm the app.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col divide-y">
                  {importItems.map((item) => (
                    <div
                      key={item.externalLocationId}
                      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {item.locationName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.status === "succeeded"
                            ? "All available review pages imported"
                            : item.status === "failed"
                              ? `Needs attention${item.lastErrorCode ? ` · ${item.lastErrorCode}` : ""}`
                              : item.status === "cancelled"
                                ? "Paused"
                                : "More review pages are ready to import"}
                        </p>
                      </div>
                      <Badge
                        variant={
                          item.status === "failed" ? "destructive" : "secondary"
                        }
                      >
                        {item.status === "succeeded"
                          ? "Complete"
                          : item.status === "failed"
                            ? "Retry"
                            : item.status === "cancelled"
                              ? "Paused"
                              : "In progress"}
                      </Badge>
                      {item.status !== "succeeded" ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              continueBackfill(item.externalLocationId)
                            }
                            disabled={isPending}
                          >
                            {isPending ? <Spinner /> : <RefreshCw />}
                            Continue import
                          </Button>
                          {item.status !== "cancelled" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                cancelBackfillContinuation(
                                  item.externalLocationId
                                )
                              }
                              disabled={isPending}
                            >
                              Pause
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-6">
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle>
                  {setupComplete ? "Setup complete" : "What happens next"}
                </CardTitle>
                <CardDescription>
                  {setupComplete
                    ? "NabaReview is ready for your team."
                    : "A clear path from connection to the first reply."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <GuidanceItem
                  icon={ShieldCheck}
                  title="Your approval policy"
                  detail={
                    settings?.approvalRequired
                      ? "Every reply needs approval before publishing."
                      : "Approved team members can publish directly."
                  }
                />
                <GuidanceItem
                  icon={Download}
                  title="Historical reviews"
                  detail="Imported in small, resumable batches to protect performance."
                />
                <GuidanceItem
                  icon={Activity}
                  title="Ongoing sync"
                  detail={
                    connection?.notificationsEnabled
                      ? "Real-time Google notifications are active."
                      : "Scheduled sync keeps reviews current."
                  }
                />
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-2">
                {setupComplete ? (
                  <Button onClick={onNavigate}>
                    <Settings2 data-icon="inline-start" />
                    Review reply policy
                  </Button>
                ) : !connection ? (
                  <Button onClick={connect} disabled={isPending}>
                    {isPending ? <Spinner /> : <ExternalLink />}
                    Connect Google
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={onNavigate}>
                  Policy settings
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </CardFooter>
            </Card>

            {activeAccount ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Optional real-time notifications
                  </CardTitle>
                  <CardDescription>
                    Scheduled sync works without this. Teams with Google Cloud
                    Pub/Sub can add a topic later.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <Input
                    value={pubsubTopic}
                    onChange={(event) =>
                      setPubsubTopic(readControlValue(event))
                    }
                    placeholder="projects/…/topics/…"
                    aria-label="Google Pub/Sub topic"
                  />
                  <Button
                    variant="outline"
                    onClick={configureNotifications}
                    disabled={isPending}
                  >
                    Configure notifications
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}

      {message && loadState !== "unavailable" ? (
        <Alert>
          <Info />
          <AlertTitle>Setup update</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {connection ? (
        <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Connection management</p>
            <p className="text-xs text-muted-foreground">
              Reconnect after access changes, or disconnect to stop sync and
              publishing.
            </p>
          </div>
          <Button variant="outline" onClick={connect} disabled={isPending}>
            <ExternalLink data-icon="inline-start" />
            Reconnect
          </Button>
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={disconnect}
            disabled={isPending}
          >
            <Unplug data-icon="inline-start" />
            Disconnect
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function SetupProgress({
  connected,
  locationsChosen,
  importComplete,
  policyReady,
}: {
  connected: boolean
  locationsChosen: boolean
  importComplete: boolean
  policyReady: boolean
}) {
  const steps = [
    { label: "Connect Google", complete: connected },
    { label: "Choose locations", complete: locationsChosen },
    { label: "Import reviews", complete: importComplete },
    { label: "Set reply policy", complete: policyReady },
  ]
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => !step.complete)
  )
  return (
    <div className="grid gap-2 sm:grid-cols-4" aria-label="Setup progress">
      {steps.map((step, index) => {
        const isCurrent =
          !steps.every((item) => item.complete) && index === currentIndex
        return (
          <div
            key={step.label}
            className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3"
            aria-current={isCurrent ? "step" : undefined}
          >
            <span
              className={
                step.complete
                  ? "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                  : isCurrent
                    ? "flex size-7 shrink-0 items-center justify-center rounded-full border border-primary text-xs font-medium text-primary"
                    : "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground"
              }
            >
              {step.complete ? (
                <CheckCircle2 className="size-4" aria-hidden />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={
                isCurrent || step.complete
                  ? "text-xs font-medium"
                  : "text-xs text-muted-foreground"
              }
            >
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function GuidanceItem({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Activity
  title: string
  detail: string
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  )
}

function ConnectionSetupSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  )
}

export function SettingsView() {
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [retentionDays, setRetentionDays] = useState(30)
  const [defaultLanguage, setDefaultLanguage] = useState("en")
  const [defaultTimezone, setDefaultTimezone] = useState("Europe/London")
  const [directPublishConsent, setDirectPublishConsent] = useState(false)
  const [members, setMembers] = useState<OrganisationMember[]>([])
  const [internalLocations, setInternalLocations] = useState<
    InternalLocation[]
  >([])
  const [newMemberName, setNewMemberName] = useState("")
  const [newMemberEmail, setNewMemberEmail] = useState("")
  const [newMemberRole, setNewMemberRole] =
    useState<OrganisationMember["role"]>("member")
  const [privacySubject, setPrivacySubject] = useState("")
  const [privacyRequestType, setPrivacyRequestType] = useState<
    "access" | "rectification" | "erasure" | "restriction"
  >("access")
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()
  const [settingsStatus, setSettingsStatus] = useState<
    "loading" | "ready" | "error"
  >("loading")
  const [teamStatus, setTeamStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void loadSettings()
      .then(({ settings }) => {
        if (!active) return
        setApprovalRequired(settings.approvalRequired)
        setRetentionDays(settings.rawContentRetentionDays)
        setDefaultLanguage(settings.defaultLanguageCode)
        setDefaultTimezone(settings.defaultTimezone)
        setDirectPublishConsent(Boolean(settings.directPublishConsentAt))
        setSettingsStatus("ready")
      })
      .catch(() => {
        if (active) setSettingsStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  useEffect(() => {
    let active = true
    void Promise.all([loadMembers(), loadInternalLocations()])
      .then(([memberResult, locationResult]) => {
        if (!active) return
        setMembers(memberResult.members)
        setInternalLocations(locationResult.locations)
        setTeamStatus("ready")
      })
      .catch(() => {
        if (active) setTeamStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  function reloadSettings() {
    setSettingsStatus("loading")
    setTeamStatus("loading")
    setReloadKey((value) => value + 1)
  }

  if (settingsStatus !== "ready") {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-7 md:px-8 md:py-9">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
            Reply policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Human approval, verification and retention controls.
          </p>
        </div>
        {settingsStatus === "loading" ? (
          <>
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-64 w-full" />
          </>
        ) : (
          <LiveDataError onRetry={reloadSettings} />
        )}
      </div>
    )
  }

  function persistSettings() {
    setMessage("")
    startTransition(async () => {
      try {
        await saveSettings({
          approvalRequired,
          rawContentRetentionDays: retentionDays,
          defaultLanguageCode: defaultLanguage,
          defaultTimezone,
          directPublishConsent,
        })
        setMessage("Policy settings saved and added to the audit trail.")
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Save failed.")
      }
    })
  }

  function inviteMember() {
    setMessage("")
    startTransition(async () => {
      try {
        const { member } = await addMember({
          email: newMemberEmail,
          displayName: newMemberName,
          role: newMemberRole,
          canPublish: false,
        })
        setMembers((current) => [...current, { ...member, locations: [] }])
        setNewMemberName("")
        setNewMemberEmail("")
        setMessage("Member added. Their access change is in the audit trail.")
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Add member failed."
        )
      }
    })
  }

  function changeMember(
    member: OrganisationMember,
    patch: Pick<OrganisationMember, "role" | "canPublish">
  ) {
    setMessage("")
    startTransition(async () => {
      try {
        await updateMember({ userId: member.userId, ...patch })
        setMembers((current) =>
          current.map((item) =>
            item.userId === member.userId ? { ...item, ...patch } : item
          )
        )
        setMessage("Member role updated.")
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Update failed.")
      }
    })
  }

  function cycleLocationAccess(member: OrganisationMember, locationId: string) {
    const current = member.locations.find(
      (assignment) => assignment.locationId === locationId
    )
    const assignments = current
      ? current.canPublish || member.role === "viewer"
        ? member.locations.filter(
            (assignment) => assignment.locationId !== locationId
          )
        : member.locations.map((assignment) =>
            assignment.locationId === locationId
              ? { ...assignment, canPublish: true }
              : assignment
          )
      : [...member.locations, { locationId, canPublish: false }]
    setMessage("")
    startTransition(async () => {
      try {
        await saveLocationAssignments(member.userId, assignments)
        setMembers((items) =>
          items.map((item) =>
            item.userId === member.userId
              ? { ...item, locations: assignments }
              : item
          )
        )
        setMessage("Location permissions updated.")
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Update failed.")
      }
    })
  }

  function submitPrivacyRequest() {
    setMessage("")
    startTransition(async () => {
      try {
        await createPrivacyRequest({
          requestType: privacyRequestType,
          subjectReference: privacySubject,
          reason: "Submitted from the organisation compliance workspace.",
        })
        setMessage("Privacy request recorded in the immutable audit trail.")
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Privacy request failed."
        )
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-7 md:px-8 md:py-9">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Reply policy
        </h1>
        <p className="text-sm text-muted-foreground">
          Human approval, verification and retention controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Publishing safeguards</CardTitle>
          <CardDescription>
            Defaults apply to every linked location unless overridden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Require human approval</FieldTitle>
                <FieldDescription>
                  AI drafts cannot publish until an authorised person approves
                  them.
                </FieldDescription>
              </FieldContent>
              <Switch
                checked={approvalRequired}
                onCheckedChange={(checked) => {
                  setApprovalRequired(checked)
                  if (checked) setDirectPublishConsent(false)
                }}
                aria-label="Require human approval"
              />
            </Field>
            <Separator />
            {!approvalRequired ? (
              <>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Owner consent for direct publishing</FieldTitle>
                    <FieldDescription>
                      I authorise NabaReview to publish verified replies on this
                      organisation’s behalf without a separate approval step.
                      Every action remains attributable and location-scoped.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    checked={directPublishConsent}
                    onCheckedChange={setDirectPublishConsent}
                    aria-label="Consent to direct publishing"
                  />
                </Field>
                <Separator />
              </>
            ) : null}
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Block drafts that fail verification</FieldTitle>
                <FieldDescription>
                  Always enforced by the publishing API when claims, personal
                  data or tone checks fail.
                </FieldDescription>
              </FieldContent>
              <Switch
                checked
                disabled
                aria-label="Block drafts that fail verification"
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            onClick={persistSettings}
            disabled={isPending || (!approvalRequired && !directPublishConsent)}
          >
            Save policy
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team access</CardTitle>
          <CardDescription>
            Roles control administration; location assignments restrict review
            visibility and approval. Click a location to cycle View → Publish →
            No access.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {teamStatus === "loading" ? (
            <Skeleton className="h-48 w-full" />
          ) : teamStatus === "error" ? (
            <LiveDataError onRetry={reloadSettings} />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
                <Input
                  value={newMemberName}
                  onChange={(event) =>
                    setNewMemberName(readControlValue(event))
                  }
                  placeholder="Display name"
                  aria-label="New member display name"
                />
                <Input
                  value={newMemberEmail}
                  onChange={(event) =>
                    setNewMemberEmail(readControlValue(event))
                  }
                  placeholder="name@example.com"
                  type="email"
                  aria-label="New member email"
                />
                <NativeSelect
                  value={newMemberRole}
                  onValueChange={(value) =>
                    setNewMemberRole(value as OrganisationMember["role"])
                  }
                  aria-label="New member role"
                >
                  <NativeSelectOption value="admin">Admin</NativeSelectOption>
                  <NativeSelectOption value="member">Member</NativeSelectOption>
                  <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
                </NativeSelect>
                <Button
                  onClick={inviteMember}
                  disabled={isPending || !newMemberName || !newMemberEmail}
                >
                  Add member
                </Button>
              </div>
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex flex-col gap-3 rounded-xl border p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-48 flex-1">
                      <p className="text-sm font-medium">
                        {member.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </div>
                    <NativeSelect
                      className="w-32"
                      value={member.role}
                      onValueChange={(value) =>
                        changeMember(member, {
                          role: value as OrganisationMember["role"],
                          canPublish: member.canPublish,
                        })
                      }
                      aria-label={`Role for ${member.displayName}`}
                    >
                      <NativeSelectOption value="owner">
                        Owner
                      </NativeSelectOption>
                      <NativeSelectOption value="admin">
                        Admin
                      </NativeSelectOption>
                      <NativeSelectOption value="member">
                        Member
                      </NativeSelectOption>
                      <NativeSelectOption value="viewer">
                        Viewer
                      </NativeSelectOption>
                    </NativeSelect>
                    <label className="flex items-center gap-2 text-xs">
                      Publish all
                      <Switch
                        checked={member.canPublish}
                        disabled={member.role === "viewer"}
                        onCheckedChange={(canPublish) =>
                          changeMember(member, {
                            role: member.role,
                            canPublish,
                          })
                        }
                        aria-label={`Publish all locations for ${member.displayName}`}
                      />
                    </label>
                  </div>
                  {member.role === "member" || member.role === "viewer" ? (
                    <div className="flex flex-wrap gap-2">
                      {internalLocations.map((location) => {
                        const assignment = member.locations.find(
                          (item) => item.locationId === location.locationId
                        )
                        return (
                          <Button
                            key={location.locationId}
                            variant={assignment ? "secondary" : "outline"}
                            size="sm"
                            onClick={() =>
                              cycleLocationAccess(member, location.locationId)
                            }
                          >
                            {location.name}
                            {assignment
                              ? assignment.canPublish
                                ? " · Publish"
                                : " · View"
                              : " · No access"}
                          </Button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Language and timezone</CardTitle>
          <CardDescription>
            Dates and fallback drafts use these organisation defaults.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="default-language">
                Default language
              </FieldLabel>
              <NativeSelect
                id="default-language"
                value={defaultLanguage}
                onValueChange={setDefaultLanguage}
              >
                <NativeSelectOption value="en">English</NativeSelectOption>
                <NativeSelectOption value="fr">French</NativeSelectOption>
                <NativeSelectOption value="de">German</NativeSelectOption>
                <NativeSelectOption value="es">Spanish</NativeSelectOption>
                <NativeSelectOption value="it">Italian</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="default-timezone">IANA timezone</FieldLabel>
              <Input
                id="default-timezone"
                value={defaultTimezone}
                onChange={(event) =>
                  setDefaultTimezone(readControlValue(event))
                }
                placeholder="Europe/London"
              />
              <FieldDescription>
                For example Europe/London or America/New_York.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button onClick={persistSettings} disabled={isPending}>
            Save locale
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data retention</CardTitle>
          <CardDescription>
            Separate transient Google content from durable aggregates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="retention-window">
                Raw content window
              </FieldLabel>
              <NativeSelect
                id="retention-window"
                className="w-full"
                value={String(retentionDays)}
                onValueChange={(value) => setRetentionDays(Number(value))}
              >
                <NativeSelectOption value="30">
                  30 days (recommended)
                </NativeSelectOption>
                <NativeSelectOption value="14">14 days</NativeSelectOption>
                <NativeSelectOption value="7">7 days</NativeSelectOption>
              </NativeSelect>
              <FieldDescription>
                Verbatim review text and media metadata are purged
                automatically.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Keep derived aggregates</FieldTitle>
                <FieldDescription>
                  Rating, response-time and volume metrics remain available
                  after raw text is purged.
                </FieldDescription>
              </FieldContent>
              <Switch checked disabled aria-label="Keep derived aggregates" />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Purges are recorded by the retention worker.
          </span>
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                "/api/audit-log?format=csv&page_size=1000&action=retention.purge.completed",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            Review purge log
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance tools</CardTitle>
          <CardDescription>
            Track data-subject workflows and export attributable audit records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="privacy-subject">
                Reviewer name or Google review ID
              </FieldLabel>
              <Input
                id="privacy-subject"
                value={privacySubject}
                onChange={(event) => setPrivacySubject(readControlValue(event))}
                placeholder="Google review ID or exact reviewer name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="privacy-request-type">
                Request type
              </FieldLabel>
              <NativeSelect
                id="privacy-request-type"
                value={privacyRequestType}
                onValueChange={(value) =>
                  setPrivacyRequestType(value as typeof privacyRequestType)
                }
              >
                <NativeSelectOption value="access">Access</NativeSelectOption>
                <NativeSelectOption value="rectification">
                  Rectification
                </NativeSelectOption>
                <NativeSelectOption value="erasure">Erasure</NativeSelectOption>
                <NativeSelectOption value="restriction">
                  Restriction
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            onClick={submitPrivacyRequest}
            disabled={isPending || privacySubject.trim().length < 3}
          >
            Record request
          </Button>
          <Button
            variant="outline"
            disabled={privacySubject.trim().length < 3}
            onClick={() =>
              window.open(
                `/api/privacy/export?subject=${encodeURIComponent(privacySubject)}`,
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            Export retained data
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                "/api/audit-log?format=csv&page_size=1000",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            Export audit CSV
          </Button>
        </CardFooter>
      </Card>

      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      <Alert>
        <Sparkles />
        <AlertTitle>
          {approvalRequired
            ? "Human-supervised by default"
            : "Direct publishing enabled with owner consent"}
        </AlertTitle>
        <AlertDescription>
          {approvalRequired
            ? "Direct publishing remains disabled. Every response is attributable to an authorised user and retained in the audit trail."
            : "Only authorised roles and location grants may publish. Every response still records the actor, verification result and Google outcome."}
        </AlertDescription>
      </Alert>
    </div>
  )
}
