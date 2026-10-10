"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { googleAccountNameSchema } from "@/lib/contracts/google-administration-review"
import { SectionGateNote, useAdministrationSection } from "./context"
import { LifecycleWorkspace, useLifecycleContext } from "./lifecycle-workspace"

export function DangerZone() {
  const section = useAdministrationSection(), workflow = useLifecycleContext()
  if (!workflow) return <LifecycleWorkspace locationId={section.locationId} locationName={section.locationName}><DangerZoneControls /></LifecycleWorkspace>
  return <DangerZoneControls />
}

function DangerZoneControls() {
  const section = useAdministrationSection(), workflow = useLifecycleContext()
  const [collecting, setCollecting] = useState(false), [deleting, setDeleting] = useState(false)
  const [destination, setDestination] = useState("")
  const parsed = googleAccountNameSchema.safeParse(destination)
  const blocked = section.writeBlocked || !section.locationName || !workflow || workflow.busy || workflow.unresolved
  function closeTransfer(next: boolean) { setCollecting(next); if (!next) setDestination("") }
  async function previewTransfer() {
    if (!workflow || !parsed.success) return
    try { await workflow.preview({ operation: "transfer_location", payload: { destinationAccount: parsed.data } }); closeTransfer(false) }
    catch (error) { if (!(error instanceof Error)) throw error }
  }
  async function previewDeletion() {
    if (!workflow) return
    try { await workflow.preview({ operation: "delete_location", payload: {} }); setDeleting(false) }
    catch (error) { if (!(error instanceof Error)) throw error }
  }
  return <section aria-labelledby="danger-zone-heading" className="flex min-w-0 flex-col overflow-hidden rounded-(--np-radius-card) border border-danger-ink bg-surface">
    <div className="flex flex-col gap-1 border-b border-line px-4 py-3"><h2 id="danger-zone-heading" className="text-title font-semibold text-ink">Danger zone</h2><p className="text-ui text-ink-muted">Review an exact lifecycle request before approval and sending. Google may reject a request, and NabaPresence cannot undo an accepted deletion.</p></div>
    <ul aria-label="Danger zone actions" className="flex list-none flex-col divide-y divide-line">
      <li className="flex min-w-0 flex-col gap-2 px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-body font-semibold text-ink">Transfer this location</p><p className="text-ui text-ink-muted">Move the exact Google location between accounts. Current source ownership and destination management access must be established.</p></div><Button variant="danger-outline" size="sm" disabled={blocked} onClick={() => setCollecting(true)}>Transfer this location</Button></div><SectionGateNote /></li>
      <li className="flex min-w-0 flex-col gap-2 px-4 py-4"><p className="text-body font-semibold text-ink">Remove from NabaPresence</p><p className="text-ui text-ink-muted">Unlink this app location under <Link href="/settings/connections" className="rounded-(--np-radius-tag) font-medium text-accent-ink underline-offset-3 focus-halo hover:underline">Connections</Link>. Unlinking does not request a change to the business on Google.</p></li>
      <li className="flex min-w-0 flex-col gap-2 px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-body font-semibold text-danger-ink">Request deletion on Google</p><p className="text-ui text-ink-muted">Request deletion of the managed Business Profile location. Search/Maps removal and customer-review deletion are not guaranteed.</p></div><Button variant="danger-outline" size="sm" disabled={blocked} onClick={() => setDeleting(true)}>Delete this location</Button></div><SectionGateNote /></li>
    </ul>
    <Dialog open={collecting} onOpenChange={closeTransfer}><DialogContent><DialogHeader><DialogTitle>Transfer this location</DialogTitle><DialogDescription>Choose an exact destination account, then review current access and the frozen transfer. This step sends no provider write.</DialogDescription></DialogHeader>
      <Field><FieldLabel htmlFor="lifecycle-destination">Destination Google account</FieldLabel><Input id="lifecycle-destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="accounts/…" disabled={workflow?.busy} autoComplete="off" aria-invalid={destination.length > 0 && !parsed.success} />{destination.length > 0 && !parsed.success ? <FieldError>Select an exact Google account resource, such as accounts/123.</FieldError> : null}</Field>
      {workflow?.error ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
      <DialogFooter><DialogClose render={<Button variant="ghost" disabled={workflow?.busy}>Cancel</Button>} /><Button disabled={blocked || !parsed.success} pending={workflow?.busy} onClick={() => { void previewTransfer() }}>Continue to transfer review</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={deleting} onOpenChange={setDeleting}><DialogContent><DialogHeader><DialogTitle>Review managed-location deletion</DialogTitle><DialogDescription>Google&apos;s current deletion eligibility and exact account membership will be read before saving a review. No deletion is sent at this step. The business and customer reviews may remain on Search or Maps.</DialogDescription></DialogHeader>
      {workflow?.error ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
      <DialogFooter><DialogClose render={<Button variant="ghost" disabled={workflow?.busy}>Cancel</Button>} /><Button variant="danger-outline" disabled={blocked} pending={workflow?.busy} onClick={() => { void previewDeletion() }}>Prepare deletion review</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>
}
