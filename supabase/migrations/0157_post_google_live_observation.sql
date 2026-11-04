begin;

-- Record the transition once. Routine reconciliation may update the row
-- repeatedly, and existing LIVE rows have no reliable observation time.
alter table gbp_local_post add column google_live_observed_at timestamptz;

create function track_post_google_live_observation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.google_state is distinct from 'LIVE' then
    new.google_live_observed_at := null;
  elsif tg_op = 'INSERT' then
    new.google_live_observed_at := statement_timestamp();
  elsif old.google_state is distinct from 'LIVE' then
    new.google_live_observed_at := statement_timestamp();
  else
    new.google_live_observed_at := old.google_live_observed_at;
  end if;
  return new;
end;
$$;

create trigger gbp_local_post_google_live_observation
before insert or update of google_state on gbp_local_post
for each row execute function track_post_google_live_observation();

insert into schema_migration (version) values ('0157_post_google_live_observation');

commit;
