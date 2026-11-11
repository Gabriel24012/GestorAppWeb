update public.capturer_goals g
set created_by_role = 'admin'
where exists (
  select 1
  from public.audit_events a
  where a.entity = 'capturer_goals'
    and a.entity_id = g.id
    and a.action = 'admin_create_manager_goal'
);
