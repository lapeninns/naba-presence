begin;

-- P09-R2: the bulk approval follows the shared approval policy
-- (lib/server/authz/approval-policy.ts).
--
--   * Under two-person approval the person who prepared a batch can never
--     approve it. The approve route already refuses it; the table now
--     refuses it too, so no writer can record a self-approval.
--   * Reserved for the MFA stream (P02-S9): the approver's verified
--     assurance level and security version at approval. Both stay null
--     until that stream records them; the runner passes the stored version
--     to recheckAuthorisation, which refuses any value it cannot verify.
--
-- A batch already self-approved under two-person approval is kept (its
-- status can still change) and flagged `legacy_self_approved`; the runner's
-- recheck refuses to send any more of it.

alter table bulk_listing_operation
  add column approver_aal text,
  add column authorised_security_version integer,
  add column legacy_self_approved boolean not null default false;

update bulk_listing_operation
set legacy_self_approved = true
where require_two_person_approval
  and approved_by is not null
  and approved_by = requested_by;

alter table bulk_listing_operation
  add constraint bulk_listing_operation_second_approver check (
    legacy_self_approved
    or not require_two_person_approval
    or approved_by is null
    or approved_by <> requested_by
  ),
  add constraint bulk_listing_operation_approver_aal_check
    check (approver_aal is null or approver_aal in ('aal1', 'aal2')),
  add constraint bulk_listing_operation_assurance_needs_approval check (
    (approver_aal is null and authorised_security_version is null)
    or approved_by is not null
  );

-- `legacy_self_approved` is set only by this migration: no insert or update
-- can turn it on, so it cannot be used to slip past the check above.
create function bulk_listing_operation_legacy_self_approved_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.legacy_self_approved
    and (tg_op = 'INSERT' or not old.legacy_self_approved) then
    raise exception 'legacy_self_approved is set only by migration 0261'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger bulk_listing_operation_legacy_self_approved_guard
  before insert or update of legacy_self_approved on bulk_listing_operation
  for each row execute function bulk_listing_operation_legacy_self_approved_guard();

insert into schema_migration(version) values ('0261_bulk_approval_policy') on conflict (version) do nothing;
commit;
