create table if not exists public.manager_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  admin_id uuid not null references public.profiles(id),
  placeholder_name text not null check (char_length(trim(placeholder_name)) between 1 and 120),
  status text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  used_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists manager_invites_admin_status_idx
on public.manager_invites(admin_id, status, created_at desc);

alter table public.manager_invites enable row level security;

drop policy if exists "manager invites admin select" on public.manager_invites;
create policy "manager invites admin select" on public.manager_invites for select
  to authenticated using ((select private.current_role()) = 'admin');

revoke insert, update, delete on public.manager_invites from authenticated;
