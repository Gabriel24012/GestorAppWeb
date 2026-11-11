create table if not exists public.capturer_goals (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.profiles(id),
  capturer_id uuid references public.profiles(id),
  period_type text not null check (period_type in ('daily', 'weekly', 'monthly')),
  target_count integer not null check (target_count > 0),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (ends_on >= starts_on)
);

create unique index if not exists capturer_goals_one_active_idx
on public.capturer_goals(capturer_id, period_type)
where status = 'active' and archived_at is null;

create unique index if not exists capturer_goals_one_team_active_idx
on public.capturer_goals(manager_id, period_type)
where capturer_id is null and status = 'active' and archived_at is null;

create index if not exists capturer_goals_manager_idx
on public.capturer_goals(manager_id, capturer_id, period_type, created_at desc);

alter table public.capturer_goals enable row level security;

drop policy if exists "capturer goals manager select" on public.capturer_goals;
create policy "capturer goals manager select" on public.capturer_goals for select
  to authenticated using (
    manager_id = (select auth.uid())
    or (select private.current_role()) = 'admin'
  );

revoke insert, update, delete on public.capturer_goals from authenticated;
