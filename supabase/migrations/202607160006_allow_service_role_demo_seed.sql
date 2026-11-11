create or replace function public.enforce_session_owner() returns trigger language plpgsql security definer
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

if assigned_manager is null then raise exception 'Capturador invalido o inactivo';

end if;

if tg_op = 'INSERT'
and coalesce(auth.role(), '') <> 'service_role'
and new.capturer_id <> (
  select
    auth.uid()
) then raise exception 'La sesion debe pertenecer al usuario actual';

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

create or replace function public.enforce_record_context() returns trigger language plpgsql security definer
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
or (
  coalesce(auth.role(), '') <> 'service_role'
  and session_row.capturer_id <> (
    select
      auth.uid()
  )
) then raise exception 'Sesion de captura no valida';

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
