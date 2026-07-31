"use client"

import { AlertTriangle, CheckCircle2, Pencil, Plus, RefreshCw, Send, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import type { NormalizedHours } from "@/lib/domain/hours"
import {
  type HoursViewState,
  loadLocationHours,
  publishLocationHours,
  saveLocationHours,
} from "@/lib/naba-presence-api"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const STATUS_COPY = {
  in_sync: { label: "In sync", description: "NabaPresence and Google show the same schedule." },
  core_dirty: { label: "Ready to publish", description: "The NabaPresence schedule has unpublished changes." },
  google_dirty: { label: "Google changed", description: "Google changed independently after reconciliation." },
  conflict: { label: "Conflict", description: "NabaPresence and Google both changed since reconciliation." },
} as const

function cloneHours(hours: NormalizedHours) {
  return JSON.parse(JSON.stringify(hours)) as NormalizedHours
}

function formatPeriods(day: { isClosed: boolean; periods: Array<{ opensAt: string; closesAt: string }> }) {
  if (day.isClosed || day.periods.length === 0) return "Closed"
  return day.periods.map((period) => `${period.opensAt}–${period.closesAt}`).join(", ")
}

function statusVariant(status: string) {
  if (status === "conflict") return "destructive" as const
  if (status === "in_sync") return "secondary" as const
  return "outline" as const
}

function HoursEditor({ state, open, onOpenChange, onSaved }: {
  state: HoursViewState
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(() => cloneHours(state.canonical))
  const [pending, startTransition] = useTransition()

  function updateRegular(dayIndex: number, updater: (day: NormalizedHours["regular"][number]) => void) {
    setDraft((current) => {
      const next = cloneHours(current)
      updater(next.regular[dayIndex])
      return next
    })
  }

  function save() {
    startTransition(async () => {
      try {
        await saveLocationHours(state.location.id, {
          expectedCanonicalRevision: state.canonicalResource.revision,
          hours: draft,
        })
        toast.add({ type: "success", title: "Canonical hours saved" })
        onOpenChange(false)
        onSaved()
      } catch (error) {
        toast.add({ type: "error", title: error instanceof Error ? error.message : "Hours could not be saved." })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit NabaPresence hours</DialogTitle>
          <DialogDescription>Changes are saved locally first. Review the live comparison before publishing to Google.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Regular hours</h3>
            {draft.regular.map((day, dayIndex) => (
              <div key={day.dayOfWeek} className="rounded-2xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium">{DAY_NAMES[day.dayOfWeek]}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={day.isClosed} onCheckedChange={(value) => updateRegular(dayIndex, (entry) => {
                      entry.isClosed = value === true
                      if (entry.isClosed) entry.periods = []
                      else if (!entry.periods.length) entry.periods = [{ opensAt: "09:00", closesAt: "17:00" }]
                    })} /> Closed
                  </label>
                </div>
                {!day.isClosed ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {day.periods.map((period, periodIndex) => (
                      <div key={`${day.dayOfWeek}-${periodIndex}`} className="flex items-center gap-2">
                        <Input aria-label={`${DAY_NAMES[day.dayOfWeek]} opens`} type="time" value={period.opensAt} onChange={(event) => updateRegular(dayIndex, (entry) => { entry.periods[periodIndex].opensAt = event.target.value })} />
                        <span className="text-muted-foreground">to</span>
                        <Input aria-label={`${DAY_NAMES[day.dayOfWeek]} closes`} type="time" value={period.closesAt} onChange={(event) => updateRegular(dayIndex, (entry) => { entry.periods[periodIndex].closesAt = event.target.value })} />
                        <Button size="icon-sm" variant="ghost" aria-label="Remove period" onClick={() => updateRegular(dayIndex, (entry) => { entry.periods.splice(periodIndex, 1); if (!entry.periods.length) entry.isClosed = true })}><Trash2 /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" className="self-start" disabled={day.periods.length >= 3} onClick={() => updateRegular(dayIndex, (entry) => entry.periods.push({ opensAt: "09:00", closesAt: "17:00" }))}><Plus /> Add period</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Special hours</h3>
              <Button size="sm" variant="outline" onClick={() => setDraft((current) => ({ ...cloneHours(current), special: [...current.special, { effectiveDate: new Date().toISOString().slice(0, 10), isClosed: true, opensAt: null, closesAt: null }] }))}><Plus /> Add date</Button>
            </div>
            {draft.special.map((period, index) => (
              <div key={`${period.effectiveDate}-${index}`} className="grid items-center gap-2 rounded-2xl border p-3 sm:grid-cols-[1fr_auto_1fr_1fr_auto]">
                <Input aria-label="Special date" type="date" value={period.effectiveDate} onChange={(event) => setDraft((current) => { const next = cloneHours(current); next.special[index].effectiveDate = event.target.value; return next })} />
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={period.isClosed} onCheckedChange={(value) => setDraft((current) => { const next = cloneHours(current); const row = next.special[index]; row.isClosed = value === true; row.opensAt = row.isClosed ? null : row.opensAt ?? "09:00"; row.closesAt = row.isClosed ? null : row.closesAt ?? "17:00"; return next })} /> Closed</label>
                <Input aria-label="Special opening time" type="time" disabled={period.isClosed} value={period.opensAt ?? ""} onChange={(event) => setDraft((current) => { const next = cloneHours(current); next.special[index].opensAt = event.target.value; return next })} />
                <Input aria-label="Special closing time" type="time" disabled={period.isClosed} value={period.closesAt ?? ""} onChange={(event) => setDraft((current) => { const next = cloneHours(current); next.special[index].closesAt = event.target.value; return next })} />
                <Button size="icon-sm" variant="ghost" aria-label="Remove special hours" onClick={() => setDraft((current) => { const next = cloneHours(current); next.special.splice(index, 1); return next })}><Trash2 /></Button>
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="font-medium">Additional hours</h3><p className="text-sm text-muted-foreground">For example, kitchen or delivery hours supported by the Google category.</p></div>
              <Button size="sm" variant="outline" onClick={() => setDraft((current) => ({ ...cloneHours(current), moreHours: [...current.moreHours, { hoursTypeId: "KITCHEN", periods: [] }] }))}><Plus /> Add type</Button>
            </div>
            {draft.moreHours.map((entry, entryIndex) => (
              <div key={`${entry.hoursTypeId}-${entryIndex}`} className="rounded-2xl border p-3">
                <div className="flex gap-2">
                  <div className="grid flex-1 gap-1"><Label>Google hours type</Label><Input value={entry.hoursTypeId} onChange={(event) => setDraft((current) => { const next = cloneHours(current); next.moreHours[entryIndex].hoursTypeId = event.target.value; return next })} /></div>
                  <Button size="icon-sm" variant="ghost" className="mt-6" aria-label="Remove additional hours type" onClick={() => setDraft((current) => { const next = cloneHours(current); next.moreHours.splice(entryIndex, 1); return next })}><Trash2 /></Button>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {entry.periods.map((period, periodIndex) => (
                    <div key={periodIndex} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <select className="h-8 rounded-md border bg-card px-2 text-sm" value={period.dayOfWeek} onChange={(event) => setDraft((current) => { const next = cloneHours(current); next.moreHours[entryIndex].periods[periodIndex].dayOfWeek = Number(event.target.value); return next })}>{DAY_NAMES.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
                      <Input type="time" value={period.opensAt} onChange={(event) => setDraft((current) => { const next = cloneHours(current); next.moreHours[entryIndex].periods[periodIndex].opensAt = event.target.value; return next })} />
                      <Input type="time" value={period.closesAt} onChange={(event) => setDraft((current) => { const next = cloneHours(current); next.moreHours[entryIndex].periods[periodIndex].closesAt = event.target.value; return next })} />
                      <Button size="icon-sm" variant="ghost" onClick={() => setDraft((current) => { const next = cloneHours(current); next.moreHours[entryIndex].periods.splice(periodIndex, 1); return next })}><Trash2 /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="self-start" onClick={() => setDraft((current) => { const next = cloneHours(current); next.moreHours[entryIndex].periods.push({ dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00" }); return next })}><Plus /> Add period</Button>
                </div>
              </div>
            ))}
          </section>
        </div>

        <DialogFooter showCloseButton><Button onClick={save} disabled={pending}>{pending ? <Spinner /> : null} Save canonical hours</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ManagedHours({ state, onRefresh }: { state: HoursViewState; onRefresh: () => void }) {
  const [editOpen, setEditOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [pending, startTransition] = useTransition()
  const status = STATUS_COPY[state.status]
  const requiresOverwrite = ["google_dirty", "conflict"].includes(state.status)
  const updated = useMemo(() => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: state.location.timezone }).format(new Date(state.canonicalResource.updatedAt)), [state])

  function publish() {
    startTransition(async () => {
      try {
        await publishLocationHours(state.location.id, {
          expectedCanonicalRevision: state.canonicalResource.revision,
          expectedCanonicalHash: state.canonicalHash,
          expectedGoogleHash: state.googleHash,
          approvedUpdateMask: state.updateMask,
          confirmOverwriteGoogleChanges: requiresOverwrite && confirmOverwrite,
        })
        toast.add({ type: "success", title: "Hours published and reconciled" })
        setPublishOpen(false)
        setConfirmOverwrite(false)
        onRefresh()
      } catch (error) {
        toast.add({ type: "error", title: error instanceof Error ? error.message : "Hours could not be published." })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><CardTitle className="flex items-center gap-2">Hours control <Badge variant={statusVariant(state.status)}>{status.label}</Badge></CardTitle><CardDescription>NabaPresence canonical schedule · updated {updated}</CardDescription></div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onRefresh}><RefreshCw /> Refresh</Button><Button variant="outline" onClick={() => setEditOpen(true)} disabled={!state.canPublish}><Pencil /> Edit hours</Button><Button onClick={() => setPublishOpen(true)} disabled={state.status === "in_sync" || !state.canPublish || !state.writesEnabled || !state.updateMask.length}><Send /> Review publish</Button></div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Alert variant={state.status === "conflict" ? "destructive" : "default"}>{state.status === "in_sync" ? <CheckCircle2 /> : <AlertTriangle />}<AlertTitle>{status.label}</AlertTitle><AlertDescription>{status.description}</AlertDescription></Alert>
          {!state.writesEnabled ? <Alert><AlertTriangle /><AlertTitle>Google publishing is paused</AlertTitle><AlertDescription>You can continue editing NabaPresence. Enable profile writes when the Google account is ready.</AlertDescription></Alert> : null}
          {state.warnings.map((warning) => <Alert key={warning}><AlertTriangle /><AlertTitle>Compatibility note</AlertTitle><AlertDescription>{warning}</AlertDescription></Alert>)}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle>Regular hours</CardTitle><CardDescription>NabaPresence is authoritative; Google is read live.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Day</TableHead><TableHead>NabaPresence</TableHead><TableHead>Google</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader><TableBody>{DAY_NAMES.map((day, index) => { const canonical = state.canonical.regular[index]; const google = state.google.regular[index]; const match = formatPeriods(canonical) === formatPeriods(google); return <TableRow key={day}><TableCell className="font-medium">{day}</TableCell><TableCell>{formatPeriods(canonical)}</TableCell><TableCell>{formatPeriods(google)}</TableCell><TableCell className="text-right"><Badge variant={match ? "secondary" : "outline"}>{match ? "Match" : "Different"}</Badge></TableCell></TableRow> })}</TableBody></Table></CardContent></Card>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Special hours</CardTitle><CardDescription>Holiday and one-off exceptions.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{state.canonical.special.length ? state.canonical.special.map((period) => <div key={period.effectiveDate} className="flex justify-between rounded-2xl border p-3"><span>{period.effectiveDate}</span><span className="text-muted-foreground">{period.isClosed ? "Closed" : `${period.opensAt}–${period.closesAt}`}</span></div>) : <p className="text-sm text-muted-foreground">No special hours scheduled.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Additional hours</CardTitle><CardDescription>Category-specific service periods.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{state.canonical.moreHours.length ? state.canonical.moreHours.flatMap((entry) => entry.periods.map((period, index) => <div key={`${entry.hoursTypeId}-${index}`} className="flex justify-between rounded-2xl border p-3"><span>{entry.hoursTypeId} · {DAY_NAMES[period.dayOfWeek]}</span><span className="text-muted-foreground">{period.opensAt}–{period.closesAt}</span></div>)) : <p className="text-sm text-muted-foreground">No additional hours configured.</p>}</CardContent></Card>
      </div>

      {editOpen ? <HoursEditor state={state} open onOpenChange={setEditOpen} onSaved={onRefresh} /> : null}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}><DialogContent><DialogHeader><DialogTitle>Publish NabaPresence hours to Google?</DialogTitle><DialogDescription>Google validates the approved fields first. NabaPresence then reads the location back and records the reconciliation.</DialogDescription></DialogHeader><div className="rounded-2xl border p-4 text-sm">Approved fields: {state.updateMask.join(", ")}</div>{requiresOverwrite ? <label className="flex items-start gap-3 rounded-2xl border p-4 text-sm"><Checkbox checked={confirmOverwrite} onCheckedChange={(value) => setConfirmOverwrite(value === true)} /> I reviewed the independently changed Google hours and approve overwriting them.</label> : null}<DialogFooter showCloseButton><Button onClick={publish} disabled={pending || (requiresOverwrite && !confirmOverwrite)}>{pending ? <Spinner /> : <Send />} Validate and publish</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}

export function LocationHoursView({ locationId }: { locationId: string }) {
  const [state, setState] = useState<HoursViewState | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [key, setKey] = useState(0)
  const refresh = useCallback(() => { setStatus("loading"); setKey((value) => value + 1) }, [])
  useEffect(() => { let active = true; void loadLocationHours(locationId).then(({ hours }) => { if (active) { setState(hours); setStatus("ready") } }).catch(() => { if (active) setStatus("error") }); return () => { active = false } }, [locationId, key])
  if (status === "loading") return <div className="flex flex-col gap-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>
  if (status === "error" || !state) return <LiveDataError onRetry={refresh} />
  return <ManagedHours state={state} onRefresh={refresh} />
}
