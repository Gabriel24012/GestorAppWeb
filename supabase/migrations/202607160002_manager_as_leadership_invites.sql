create table if not exists public.capturer_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  manager_id uuid not null references public.profiles(id),
  placeholder_name text not null check (char_length(trim(placeholder_name)) between 1 and 120),
  status text not null default 'pending' check (status in ('pending', 'used')),
  used_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists capturer_invites_manager_idx
on public.capturer_invites(manager_id, created_at desc);

alter table public.capturer_invites enable row level security;

drop policy if exists "capturer invites manager select" on public.capturer_invites;
create policy "capturer invites manager select" on public.capturer_invites for select
  to authenticated using (
    manager_id = (select auth.uid())
    or (select private.current_role()) = 'admin'
  );

alter table public.records
alter column capture_session_id drop not null;

create or replace function private.owns_session(target_session uuid) returns boolean language sql stable security definer
set search_path = '' as $$
select
  target_session is null
  or exists (
    select 1
    from public.capture_sessions s
    where s.id = target_session
      and s.capturer_id = (select auth.uid())
  )
$$;

create or replace function public.enforce_record_context() returns trigger language plpgsql security definer
set search_path = '' as $$ declare
  session_row public.capture_sessions%rowtype;
  capturer_row public.profiles%rowtype;
  manager_row public.profiles%rowtype;
  actor_role public.app_role;
begin
  actor_role := private.current_role();

  if tg_op = 'INSERT' then
    select * into capturer_row
    from public.profiles
    where id = (select auth.uid())
      and role = 'capturador'
      and is_active;

    if capturer_row.id is null then
      raise exception 'Capturador invalido o inactivo';
    end if;

    select * into manager_row
    from public.profiles
    where id = capturer_row.parent_user_id
      and role = 'gestor'
      and is_active;

    if manager_row.id is null then
      raise exception 'Gestor responsable invalido';
    end if;

    if new.capture_session_id is not null then
      select * into session_row
      from public.capture_sessions
      where id = new.capture_session_id;

      if session_row.id is null
      or session_row.capturer_id <> (select auth.uid()) then
        raise exception 'Sesion de captura no valida';
      end if;
    end if;

    new.capturer_id := capturer_row.id;
    new.manager_id := manager_row.id;
    new.leadership_name := manager_row.full_name;
    new.section_code := coalesce(nullif(new.section_code, ''), 'GENERAL');
  else
    if new.capturer_id <> old.capturer_id
    or new.manager_id <> old.manager_id
    or new.capture_session_id is distinct from old.capture_session_id then
      raise exception 'No se puede modificar la pertenencia del registro';
    end if;

    if actor_role <> 'admin'
    and new.status <> old.status then
      raise exception 'Solo un administrador puede anular o reactivar registros';
    end if;
  end if;

  new.electoral_key := upper(trim(new.electoral_key));
  new.leadership_name := upper(regexp_replace(trim(new.leadership_name), '\s+', ' ', 'g'));
  new.section_code := upper(regexp_replace(trim(new.section_code), '\s+', ' ', 'g'));
  new.updated_at := now();

  return new;
end;
$$;

drop policy if exists "records insert own" on public.records;
create policy "records insert own" on public.records for insert
  to authenticated with check (
    (select private.current_role()) = 'capturador'
    and capturer_id = (select auth.uid())
    and (capture_session_id is null or (select private.owns_session(capture_session_id)))
  );
