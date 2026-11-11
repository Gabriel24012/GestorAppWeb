alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

-- Los usuarios existentes ya eran cuentas utilizables antes de este flujo.
update public.profiles
set onboarding_completed_at = created_at
where is_active = true and onboarding_completed_at is null;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_active from public.profiles p where p.id = (select auth.uid())), false)
$$;

grant execute on function private.is_active_user() to authenticated;

create policy "profiles require active account" on public.profiles as restrictive for all to authenticated
  using ((select private.is_active_user())) with check ((select private.is_active_user()));
create policy "sessions require active account" on public.capture_sessions as restrictive for all to authenticated
  using ((select private.is_active_user())) with check ((select private.is_active_user()));
create policy "records require active account" on public.records as restrictive for all to authenticated
  using ((select private.is_active_user())) with check ((select private.is_active_user()));
create policy "versions require active account" on public.record_versions as restrictive for all to authenticated
  using ((select private.is_active_user())) with check ((select private.is_active_user()));
create policy "audit require active account" on public.audit_events as restrictive for all to authenticated
  using ((select private.is_active_user())) with check ((select private.is_active_user()));
