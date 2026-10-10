import "server-only"

import type { TransactionSql } from "postgres"

export function locationActivityProjection(sql: TransactionSql, locationId: string) {
  return sql`
    select 'management:' || m.id as id, m.id::text as source_id, 'management' as source,
      m.resource_type, m.operation, m.status, m.target_resource_name,
      m.last_error_code, m.update_mask, m.created_at, m.finished_at, m.actor_user_id,
      m.execution_state, m.confirmation_state,
      ((m.resource_type in ('lodging', 'attributes') or (m.resource_type = 'business_info' and m.change_set_id is not null)) and (m.status = 'ambiguous' or
        (m.status in ('started', 'validated') and m.created_at < now() - interval '5 minutes'))) as can_confirm
    from gbp_management_mutation m where m.location_id = ${locationId}
    union all
    select 'hours:' || m.id, m.id::text, 'hours', 'hours', m.operation, m.status,
      null, m.provider_error_code, m.update_mask, m.created_at, m.finished_at,
      m.actor_user_id, 'unrecorded', 'unrecorded', false
    from hours_sync_attempt m where m.location_id = ${locationId}
    union all
    select 'profile:' || m.id, m.id::text, 'profile', 'profile', m.operation, m.status,
      null, m.provider_error_code, m.update_mask, m.created_at, m.finished_at,
      m.actor_user_id, 'unrecorded', 'unrecorded', false
    from profile_sync_attempt m where m.location_id = ${locationId}
    union all
    select 'menus:' || m.id, m.id::text, 'menus', 'food_menus', 'publish', m.status,
      null, m.last_error_code, array[]::text[], m.created_at, m.finished_at,
      m.actor_user_id, 'unrecorded', 'unrecorded', false
    from food_menus_sync_attempt m where m.location_id = ${locationId}
    union all
    select 'links:' || m.id, m.id::text, 'links', 'place_actions', m.operation, m.status,
      m.google_link_name, m.last_error_code, array[]::text[], m.created_at, m.finished_at,
      m.actor_user_id, m.execution_state, m.confirmation_state, false
    from place_action_mutation m where m.location_id = ${locationId}
    union all
    select 'media:' || m.id, m.id::text, 'media', 'media', m.operation, m.status,
      null, m.last_error_code, array[]::text[], m.created_at, m.finished_at,
      m.actor_user_id, 'unrecorded', 'unrecorded', false
    from gbp_media_mutation m where m.location_id = ${locationId}
    union all
    select 'posts:' || m.id, m.id::text, 'posts', 'posts', m.operation, m.status,
      null, m.provider_error_code, array[]::text[], m.created_at, m.finished_at,
      m.actor_user_id, 'unrecorded', 'unrecorded', false
    from gbp_local_post_attempt m join gbp_local_post p on p.id = m.post_id
    where p.location_id = ${locationId}
    union all
    select 'reviews:' || m.id, m.id::text, 'reviews', 'reviews', m.operation, m.status,
      null, m.provider_error_code, array[]::text[], m.started_at, m.finished_at,
      null::uuid, 'unrecorded', 'unrecorded', false
    from publish_attempt m join review_reply rr on rr.id = m.review_reply_id
    join review r on r.id = rr.review_id where r.location_id = ${locationId}
    union all
    select 'bulk:' || c.id, c.id::text, 'bulk', o.operation, 'bulk_change', c.status,
      null, coalesce(c.result_code, c.skip_reason), c.update_mask, c.created_at, c.finished_at,
      o.approved_by, case when c.status = 'succeeded' then 'accepted' when c.status = 'ambiguous' then 'unknown'
        when c.status = 'failed' and c.result_code like 'provider_rejected%' then 'rejected' else 'unrecorded' end,
      c.confirmation_state, false
    from bulk_listing_child c join bulk_listing_operation o on o.id = c.operation_id
    where c.location_id = ${locationId} and c.status not in ('previewed', 'skipped')
    union all
    select 'schedule:' || s.id, s.id::text, 'schedule', 'posts', 'scheduled_publication', s.status,
      null, s.status_reason, array[]::text[], coalesce(s.started_at, s.intended_at), s.finished_at,
      p.approved_by, 'unrecorded', 'unrecorded', false
    from post_publication_occurrence s join post_publication_schedule p on p.id = s.schedule_id
    where s.location_id = ${locationId} and s.status not in ('scheduled', 'cancelled')
  `
}
