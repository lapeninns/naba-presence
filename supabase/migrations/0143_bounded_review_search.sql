begin;

-- W4-07. The inbox now applies its search predicate inline, beside the
-- tenant filter. Under the runtime role's forced RLS that predicate cannot
-- drive an index: `@@` (ts_match_vq) is not leakproof, so Postgres neither
-- uses it as an index condition nor reads column statistics for it, and a
-- rare term becomes a scan. This definer helper keeps the GIN path for rare
-- terms and is bounded, so a common term no longer materialises every match
-- in the tenant: the caller asks for one row more than it will use, and
-- treats a full result as "too many to list; filter inline instead".
--
-- Same tenant guard and match as search_review_ids (0011), which stays in
-- place for code still deployed against it; a later migration drops it.
create or replace function search_review_ids_bounded(
  p_organisation_id uuid,
  p_search text,
  p_search_hash text,
  p_limit integer
)
returns table (review_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_organisation_id is distinct from
    nullif(current_setting('app.organisation_id', true), '')::uuid
  then
    raise exception 'tenant context does not match search organisation'
      using errcode = '42501';
  end if;

  return query
    select r.id
    from review r
    where r.organisation_id = p_organisation_id
      and (
        r.search_document
          @@ websearch_to_tsquery('simple', p_search)
        or r.google_review_id_hash = p_search_hash
        or r.google_review_name_hash = p_search_hash
      )
    limit p_limit;
end;
$$;

revoke all on function search_review_ids_bounded(uuid, text, text, integer)
  from public;
grant execute on function search_review_ids_bounded(uuid, text, text, integer)
  to naba_app_runtime;

insert into schema_migration (version)
values ('0143_bounded_review_search')
on conflict (version) do nothing;

commit;
