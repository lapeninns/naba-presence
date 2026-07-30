begin;

alter table review
  add column search_document tsvector
  generated always as (
    to_tsvector(
      'simple',
      coalesce(review_text, '') || ' ' ||
      coalesce(reviewer_display_name, '')
    )
  ) stored;

drop index if exists review_search_idx;
create index review_search_idx
  on review using gin (search_document);

grant select (search_document) on review to naba_app_runtime;

insert into schema_migration (version)
values ('0010_inbox_search_document')
on conflict (version) do nothing;

commit;
