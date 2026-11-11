create extension if not exists pgcrypto;

create extension if not exists citext;

create type public.app_role as enum ('admin', 'gestor', 'capturador');

create type public.session_status as enum ('open', 'closed');

create type public.record_status as enum ('active', 'voided');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text not null check (
    char_length(trim(full_name)) between 1
    and 120
  ),
  role public.app_role not null,
  parent_user_id uuid references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  capturer_id uuid not null references public.profiles(id),
  manager_id uuid not null references public.profiles(id),
  leadership_name text not null check (
    char_length(trim(leadership_name)) between 1
    and 120
  ),
  section_code text not null check (
    char_length(trim(section_code)) between 1
    and 40
  ),
  status public.session_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.records (
  id uuid primary key default gen_random_uuid(),
  capture_session_id uuid not null references public.capture_sessions(id),
  capturer_id uuid not null references public.profiles(id),
  manager_id uuid not null references public.profiles(id),
  leadership_name text not null check (
    char_length(trim(leadership_name)) between 1
    and 120
  ),
  section_code text not null check (
    char_length(trim(section_code)) between 1
    and 40
  ),
  first_name text not null check (
    char_length(trim(first_name)) between 1
    and 80
  ),
  paternal_surname text not null check (
    char_length(trim(paternal_surname)) between 1
    and 80
  ),
  maternal_surname text,
  address text not null check (
    char_length(trim(address)) between 1
    and 250
  ),
  exterior_number text,
  neighborhood text,
  district text,
  postal_code char(5),
  birth_date date not null check (birth_date between (current_date - interval '120 years')::date and current_date),
  phone char(10) not null check (phone ~ '^[0-9]{10}$'),
  electoral_key varchar(18) not null unique check (electoral_key ~ '^[A-Z0-9]{18}$'),
  observations text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    postal_code is null
    or postal_code ~ '^[0-9]{5}$'
  )
);

create table public.record_versions (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.records(id) on delete restrict,
  version_number integer not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  snapshot jsonb not null,
  unique(record_id, version_number)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  entity text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}' :: jsonb,
  created_at timestamptz not null default now()
);

-- Ejecutar después de crear el usuario inicial en Supabase Auth:
-- select public.bootstrap_admin('admin@example.com');
create
or replace function public.bootstrap_admin(admin_email text) returns public.profiles language plpgsql security definer
set
  search_path = '' as $$ declare result public.profiles;

begin
insert into
  public.profiles(id, email, full_name, role)
select
  id,
  email,
  coalesce(
    raw_user_meta_data ->> 'full_name',
    split_part(email, '@', 1)
  ),
  'admin' :: public.app_role
from
  auth.users
where
  lower(email) = lower(admin_email) on conflict (id) do
update
set
  role = 'admin',
  parent_user_id = null,
  is_active = true returning * into result;

if result.id is null then raise exception 'No existe un usuario Auth con ese correo';

end if;

return result;

end;

$$;

revoke all on function public.bootstrap_admin(text)
from
  public,
  anon,
  authenticated;

create index capture_sessions_capturer_idx on public.capture_sessions(capturer_id, created_at desc);

create index capture_sessions_manager_idx on public.capture_sessions(manager_id, created_at desc);

create index records_capturer_idx on public.records(capturer_id, created_at desc);

create index records_manager_idx on public.records(manager_id, created_at desc);

create index records_classification_idx on public.records(leadership_name, section_code);

create index record_versions_record_idx on public.record_versions(record_id, version_number desc);

create index profiles_parent_role_idx on public.profiles(parent_user_id, role);

create schema if not exists private;

revoke all on schema private
from
  public;

grant usage on schema private to authenticated;

create
or replace function private.current_role() returns public.app_role language sql stable security definer
set
  search_path = '' as $$
select
  p.role
from
  public.profiles p
where
  p.id = (
    select
      auth.uid()
  ) $$;

create
or replace function private.is_manager_of(target_capturer uuid) returns boolean language sql stable security definer
set
  search_path = '' as $$
select
  (
    select
      private.current_role()
  ) = 'admin'
  or exists (
    select
      1
    from
      public.profiles p
    where
      p.id = target_capturer
      and p.parent_user_id = (
        select
          auth.uid()
      )
      and p.role = 'capturador'
  ) $$;

create
or replace function private.owns_session(target_session uuid) returns boolean language sql stable security definer
set
  search_path = '' as $$
select
  exists (
    select
      1
    from
      public.capture_sessions s
    where
      s.id = target_session
      and s.capturer_id = (
        select
          auth.uid()
      )
  ) $$;

grant execute on function private.current_role(),
private.is_manager_of(uuid),
private.owns_session(uuid) to authenticated;

create
or replace function public.enforce_profile_hierarchy() returns trigger language plpgsql security definer
set
  search_path = '' as $$ declare parent_role public.app_role;

begin if new.role = 'admin' then if new.parent_user_id is not null then raise exception 'Un administrador no puede tener superior';

end if;

else if new.parent_user_id is null then raise exception 'El perfil requiere un superior';

end if;

select
  role into parent_role
from
  public.profiles
where
  id = new.parent_user_id;

if (
  new.role = 'gestor'
  and parent_role <> 'admin'
)
or (
  new.role = 'capturador'
  and parent_role <> 'gestor'
) then raise exception 'Jerarquía de perfil inválida';

end if;

end if;

new.email := lower(trim(new.email));

new.updated_at := now();

return new;

end;

$$;

create
or replace function public.enforce_session_owner() returns trigger language plpgsql security definer
set
  search_path = '' as $$ declare assigned_manager uuid;

begin
select
  parent_user_id into assigned_manager
from
  public.profiles
where
  id = new.capturer_id
  and role = 'capturador'
  and is_active;

if assigned_manager is null then raise exception 'Capturador inválido o inactivo';

end if;

if tg_op = 'INSERT'
and new.capturer_id <> (
  select
    auth.uid()
) then raise exception 'La sesión debe pertenecer al usuario actual';

end if;

new.manager_id := assigned_manager;

new.leadership_name := upper(
  regexp_replace(trim(new.leadership_name), '\s+', ' ', 'g')
);

new.section_code := upper(
  regexp_replace(trim(new.section_code), '\s+', ' ', 'g')
);

new.updated_at := now();

return new;

end;

$$;

create
or replace function public.enforce_record_context() returns trigger language plpgsql security definer
set
  search_path = '' as $$ declare session_row public.capture_sessions%rowtype;

actor_role public.app_role;

begin actor_role := private.current_role();

if tg_op = 'INSERT' then
select
  * into session_row
from
  public.capture_sessions
where
  id = new.capture_session_id;

if session_row.id is null
or session_row.capturer_id <> (
  select
    auth.uid()
) then raise exception 'Sesión de captura no válida';

end if;

new.capturer_id := session_row.capturer_id;

new.manager_id := session_row.manager_id;

new.leadership_name := coalesce(
  nullif(new.leadership_name, ''),
  session_row.leadership_name
);

new.section_code := coalesce(
  nullif(new.section_code, ''),
  session_row.section_code
);

else if new.capturer_id <> old.capturer_id
or new.manager_id <> old.manager_id
or new.capture_session_id <> old.capture_session_id then raise exception 'No se puede modificar la pertenencia del registro';

end if;

if actor_role <> 'admin'
and new.status <> old.status then raise exception 'Solo un administrador puede anular o reactivar registros';

end if;

end if;

new.electoral_key := upper(trim(new.electoral_key));

new.leadership_name := upper(
  regexp_replace(trim(new.leadership_name), '\s+', ' ', 'g')
);

new.section_code := upper(
  regexp_replace(trim(new.section_code), '\s+', ' ', 'g')
);

new.updated_at := now();

return new;

end;

$$;

create
or replace function public.save_record_version() returns trigger language plpgsql security definer
set
  search_path = '' as $$ begin
insert into
  public.record_versions(record_id, version_number, changed_by, snapshot)
values
  (
    old.id,
    coalesce(
      (
        select
          max(version_number) + 1
        from
          public.record_versions
        where
          record_id = old.id
      ),
      1
    ),
    (
      select
        auth.uid()
    ),
    to_jsonb(old)
  );

return new;

end;

$$;

create trigger profiles_hierarchy before
insert
  or
update
  on public.profiles for each row execute function public.enforce_profile_hierarchy();

create trigger sessions_owner before
insert
  or
update
  on public.capture_sessions for each row execute function public.enforce_session_owner();

create trigger records_context before
insert
  or
update
  on public.records for each row execute function public.enforce_record_context();

create trigger records_version before
update
  on public.records for each row execute function public.save_record_version();

alter table
  public.profiles enable row level security;

alter table
  public.capture_sessions enable row level security;

alter table
  public.records enable row level security;

alter table
  public.record_versions enable row level security;

alter table
  public.audit_events enable row level security;

create policy "profiles select scoped" on public.profiles for
select
  to authenticated using (
    id = (
      select
        auth.uid()
    )
    or (
      select
        private.current_role()
    ) = 'admin'
    or (
      (
        select
          private.current_role()
      ) = 'gestor'
      and role = 'capturador'
      and parent_user_id = (
        select
          auth.uid()
      )
    )
  );

create policy "sessions select scoped" on public.capture_sessions for
select
  to authenticated using (
    capturer_id = (
      select
        auth.uid()
    )
    or (
      select
        private.current_role()
    ) = 'admin'
    or (
      select
        private.is_manager_of(capturer_id)
    )
  );

create policy "sessions insert own" on public.capture_sessions for
insert
  to authenticated with check (
    (
      select
        private.current_role()
    ) = 'capturador'
    and capturer_id = (
      select
        auth.uid()
    )
  );

create policy "sessions update own" on public.capture_sessions for
update
  to authenticated using (
    capturer_id = (
      select
        auth.uid()
    )
  ) with check (
    capturer_id = (
      select
        auth.uid()
    )
  );

create policy "records select scoped" on public.records for
select
  to authenticated using (
    capturer_id = (
      select
        auth.uid()
    )
    or (
      select
        private.current_role()
    ) = 'admin'
    or (
      select
        private.is_manager_of(capturer_id)
    )
  );

create policy "records insert own" on public.records for
insert
  to authenticated with check (
    (
      select
        private.current_role()
    ) = 'capturador'
    and capturer_id = (
      select
        auth.uid()
    )
    and (
      select
        private.owns_session(capture_session_id)
    )
  );

create policy "records update scoped" on public.records for
update
  to authenticated using (
    capturer_id = (
      select
        auth.uid()
    )
    or (
      select
        private.current_role()
    ) = 'admin'
  ) with check (
    capturer_id = (
      select
        auth.uid()
    )
    or (
      select
        private.current_role()
    ) = 'admin'
  );

create policy "versions select scoped" on public.record_versions for
select
  to authenticated using (
    exists (
      select
        1
      from
        public.records r
      where
        r.id = record_id
        and (
          r.capturer_id = (
            select
              auth.uid()
          )
          or (
            select
              private.current_role()
          ) = 'admin'
          or (
            select
              private.is_manager_of(r.capturer_id)
          )
        )
    )
  );

create policy "audit admin select" on public.audit_events for
select
  to authenticated using (
    (
      select
        private.current_role()
    ) = 'admin'
  );

revoke
insert
,
update
,
  delete on public.profiles,
  public.audit_events,
  public.record_versions
from
  authenticated;

revoke delete on public.capture_sessions,
public.records
from
  authenticated;
