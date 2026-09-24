begin;

-- ---------------------------------------------------------------------------
-- Reconcile never retires.
--
-- Before the queue (0048) the reconcile cron walked every linked location
-- regardless of checkpoint status, so a reconcile settled 'dead' for an
-- unverified, removed or withdrawn listing was simply tried again 15 minutes
-- later. The queue claims nothing dead, which made that state permanent: a
-- business that verified its listing, or restored the login's access, never
-- had its reviews checked again. syncLinkedLocation no longer settles a
-- reconcile as dead (it re-checks such listings every six hours); this puts
-- the rows it already retired back on the queue.
-- ---------------------------------------------------------------------------

update sync_checkpoint
set
  status = 'failed',
  next_attempt_at = now(),
  lease_expires_at = null
where sync_type = 'reconcile'
  and status = 'dead'
  and dead_lettered_at is null;

insert into schema_migration (version) values ('0053_reconcile_never_dead')
on conflict (version) do nothing;

commit;
