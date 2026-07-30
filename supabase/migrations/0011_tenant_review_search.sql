begin;

create or replace function search_review_ids(
  p_organisation_id uuid,
  p_search text,
  p_search_hash text
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
      );
end;
$$;

revoke all on function search_review_ids(uuid, text, text) from public;
grant execute on function search_review_ids(uuid, text, text)
  to naba_app_runtime;

insert into schema_migration (version)
values ('0011_tenant_review_search')
on conflict (version) do nothing;

commit;
