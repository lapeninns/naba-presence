"use client"

import { Check, UserPlus } from "lucide-react"
import { useEffect, useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import {
  InvitationsList,
  InviteDialog,
} from "@/components/settings/invitations-panel"
import { MembersTable } from "@/components/settings/members-table"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SectionHeader } from "@/components/ui/section-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useMembers } from "@/lib/queries/use-members"
import {
  MEMBER_ROLES,
  roleLabel,
  type MemberRole,
} from "@/lib/settings/forms/invitation"
import { ROLE_MATRIX, type Capability } from "@/lib/settings/roles"

function CapabilityValue({ value }: { value: Capability }) {
  if (value.kind === "yes") {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-success-ink">
        <Check className="size-3.5" strokeWidth={2} aria-hidden />
        Yes
      </span>
    )
  }
  if (value.kind === "no") return <span className="text-ink-muted">No</span>
  return <span className="font-semibold text-info-ink">{value.text}</span>
}

/** The member count beside the Members heading, once the list has loaded. */
function MembersCount() {
  const query = useMembers()
  if (!query.data) return null
  const members = query.data.members
  const owners = members.filter((m) => m.role === "owner").length
  return (
    <>
      {members.length} {members.length === 1 ? "person" : "people"} · {owners}{" "}
      {owners === 1 ? "owner" : "owners"}
    </>
  )
}

/**
 * Team (reference `team.html`): the header's "Invite a teammate", the
 * members table, pending invitations and what each role can do. `#invite`
 * in the address opens the invite dialog, and closing it drops the hash.
 */
export function TeamView({
  actorRole,
  actorUserId,
}: {
  actorRole: MemberRole
  actorUserId: string
}) {
  const [inviteOpen, setInviteOpen] = useState(false)

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#invite") setInviteOpen(true)
    }
    openFromHash()
    window.addEventListener("hashchange", openFromHash)
    return () => window.removeEventListener("hashchange", openFromHash)
  }, [])

  const onInviteOpenChange = (open: boolean) => {
    setInviteOpen(open)
    if (!open && window.location.hash === "#invite") {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search
      )
    }
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can see and act on your clients’ reviews and settings."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden />
            Invite a teammate
          </Button>
        }
      />

      <section aria-labelledby="team-members" className="flex flex-col gap-3">
        <SectionHeader
          id="team-members"
          title="Members"
          description={<MembersCount />}
        />
        <MembersTable actorRole={actorRole} actorUserId={actorUserId} />
      </section>

      <section
        aria-labelledby="team-invitations"
        className="flex flex-col gap-3"
      >
        <SectionHeader
          id="team-invitations"
          title="Invitations"
          description="Invite links expire after 7 days. Members and viewers see every client unless you choose clients when inviting them, or later from Client access."
        />
        <InvitationsList onInvite={() => setInviteOpen(true)} />
      </section>

      <section aria-labelledby="team-roles">
        <Card flush>
          <CardHeader divided>
            <CardTitle as="h2" id="team-roles">
              What each role can do
            </CardTitle>
            <CardDescription>
              Roles set what someone may do; client access sets where.
              Publishing is a separate switch for Members.
            </CardDescription>
          </CardHeader>
          <Table responsive aria-labelledby="team-roles">
            <TableHeader>
              <TableRow>
                <TableHead>Can they…</TableHead>
                {MEMBER_ROLES.map((role) => (
                  <TableHead key={role}>{roleLabel(role)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLE_MATRIX.map((row) => (
                <TableRow key={row.capability}>
                  <TableCell label="Capability" className="font-semibold">
                    {row.capability}
                  </TableCell>
                  {row.cells.map((cell, index) => (
                    <TableCell
                      key={MEMBER_ROLES[index]}
                      label={roleLabel(MEMBER_ROLES[index])}
                    >
                      <CapabilityValue value={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <InviteDialog
        actorRole={actorRole}
        open={inviteOpen}
        onOpenChange={onInviteOpenChange}
      />
    </>
  )
}
