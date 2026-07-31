"use client"

import { RefreshCw, ShieldCheck } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  type LocationAdministrationOperation,
  type LocationAdministrationState,
  loadLocationAdministration,
  matchGoogleLocation,
  mutateLocationAdministration,
} from "@/lib/naba-presence-api"

const TEMPLATES: Record<LocationAdministrationOperation | "match_location", Record<string, unknown>> = {
  start_verification: { method: "EMAIL", languageCode: "en", emailAddress: "owner@example.com" },
  complete_verification: { name: "locations/LOCATION_ID/verifications/VERIFICATION_ID", pin: "12345" },
  create_admin: { scope: "location", admin: "manager@example.com", role: "MANAGER" },
  update_admin: { name: "locations/LOCATION_ID/admins/ADMIN_ID", role: "OWNER" },
  delete_admin: { name: "locations/LOCATION_ID/admins/ADMIN_ID" },
  accept_invitation: { name: "accounts/ACCOUNT_ID/invitations/INVITATION_ID" },
  decline_invitation: { name: "accounts/ACCOUNT_ID/invitations/INVITATION_ID" },
  transfer_location: { destinationAccount: "accounts/DESTINATION_ACCOUNT_ID" },
  create_location: { location: { languageCode: "en", title: "Business name", categories: { primaryCategory: { name: "categories/gcid:restaurant" } }, storefrontAddress: { regionCode: "GB", addressLines: ["1 High Street"], locality: "London", postalCode: "SW1A 1AA" } } },
  delete_location: {},
  accept_google_update: { updateMask: ["title"], location: { title: "Google suggested name" } },
  match_location: { title: "Business name", languageCode: "en", storefrontAddress: { regionCode: "GB", addressLines: ["1 High Street"] } },
}

const LABELS: Record<keyof typeof TEMPLATES, string> = {
  start_verification: "Start verification",
  complete_verification: "Complete verification with PIN",
  create_admin: "Invite account or location admin",
  update_admin: "Change admin role",
  delete_admin: "Remove admin",
  accept_invitation: "Accept invitation",
  decline_invitation: "Decline invitation",
  transfer_location: "Transfer location",
  create_location: "Create location",
  delete_location: "Delete current Google location",
  accept_google_update: "Accept Google-suggested update",
  match_location: "Find matching Google locations",
}

function JsonPanel({ title, result }: { title: string; result: { data: Record<string, unknown> | null; error: string | null } }) {
  return <Card size="sm"><CardHeader><CardTitle>{title}</CardTitle>{result.error ? <CardDescription>{result.error}</CardDescription> : null}</CardHeader><CardContent><pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(result.data, null, 2)}</pre></CardContent></Card>
}

export function LocationAdministrationView({ locationId }: { locationId: string }) {
  const [state, setState] = useState<LocationAdministrationState | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [operation, setOperation] = useState<keyof typeof TEMPLATES>("start_verification")
  const [payload, setPayload] = useState(JSON.stringify(TEMPLATES.start_verification, null, 2))
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const refresh = useCallback(() => { setStatus("loading"); setReloadKey((value) => value + 1) }, [])

  useEffect(() => {
    let active = true
    void loadLocationAdministration(locationId).then(({ administration }) => {
      if (active) { setState(administration); setStatus("ready") }
    }).catch(() => { if (active) setStatus("error") })
    return () => { active = false }
  }, [locationId, reloadKey])

  const panels = useMemo(() => state ? [
    ["Voice of Merchant", state.voice],
    ["Verification options", state.verificationOptions],
    ["Verification history", state.verifications],
    ["Google-suggested updates", state.googleUpdated],
    ["Location owners and managers", state.locationAdmins],
    ["Account owners and managers", state.accountAdmins],
    ["Pending account invitations", state.invitations],
  ] as const : [], [state])

  function selectOperation(next: keyof typeof TEMPLATES) {
    setOperation(next)
    setPayload(JSON.stringify(TEMPLATES[next], null, 2))
    setConfirmed(false)
    setResult(null)
  }

  async function execute() {
    setBusy(true); setMessage(null)
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      const response = operation === "match_location"
        ? await matchGoogleLocation(locationId, parsed)
        : await mutateLocationAdministration(locationId, operation, parsed)
      setResult(response as Record<string, unknown>)
      setMessage(`${LABELS[operation]} completed.`)
      if (operation !== "match_location") refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Google operation failed.")
    } finally { setBusy(false) }
  }

  if (status === "loading") return <Skeleton className="h-[700px] w-full" />
  if (status === "error" || !state) return <LiveDataError onRetry={refresh} />
  return <section className="flex flex-col gap-(--nr-gap-section)">
    {message ? <Alert><ShieldCheck /><AlertTitle>Administration status</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>Google location administration</CardTitle><CardDescription>Verification, matching, suggested updates, lifecycle, transfers, and Google owner/manager permissions. Destructive and access changes require explicit approval and are audited.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label htmlFor="administration-operation">Operation</Label><NativeSelect id="administration-operation" value={operation} onValueChange={(value) => selectOperation(value as keyof typeof TEMPLATES)}>{Object.entries(LABELS).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div><div className="grid gap-2"><Label htmlFor="administration-payload">Operation payload</Label><Textarea id="administration-payload" value={payload} onChange={(event) => setPayload(event.target.value)} className="min-h-64 font-mono text-xs" spellCheck={false} /></div>{operation !== "match_location" ? <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />I reviewed this operation and approve its effect on Google.</label> : null}<div className="flex gap-2"><Button disabled={busy || !state.writesEnabled || (operation !== "match_location" && !confirmed)} onClick={() => void execute()}>{busy ? "Working…" : LABELS[operation]}</Button><Button variant="outline" onClick={refresh}><RefreshCw /> Refresh</Button></div>{result ? <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(result, null, 2)}</pre> : null}</CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2">{panels.map(([title, panel]) => <JsonPanel key={title} title={title} result={panel} />)}</div>
  </section>
}
