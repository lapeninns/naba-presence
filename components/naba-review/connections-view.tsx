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
  Search,
  Settings2,
  ShieldCheck,
  Unplug,
} from "lucide-react"
import { useEffect, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  beginGoogleConnect,
  activateGoogleAccounts,
  type BackfillProgress,
  cancelBackfill,
  configureGoogleNotifications,
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
  loadSettings,
  type InternalLocation,
  type OrganisationSettings,
  runBackfill,
} from "@/lib/naba-review-api"
import {
  PageFrame,
  PageHeader,
  readControlValue,
} from "@/components/naba-review/shared"

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
  const [messageKind, setMessageKind] = useState<"info" | "error">("info")
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading")
  const [isPending, startTransition] = useTransition()
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false)
  const connection =
    connections.find((item) => item.status === "active") ?? connections[0]
  const linkedExternalIds = new Set(
    internalLocations
      .map((location) => location.externalLocationId)
      .filter((id): id is string => Boolean(id))
  )
  const activeAccount = accounts.find((account) => account.isActive)
  const importItems = backfillProgress?.items ?? []
  const backfillDoneCount = backfillProgress?.counts.succeeded ?? 0
  const backfillTotalCount = backfillProgress?.total ?? 0
  const progressPct = backfillTotalCount
    ? Math.round((backfillDoneCount / backfillTotalCount) * 100)
    : 0
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
            setMessageKind("error")
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
        setMessageKind("error")
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
    setMessageKind("info")
    setMessage("")
    startTransition(async () => {
      try {
        const { authorizationUrl } = await beginGoogleConnect()
        window.location.assign(authorizationUrl)
      } catch (error) {
        setMessageKind("error")
        setMessage(error instanceof Error ? error.message : "Connect failed.")
      }
    })
  }

  function discover() {
    setMessageKind("info")
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
            setMessageKind("info")
            setMessage("Google account found. Choose the locations to import.")
          } else {
            setMessageKind("info")
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
        setMessageKind("info")
        setMessage(
          `${result.locations.length} Google location${result.locations.length === 1 ? "" : "s"} found.`
        )
      } catch (error) {
        setMessageKind("error")
        setMessage(error instanceof Error ? error.message : "Discovery failed.")
      }
    })
  }

  function toggleAccount(account: GoogleAccount) {
    setMessageKind("info")
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
        setMessageKind("info")
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
        setMessageKind("error")
        setMessage(
          error instanceof Error ? error.message : "Account selection failed."
        )
      }
    })
  }

  function configureNotifications() {
    const activeAccount = accounts.find((account) => account.isActive)
    if (!activeAccount) {
      setMessageKind("error")
      setMessage("Activate a Google account before configuring notifications.")
      return
    }
    setMessageKind("info")
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
        setMessageKind("info")
        setMessage(
          pubsubTopic
            ? "NEW_REVIEW and UPDATED_REVIEW notifications enabled."
            : "Google notifications disabled."
        )
      } catch (error) {
        setMessageKind("error")
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
      setMessageKind("error")
      setMessage("Choose at least one verified location to continue.")
      return
    }
    setMessageKind("info")
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
        setMessageKind("info")
        setMessage(
          `${selectedLocations.length} location${selectedLocations.length === 1 ? "" : "s"} linked. Historical reviews are importing now.`
        )
      } catch (error) {
        const failureMessage =
          error instanceof Error ? error.message : "Import failed."
        setMessageKind("error")
        setMessage(failureMessage)
        toast.add({
          type: "error",
          title: "Import failed",
          description: failureMessage,
          actionProps: {
            children: "Retry",
            onClick: () => void importSelectedLocations(),
          },
        })
      }
    })
  }

  function continueBackfill(externalLocationId: string) {
    setMessageKind("info")
    setMessage("")
    startTransition(async () => {
      try {
        const result = await runBackfill(externalLocationId)
        setBackfillProgress(result.progress)
        setMessageKind("info")
        setMessage(
          result.batches.every((batch) => batch.complete)
            ? "Historical review import complete."
            : "Another batch was imported. Continue when you’re ready."
        )
      } catch (error) {
        setMessageKind("error")
        setMessage(
          error instanceof Error ? error.message : "Import could not continue."
        )
      }
    })
  }

  function cancelBackfillContinuation(externalLocationId: string) {
    setMessageKind("info")
    setMessage("")
    startTransition(async () => {
      try {
        const result = await cancelBackfill(externalLocationId)
        setBackfillProgress(result.progress)
        setMessageKind("info")
        setMessage("Historical import paused. You can resume it later.")
      } catch (error) {
        setMessageKind("error")
        setMessage(
          error instanceof Error ? error.message : "Import could not be paused."
        )
      }
    })
  }

  function disconnect() {
    if (!connection) return
    setMessageKind("info")
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
        setMessageKind("info")
        setMessage(
          "Google disconnected. Policy cleanup is scheduled within 7 days."
        )
        toast.add({
          type: "success",
          title: "Google disconnected",
          description: "Policy cleanup is scheduled within 7 days.",
        })
      } catch (error) {
        setMessageKind("error")
        setMessage(
          error instanceof Error ? error.message : "Disconnect failed."
        )
      }
    })
  }

  return (
    <PageFrame width="wide">
      <PageHeader
        eyebrow={<Badge variant="outline">Merchant setup</Badge>}
        title="Google Business Profile"
        description={
          setupComplete
            ? "Your locations, review history, and reply policy are ready."
            : "Set up your review workspace in a few guided steps. You stay in control of every location we import."
        }
      />

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
            <Card aria-label="Google connection">
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
                      {connection ? (
                        <>
                          Connected{" "}
                          <span className="font-mono">
                            {new Intl.DateTimeFormat("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(connection.createdAt))}
                          </span>
                        </>
                      ) : (
                        "Use the Google account that manages your Business Profile."
                      )}
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
              <Card aria-label="Google account choice">
                <CardHeader>
                  <CardTitle>Choose your Google account</CardTitle>
                  <CardDescription>
                    Only locations owned or managed by the active account can be
                    imported.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {accounts.length ? (
                    <ItemGroup>
                      {accounts.map((account) => (
                        <Item
                          key={account.id}
                          role="listitem"
                          variant="outline"
                        >
                          <ItemMedia className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
                            <Building2 className="size-4" aria-hidden />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>
                              {account.accountName ?? account.googleAccountName}
                            </ItemTitle>
                            <ItemDescription className="font-mono">
                              {account.googleAccountName}
                              {account.role ? ` · ${account.role}` : ""}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <Button
                              variant={
                                account.isActive ? "secondary" : "outline"
                              }
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
                          </ItemActions>
                        </Item>
                      ))}
                    </ItemGroup>
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
              <Card aria-label="Google location import">
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
                        <InputGroup>
                          <InputGroupAddon>
                            <Search />
                          </InputGroupAddon>
                          <InputGroupInput
                            value={locationQuery}
                            onChange={(event) =>
                              setLocationQuery(readControlValue(event))
                            }
                            placeholder="Search locations"
                            aria-label="Search Google locations"
                          />
                        </InputGroup>
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
                      <ItemGroup className="pt-4">
                        {locations
                          .filter((location) => {
                            const matchesText = (
                              location.title ?? location.name
                            )
                              .toLowerCase()
                              .includes(locationQuery.trim().toLowerCase())
                            const matchesVerification =
                              verificationFilter === "all" ||
                              (verificationFilter === "verified"
                                ? location.verified
                                : !location.verified)
                            return matchesText && matchesVerification
                          })
                          .map((location) => {
                            const isLinked = linkedExternalIds.has(location.id)
                            const isSelected = selectedLocationIds.includes(
                              location.id
                            )
                            return (
                              <Item
                                key={location.id}
                                role="listitem"
                                variant="outline"
                                size="sm"
                              >
                                <ItemMedia>
                                  <Checkbox
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
                                </ItemMedia>
                                <ItemContent>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <ItemTitle>
                                      {location.title ?? location.name}
                                    </ItemTitle>
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
                                  <ItemDescription>
                                    {formatGoogleAddress(location) ||
                                      location.accountName}
                                  </ItemDescription>
                                </ItemContent>
                                {!isLinked && location.verified ? (
                                  <ItemActions>
                                    <NativeSelect
                                      className="max-w-sm"
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
                                  </ItemActions>
                                ) : null}
                              </Item>
                            )
                          })}
                      </ItemGroup>
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
              <Card aria-label="Historical review backfill">
                <CardHeader>
                  <CardTitle>Historical review import</CardTitle>
                  <CardDescription>
                    Imports run in safe batches so a large review history cannot
                    overwhelm the app.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Progress
                      value={progressPct}
                      aria-label="Historical import progress"
                    >
                      <ProgressLabel>Importing reviews</ProgressLabel>
                      <ProgressValue />
                    </Progress>
                    <p className="font-mono text-xs text-muted-foreground">
                      {backfillDoneCount} of {backfillTotalCount} locations
                      imported
                    </p>
                  </div>
                  <ItemGroup>
                    {importItems.map((item) => (
                      <Item
                        key={item.externalLocationId}
                        role="listitem"
                        variant="outline"
                      >
                        <ItemContent>
                          <ItemTitle>{item.locationName}</ItemTitle>
                          <ItemDescription>
                            {item.status === "succeeded"
                              ? "All available review pages imported"
                              : item.status === "failed"
                                ? `Needs attention${item.lastErrorCode ? ` · ${item.lastErrorCode}` : ""}`
                                : item.status === "cancelled"
                                  ? "Paused"
                                  : "More review pages are ready to import"}
                          </ItemDescription>
                          <p className="font-mono text-xs text-muted-foreground">
                            {item.externalLocationId}
                          </p>
                        </ItemContent>
                        <ItemActions className="flex-wrap">
                          <Badge
                            variant={
                              item.status === "failed"
                                ? "destructive"
                                : "secondary"
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
                            <>
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
                            </>
                          ) : null}
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-6">
            <Card
              aria-label="Connection status and guidance"
              className="bg-card shadow-md"
            >
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
              <Card aria-label="Notification management" className="bg-card">
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
                    className="font-mono"
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
        <Alert variant={messageKind === "error" ? "destructive" : "default"}>
          <Info />
          <AlertTitle>Setup update</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {connection ? (
        <Card aria-label="Connection management" className="bg-card">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            <AlertDialog
              open={confirmDisconnectOpen}
              onOpenChange={setConfirmDisconnectOpen}
            >
              <AlertDialogTrigger
                render={
                  <Button variant="outline" size="sm" disabled={isPending} />
                }
              >
                <Unplug data-icon="inline-start" />
                Disconnect
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Review sync stops immediately, and the scheduled policy
                    cleanup removes Google data within 7 days. You can reconnect
                    at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      setConfirmDisconnectOpen(false)
                      disconnect()
                    }}
                  >
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      ) : null}
    </PageFrame>
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
    <div
      className="grid gap-2 rounded-xl border bg-card p-2 shadow-sm sm:grid-cols-4"
      aria-label="Connection setup progress"
    >
      {steps.map((step, index) => {
        const isCurrent =
          !steps.every((item) => item.complete) && index === currentIndex
        return (
          <div
            key={step.label}
            className="flex items-center gap-3 rounded-lg px-3 py-3"
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
