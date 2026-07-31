"use client"

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Pencil, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type { ProfileFieldKey } from "@/lib/domain/profile"
import {
  loadLocationProfile,
  saveLocationProfile,
  syncLocationProfile,
  type ProfileViewState,
} from "@/lib/naba-presence-api"

const FIELD_LABELS: Record<ProfileFieldKey, string> = {
  name: "Business name",
  description: "Description",
  phone: "Primary phone",
  address: "Address",
  mapsUrl: "Google Maps URL",
  reviewUrl: "Google review URL",
  website: "Website",
}

const STATUS_COPY = { in_sync: "In sync", core_dirty: "NabaPresence changed", google_dirty: "Google changed", conflict: "Conflict" } as const

function statusVariant(status: string) {
  if (status === "conflict") return "destructive" as const
  if (status === "in_sync") return "secondary" as const
  return "outline" as const
}

function EditProfileDialog({ state, open, onOpenChange, onSaved }: {
  state: ProfileViewState
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const initial = () => Object.fromEntries(state.fields.filter((field) => ["name", "description", "phone", "website"].includes(field.key)).map((field) => [field.key, field.canonicalValue ?? ""])) as Record<"name" | "description" | "phone" | "website", string>
  const [values, setValues] = useState(initial)
  const [pending, startTransition] = useTransition()
  function save() {
    startTransition(async () => {
      try {
        await saveLocationProfile(state.location.id, {
          expectedCanonicalRevision: state.canonicalResource.revision,
          values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() || null])),
        })
        toast.add({ type: "success", title: "Canonical profile saved" })
        onOpenChange(false)
        onSaved()
      } catch (error) {
        toast.add({ type: "error", title: error instanceof Error ? error.message : "Profile could not be saved." })
      }
    })
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Edit NabaPresence profile</DialogTitle><DialogDescription>Save locally, then choose exactly which changed fields to publish to Google.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label htmlFor="profile-name">Business name</Label><Input id="profile-name" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></div><div className="grid gap-2"><Label htmlFor="profile-description">Description</Label><Textarea id="profile-description" value={values.description} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} maxLength={750} /></div><div className="grid gap-2"><Label htmlFor="profile-phone">Primary phone</Label><Input id="profile-phone" value={values.phone} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))} /></div><div className="grid gap-2"><Label htmlFor="profile-website">Website</Label><Input id="profile-website" type="url" value={values.website} onChange={(event) => setValues((current) => ({ ...current, website: event.target.value }))} /></div></div><DialogFooter showCloseButton><Button onClick={save} disabled={pending}>{pending ? <Spinner /> : null} Save profile</Button></DialogFooter></DialogContent></Dialog>
}

function ManagementView({ state, onRefresh }: { state: ProfileViewState; onRefresh: () => void }) {
  const [direction, setDirection] = useState<"to_google" | "from_google">("to_google")
  const [selectedFields, setSelectedFields] = useState<ProfileFieldKey[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const selectedHasRisk = useMemo(() => state.fields.some((field) => selectedFields.includes(field.key) && (field.status === "conflict" || (direction === "to_google" && field.status === "google_dirty") || (direction === "from_google" && field.status === "core_dirty"))), [direction, selectedFields, state.fields])

  function changeDirection(value: string | null) {
    const next = value === "from_google" ? "from_google" : "to_google"
    setDirection(next)
    setSelectedFields([])
    setConfirmed(false)
  }

  function runSync() {
    startTransition(async () => {
      try {
        const result = await syncLocationProfile(state.location.id, {
          direction,
          selectedFields,
          expectedCanonicalRevision: state.canonicalResource.revision,
          expectedCanonicalHash: state.canonicalHash,
          expectedGoogleHash: state.googleHash,
          confirmOverwriteGoogleChanges: direction === "to_google" && confirmed,
          confirmOverwriteCanonicalChanges: direction === "from_google" && confirmed,
        })
        toast.add({ type: "success", title: result.status === "published" ? "Profile published to Google" : "Google fields imported into NabaPresence" })
        setDialogOpen(false)
        setSelectedFields([])
        setConfirmed(false)
        onRefresh()
      } catch (error) {
        toast.add({ type: "error", title: error instanceof Error ? error.message : "The profile operation failed." })
      }
    })
  }

  return <div className="flex flex-col gap-4">
    <Card><CardHeader><CardTitle>Profile management</CardTitle><CardDescription>NabaPresence owns the canonical profile and connects directly to Google Business Profile.</CardDescription><CardAction><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw /> Refresh</Button><Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!state.canPublish}><Pencil /> Edit profile</Button></div></CardAction></CardHeader><CardContent><div className="grid gap-2"><Label htmlFor="profile-direction">Operation</Label><Select value={direction} onValueChange={changeDirection}><SelectTrigger id="profile-direction" className="w-full sm:w-96"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="to_google">Publish NabaPresence → Google</SelectItem><SelectItem value="from_google">Import Google → NabaPresence</SelectItem></SelectContent></Select><p className="text-sm text-muted-foreground">Address and Google-generated links can be imported but are not published. Website is managed by NabaPresence.</p></div></CardContent></Card>

    {direction === "to_google" && !state.googleWritesEnabled ? <Alert><AlertTriangle /><AlertTitle>Google profile writes are paused</AlertTitle><AlertDescription>Canonical editing remains available. Enable the profile-write control to publish.</AlertDescription></Alert> : null}

    <Card><CardHeader><CardTitle>Field comparison</CardTitle><CardDescription>Revision {state.canonicalResource.revision} compared with a live Google read.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table className="min-w-[820px]"><TableHeader><TableRow><TableHead className="w-10"><span className="sr-only">Select</span></TableHead><TableHead>Field</TableHead><TableHead>NabaPresence</TableHead><TableHead>Google</TableHead><TableHead>Policy</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader><TableBody>{state.fields.map((field) => { const supported = field.policy !== "google_read_only" && (direction === "from_google" || field.policy === "bidirectional"); return <TableRow key={field.key}><TableCell><Checkbox aria-label={`Select ${FIELD_LABELS[field.key]}`} checked={selectedFields.includes(field.key)} disabled={!supported || field.status === "in_sync"} onCheckedChange={(value) => { setSelectedFields((current) => value === true ? [...new Set([...current, field.key])] : current.filter((key) => key !== field.key)); setConfirmed(false) }} /></TableCell><TableCell className="font-medium">{FIELD_LABELS[field.key]}</TableCell><TableCell className="max-w-[260px] break-words text-muted-foreground">{field.canonicalValue || "—"}</TableCell><TableCell className="max-w-[260px] break-words text-muted-foreground">{field.googleValue || "—"}</TableCell><TableCell><Badge variant="outline">{field.policy === "bidirectional" ? "Publish + import" : field.policy === "import_only" ? "Import only" : "Google read-only"}</Badge></TableCell><TableCell className="text-right"><Badge variant={statusVariant(field.status)}>{STATUS_COPY[field.status]}</Badge></TableCell></TableRow> })}</TableBody></Table></CardContent></Card>

    <Card><CardHeader><CardTitle>Approval</CardTitle><CardDescription>{selectedFields.length ? `${selectedFields.length} field${selectedFields.length === 1 ? "" : "s"} selected.` : "Select changed fields above."}</CardDescription></CardHeader>{selectedHasRisk ? <CardContent><label className="flex items-start gap-3"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /> I reviewed the independent destination changes and approve overwriting the selected values.</label></CardContent> : null}<CardFooter><Button disabled={!selectedFields.length || (direction === "to_google" && !state.googleWritesEnabled) || (selectedHasRisk && !confirmed)} onClick={() => setDialogOpen(true)}>{direction === "to_google" ? <ArrowUpFromLine /> : <ArrowDownToLine />} Review and approve</Button></CardFooter></Card>

    <Card size="sm"><CardHeader><CardTitle>Google categories</CardTitle><CardDescription>Visible for verification and retained as Google-owned classification.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{state.googleDetails.primaryCategory ? <Badge variant="secondary">{state.googleDetails.primaryCategory}</Badge> : <span className="text-sm text-muted-foreground">No primary category returned.</span>}{state.googleDetails.additionalCategories.map((category) => <Badge key={category} variant="outline">{category}</Badge>)}</CardContent></Card>

    {editOpen ? <EditProfileDialog state={state} open onOpenChange={setEditOpen} onSaved={onRefresh} /> : null}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>{direction === "to_google" ? "Publish selected fields to Google?" : "Import selected Google fields into NabaPresence?"}</DialogTitle><DialogDescription>The operation is pinned to canonical revision {state.canonicalResource.revision} and stops if either side changes.</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2">{selectedFields.map((field) => <Badge key={field} variant="outline">{FIELD_LABELS[field]}</Badge>)}</div><DialogFooter showCloseButton><Button onClick={runSync} disabled={pending}>{pending ? <Spinner /> : null} Confirm operation</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

export function LocationProfileView({ locationId }: { locationId: string }) {
  const [state, setState] = useState<ProfileViewState | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [key, setKey] = useState(0)
  const refresh = useCallback(() => { setStatus("loading"); setKey((value) => value + 1) }, [])
  useEffect(() => { let active = true; void loadLocationProfile(locationId).then(({ profile }) => { if (active) { setState(profile); setStatus("ready") } }).catch(() => { if (active) setStatus("error") }); return () => { active = false } }, [locationId, key])
  if (status === "loading") return <div className="flex flex-col gap-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>
  if (status === "error" || !state) return <LiveDataError onRetry={refresh} />
  return <ManagementView state={state} onRefresh={refresh} />
}
