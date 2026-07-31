"use client"

import { Building2, RefreshCw, Send } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  type IndustryManagementState,
  type IndustryOperation,
  loadIndustryManagement,
  updateIndustryManagement,
} from "@/lib/naba-presence-api"

const LABELS: Record<IndustryOperation, string> = {
  update_lodging: "Lodging amenities and policies",
  update_business_calls: "Business Calls settings",
  update_healthcare_services: "Healthcare service list",
  update_healthcare_provider_attributes: "Healthcare provider attributes",
}

const DEFAULT_MASKS: Record<IndustryOperation, string> = {
  update_lodging: "policies,parking,pets,services,accessibility",
  update_business_calls: "callsState",
  update_healthcare_services: "serviceItems",
  update_healthcare_provider_attributes: "attributes",
}

function SurfaceCard({ title, result }: { title: string; result: { data: Record<string, unknown> | null; error: string | null } }) {
  return <Card size="sm"><CardHeader><CardTitle>{title}</CardTitle>{result.error ? <CardDescription>{result.error}</CardDescription> : null}</CardHeader><CardContent><pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(result.data, null, 2)}</pre></CardContent></Card>
}

export function LocationIndustryView({ locationId }: { locationId: string }) {
  const [state, setState] = useState<IndustryManagementState | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [operation, setOperation] = useState<IndustryOperation>("update_lodging")
  const [payload, setPayload] = useState("{}")
  const [mask, setMask] = useState(DEFAULT_MASKS.update_lodging)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = useCallback(() => { setStatus("loading"); setReloadKey((value) => value + 1) }, [])

  useEffect(() => {
    let active = true
    void loadIndustryManagement(locationId).then(({ industry }) => {
      if (active) { setState(industry); setStatus("ready") }
    }).catch(() => { if (active) setStatus("error") })
    return () => { active = false }
  }, [locationId, reloadKey])

  const surfaces = useMemo(() => state ? [
    ["Merchant lodging data", state.lodging],
    ["Google-updated lodging data", state.lodgingUpdated],
    ["Business Calls settings", state.calls],
    ["Business Calls insights", state.callInsights],
    ["Healthcare service list", state.healthcareServices],
    ["Provider attributes", state.providerAttributes],
    ["Supported insurance networks", state.insuranceNetworks],
  ] as const : [], [state])

  function select(next: IndustryOperation) {
    setOperation(next)
    setMask(DEFAULT_MASKS[next])
    const source = next === "update_lodging" ? state?.lodging.data : next === "update_business_calls" ? state?.calls.data : next === "update_healthcare_services" ? state?.healthcareServices.data : state?.providerAttributes.data
    const clean = source ? Object.fromEntries(Object.entries(source).filter(([key]) => key !== "name")) : {}
    setPayload(JSON.stringify(clean, null, 2))
    setConfirmed(false)
  }

  async function publish() {
    setBusy(true); setMessage(null)
    try {
      await updateIndustryManagement(locationId, { operation, updateMask: mask.split(",").map((item) => item.trim()).filter(Boolean), payload: JSON.parse(payload) as Record<string, unknown> })
      setMessage(`${LABELS[operation]} published to Google.`)
      refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : "The industry update failed.") }
    finally { setBusy(false) }
  }

  if (status === "loading") return <Skeleton className="h-[700px] w-full" />
  if (status === "error" || !state) return <LiveDataError onRetry={refresh} />
  return <section className="flex flex-col gap-(--nr-gap-section)">
    {message ? <Alert><Building2 /><AlertTitle>Industry management status</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>Industry-specific Google management</CardTitle><CardDescription>These APIs are category- and eligibility-dependent. NabaPresence shows each provider response independently and keeps unsupported surfaces visibly unavailable without hiding eligible ones.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label htmlFor="industry-operation">Resource</Label><NativeSelect id="industry-operation" value={operation} onValueChange={(value) => select(value as IndustryOperation)}>{Object.entries(LABELS).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div><div className="grid gap-2"><Label htmlFor="industry-mask">Update mask</Label><Input id="industry-mask" value={mask} onChange={(event) => setMask(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="industry-payload">Payload</Label><Textarea id="industry-payload" value={payload} onChange={(event) => setPayload(event.target.value)} className="min-h-80 font-mono text-xs" spellCheck={false} /></div><label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />I reviewed this category-specific payload and approve publishing it to Google.</label><div className="flex gap-2"><Button disabled={!confirmed || !mask.trim() || busy || !state.canManage || !state.writesEnabled} onClick={() => void publish()}><Send /> Publish</Button><Button variant="outline" onClick={refresh}><RefreshCw /> Refresh</Button></div></CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2">{surfaces.map(([title, result]) => <SurfaceCard key={title} title={title} result={result} />)}</div>
  </section>
}
