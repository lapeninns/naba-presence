begin;

-- ---------------------------------------------------------------------------
-- Bind an approval decision to the draft it was asked about.
--
-- The approval route resolved the draft server-side, as "the newest draft of
-- this review that passed verification". That is not the artefact anybody
-- approved: requestApproval parks ONE draft (its body goes to
-- review_reply.current_body), and a request that names an older draft, or a
-- re-park by a second member, leaves the route publishing text the approver
-- never read while approval_decision and the audit row assert they did.
--
-- pending_draft_id records what was parked, so the decision, the
-- approval_decision row and the provider mutation all name the same draft.
--
-- The trigger fills it because the writer that ought to set it -
-- requestApproval - is reached from the publish pipeline, and derives the
-- column from the parked body that pipeline already writes. It only fills a
-- NULL, so an explicit write from that pipeline later takes precedence and
-- this becomes a backstop. It is deliberately not SECURITY DEFINER: the
-- subselect runs under the caller's RLS, so it can only ever see drafts of
-- the tenant whose reply row is being written.
-- ---------------------------------------------------------------------------

alter table review_reply
  add column if not exists pending_draft_id uuid
    references draft(id) on delete set null;

create or replace function bind_review_reply_pending_draft()
returns trigger
language plpgsql
as $$
begin
  if new.publish_status <> 'awaiting_approval' then
    -- Rejected, published, failed, or re-entered as a publish intent: there
    -- is no parked draft any more, and a stale one would outlive its decision.
    new.pending_draft_id := null;
    return new;
  end if;
  if new.pending_draft_id is null then
    new.pending_draft_id := (
      select d.id
      from draft d
      where d.organisation_id = new.organisation_id
        and d.review_id = new.review_id
        and d.body = new.current_body
        and d.verification_status in ('pass', 'warn')
      order by d.created_at desc
      limit 1
    );
  end if;
  return new;
end;
$$;

drop trigger if exists review_reply_pending_draft on review_reply;
create trigger review_reply_pending_draft
  before insert or update on review_reply
  for each row execute function bind_review_reply_pending_draft();

-- Replies parked before this migration: same derivation, applied once.
update review_reply rr
set pending_draft_id = (
  select d.id
  from draft d
  where d.organisation_id = rr.organisation_id
    and d.review_id = rr.review_id
    and d.body = rr.current_body
    and d.verification_status in ('pass', 'warn')
  order by d.created_at desc
  limit 1
)
where rr.publish_status = 'awaiting_approval'
  and rr.pending_draft_id is null;

-- 'pending' is what verification records when the semantic pass was attempted
-- and the provider could not be reached. draft.verification_status has always
-- had that value; the result row could not say it, so a draft nothing checked
-- had to be stored as a pass, a warn or a fail.
alter table verification_result
  drop constraint if exists verification_result_verdict_check;

alter table verification_result
  add constraint verification_result_verdict_check
  check (verdict in ('pass', 'warn', 'fail', 'pending'));

insert into schema_migration (version)
values ('0039_draft_approval_binding')
on conflict (version) do nothing;

commit;
