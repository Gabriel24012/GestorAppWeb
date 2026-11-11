alter table public.capturer_goals
  alter column capturer_id drop not null;

create unique index if not exists capturer_goals_one_team_active_idx
on public.capturer_goals(manager_id, period_type)
where capturer_id is null and status = 'active' and archived_at is null;
