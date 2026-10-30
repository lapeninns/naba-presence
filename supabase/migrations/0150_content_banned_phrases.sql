begin;

-- S4: Inherits organisation tenancy and existing runtime table grants.
alter table organisation add column banned_phrases text[] not null default '{}';
alter table organisation add constraint organisation_banned_phrases_count
  check (cardinality(banned_phrases) <= 100);

-- Acknowledgement is bound to post content and policy by the server.
alter table gbp_local_post add column content_warning_acknowledgement text;

insert into schema_migration(version) values ('0150_content_banned_phrases') on conflict (version) do nothing;
commit;
