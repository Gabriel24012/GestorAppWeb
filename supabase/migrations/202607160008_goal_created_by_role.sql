alter table public.capturer_goals
  add column if not exists created_by_role text not null default 'gestor'
  check (created_by_role in ('admin', 'gestor'));

update public.capturer_goals
set created_by_role = 'gestor'
where created_by_role is null;
