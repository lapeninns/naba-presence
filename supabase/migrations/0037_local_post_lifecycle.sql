begin;

-- A publish flips gbp_local_post to 'publishing' before the Google call and
-- only the in-process settle moves it back, so an instance killed mid-flight
-- (the publish route allows 60s, a deploy recycle needs no permission) left
-- the row at 'publishing' forever: 0015 lets that value be terminal, and
-- neither reclaim_expired_jobs nor the retention cron knows this table. The
-- lease is the same device publish_attempt got in 0029 -- it bounds the claim
-- rather than trusting the process that took it to give it back.
--
-- It is also the claim itself. localPostAttempts.start now conditions the
-- transition on status <> 'publishing', so a second concurrent publish of the
-- same post updates no row and is refused; without an expiry that guard would
-- make a stranded post permanently unpublishable.
alter table gbp_local_post
  add column publish_lease_expires_at timestamptz;

-- The reaper's predicate: publishing rows whose lease has run out. Partial,
-- because every other status is uninteresting to it and 'published' is the
-- overwhelming majority of the table.
create index gbp_local_post_publish_lease_idx
  on gbp_local_post (organisation_id, publish_lease_expires_at)
  where status = 'publishing';

insert into schema_migration (version)
values ('0037_local_post_lifecycle')
on conflict (version) do nothing;

commit;
